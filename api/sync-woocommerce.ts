import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import {
  buildOrderRowFromWooCommerce,
  wooOrderNote,
  type WooOrderPayload,
} from "./wooOrderMapping.js";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

const PER_PAGE = 100;

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
    .select("id, name, store_url, consumer_key, consumer_secret, last_synced_at")
    .eq("id", channelId)
    .single();

  console.log("SYNC START - channels found:", channel ? 1 : 0);

  if (chErr || !channel) {
    console.log("SYNC ERROR:", chErr?.message ?? "Unknown channel");
    res.status(404).json({ error: "Unknown channel" });
    return;
  }

  const base = channel.store_url.replace(/\/+$/, "");
  console.log("FETCHING from WooCommerce:", base);
  const wcUrl = new URL(`${base}/wp-json/wc/v3/orders`);
  wcUrl.searchParams.set("status", "pending");
  wcUrl.searchParams.set("per_page", String(PER_PAGE));
  wcUrl.searchParams.set("orderby", "modified");
  wcUrl.searchParams.set("order", "asc");
  wcUrl.searchParams.set("consumer_key", channel.consumer_key);
  wcUrl.searchParams.set("consumer_secret", channel.consumer_secret);

  const last = channel.last_synced_at;
  if (typeof last === "string" && last.trim()) {
    wcUrl.searchParams.set("modified_after", last.trim());
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let fetched = 0;
  let pages = 0;
  const insertErrors: string[] = [];

  for (let page = 1; ; page += 1) {
    wcUrl.searchParams.set("page", String(page));

    let wcRes: Response;
    try {
      wcRes = await fetch(wcUrl.toString(), { method: "GET", headers: { Accept: "application/json" } });
    } catch (e) {
      console.log("SYNC ERROR:", e instanceof Error ? e.message : String(e));
      res.status(502).json({
        error: "Failed to reach WooCommerce",
        details: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (!wcRes.ok) {
      const snippet = (await wcRes.text()).slice(0, 800);
      console.log("SYNC ERROR:", `WooCommerce request failed (${wcRes.status}) ${snippet}`);
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
        console.log("SYNC ERROR:", "Unexpected WooCommerce response (not an array)");
        res.status(502).json({ error: "Unexpected WooCommerce response (not an array)" });
        return;
      }
      orders = parsed as WooOrderPayload[];
    } catch {
      console.log("SYNC ERROR:", "Invalid JSON from WooCommerce");
      res.status(502).json({ error: "Invalid JSON from WooCommerce" });
      return;
    }

    pages += 1;
    fetched += orders.length;

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

    if (orders.length < PER_PAGE) break;
  }

  const syncedAt = new Date().toISOString();
  const { error: syncErr } = await supabaseAdmin
    .from("sales_channels")
    .update({ last_synced_at: syncedAt })
    .eq("id", channelId);

  if (syncErr) {
    console.log("SYNC ERROR:", syncErr.message);
    res.status(500).json({ error: syncErr.message });
    return;
  }

  console.log("WOO ORDERS FETCHED:", fetched);
  console.log("ORDERS INSERTED:", imported);

  res.status(200).json({
    ok: true,
    imported,
    skipped,
    failed,
    fetched,
    pages,
    last_synced_at: syncedAt,
    errors: insertErrors.length ? insertErrors : undefined,
  });
}
