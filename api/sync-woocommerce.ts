import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { buildOrderRowFromWooCommerce, wooOrderNote, type WooOrderPayload } from "./wooOrderMapping";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

function parseJsonBody(req: ApiRequest): unknown | null {
  const b = req.body;
  if (b == null || b === "") return null;
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as unknown;
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString("utf8")) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof b === "object") return b;
  return null;
}

function parseChannelIdFromBody(req: ApiRequest): string | null {
  const raw = parseJsonBody(req);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = (raw as { channel_id?: unknown }).channel_id;
  if (typeof id !== "string" || !id.trim()) return null;
  return id.trim();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const channelId = parseChannelIdFromBody(req);
  if (!channelId) {
    res.status(400).json({ error: "Missing or invalid channel_id in JSON body" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: channel, error: chErr } = await supabaseAdmin
    .from("sales_channels")
    .select("id, name, store_url, consumer_key, consumer_secret")
    .eq("id", channelId)
    .single();

  if (chErr || !channel) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }

  const base = channel.store_url.replace(/\/+$/, "");
  const wcUrl = new URL(`${base}/wp-json/wc/v3/orders`);
  wcUrl.searchParams.set("status", "pending");
  wcUrl.searchParams.set("per_page", "50");
  wcUrl.searchParams.set("consumer_key", channel.consumer_key);
  wcUrl.searchParams.set("consumer_secret", channel.consumer_secret);

  let wcRes: Response;
  try {
    wcRes = await fetch(wcUrl.toString(), { method: "GET", headers: { Accept: "application/json" } });
  } catch (e) {
    res.status(502).json({
      error: "Failed to reach WooCommerce",
      details: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  if (!wcRes.ok) {
    const snippet = (await wcRes.text()).slice(0, 800);
    res.status(502).json({
      error: "WooCommerce request failed",
      status: wcRes.status,
      details: snippet,
    });
    return;
  }

  let orders: WooOrderPayload[];
  try {
    const parsed: unknown = await wcRes.json();
    if (!Array.isArray(parsed)) {
      res.status(502).json({ error: "Unexpected WooCommerce response (not an array)" });
      return;
    }
    orders = parsed as WooOrderPayload[];
  } catch {
    res.status(502).json({ error: "Invalid JSON from WooCommerce" });
    return;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const insertErrors: string[] = [];

  for (const wc of orders) {
    const wcId = wc.id;
    if (wcId == null) {
      skipped += 1;
      continue;
    }

    const noteKey = wooOrderNote(wcId);
    const { data: existing } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("notes", noteKey)
      .maybeSingle();

    if (existing) {
      skipped += 1;
      continue;
    }

    const row = buildOrderRowFromWooCommerce(wc, channel.name);
    const { error: insErr } = await supabaseAdmin.from("orders").insert(row);
    if (insErr) {
      failed += 1;
      if (insertErrors.length < 5) insertErrors.push(insErr.message);
      continue;
    }
    imported += 1;
  }

  res.status(200).json({
    ok: true,
    imported,
    skipped,
    failed,
    fetched: orders.length,
    errors: insertErrors.length ? insertErrors : undefined,
  });
}
