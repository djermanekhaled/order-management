import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

type WooOrder = {
  id?: number;
  status?: string;
  total?: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    address_1?: string;
    state?: string;
  };
  line_items?: Array<{
    name?: string;
    quantity?: number;
  }>;
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

function wooOrderNote(wcId: number): string {
  return `WooCommerce order #${wcId}`;
}

function mapWooStatus(status: string | undefined): "new" | "under_process" | "completed" | "cancelled" {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "pending") return "new";
  if (s === "processing" || s === "on-hold") return "under_process";
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "failed" || s === "refunded") return "cancelled";
  return "new";
}

function mapWooToRow(wc: WooOrder, sourceName: string) {
  const first = wc.billing?.first_name?.trim() ?? "";
  const last = wc.billing?.last_name?.trim() ?? "";
  const customerName = [first, last].filter(Boolean).join(" ").trim() || "WooCommerce Customer";
  const item0 = wc.line_items?.[0];
  const product = item0?.name?.trim() || "WooCommerce item";
  const quantity =
    Number.isFinite(item0?.quantity) && (item0?.quantity ?? 0) > 0 ? (item0?.quantity as number) : 1;
  const amount = Number(wc.total ?? 0);
  const wcId = wc.id;

  return {
    customer_name: customerName,
    phone: wc.billing?.phone?.trim() ?? "",
    address: wc.billing?.address_1?.trim() ?? "",
    wilaya: wc.billing?.state?.trim() ?? "",
    product,
    quantity,
    amount: Number.isFinite(amount) ? amount : 0,
    notes: wcId != null ? wooOrderNote(wcId) : "WooCommerce order",
    status: mapWooStatus(wc.status),
    sub_status: null as null,
    delivery_company: "",
    source: sourceName,
  };
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

  let orders: WooOrder[];
  try {
    const parsed: unknown = await wcRes.json();
    if (!Array.isArray(parsed)) {
      res.status(502).json({ error: "Unexpected WooCommerce response (not an array)" });
      return;
    }
    orders = parsed as WooOrder[];
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

    // Same marker as webhook imports: "WooCommerce order #<id>". Dedupe by exact notes match.
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

    const row = mapWooToRow(wc, channel.name);
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
