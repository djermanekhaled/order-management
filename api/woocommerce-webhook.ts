import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";

/**
 * Vercel passes a Node-style request with parsed `query` and `body`.
 * `IncomingMessage` covers method/headers; we extend with what the runtime adds.
 */
type WebhookRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

/** Vercel's response helper (not on std `ServerResponse` typings). */
type WebhookResponse = {
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

function parseWooOrderBody(req: WebhookRequest): WooOrder | null {
  const b = req.body;
  if (b == null || b === "") return null;
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as WooOrder;
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString("utf8")) as WooOrder;
    } catch {
      return null;
    }
  }
  if (typeof b === "object") {
    return b as WooOrder;
  }
  return null;
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

export default async function handler(req: WebhookRequest, res: WebhookResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const channelId =
    typeof req.query?.channel_id === "string" ? req.query.channel_id : null;
  console.log("[woocommerce-webhook] channel_id received:", channelId);
  if (!channelId) {
    res.status(400).json({ error: "Missing channel_id" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  console.log(
    "[woocommerce-webhook] SUPABASE_URL (first 20 chars):",
    supabaseUrl.slice(0, 20)
  );

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: channel, error: chErr } = await supabaseAdmin
    .from("sales_channels")
    .select("id, name")
    .eq("id", channelId)
    .single();

  console.log("[woocommerce-webhook] channel lookup error:", chErr);
  console.log("[woocommerce-webhook] channel data:", channel);

  if (chErr || !channel) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }

  const payload = parseWooOrderBody(req);
  if (!payload) {
    res.status(400).json({ error: "Invalid or missing JSON body" });
    return;
  }

  const first = payload.billing?.first_name?.trim() ?? "";
  const last = payload.billing?.last_name?.trim() ?? "";
  const customerName = [first, last].filter(Boolean).join(" ").trim() || "WooCommerce Customer";

  const item0 = payload.line_items?.[0];
  const product = item0?.name?.trim() || "WooCommerce item";
  const quantity = Number.isFinite(item0?.quantity) && (item0?.quantity ?? 0) > 0 ? (item0?.quantity as number) : 1;
  const amount = Number(payload.total ?? 0);

  const { error: insErr } = await supabaseAdmin.from("orders").insert({
    customer_name: customerName,
    phone: payload.billing?.phone?.trim() ?? "",
    address: payload.billing?.address_1?.trim() ?? "",
    wilaya: payload.billing?.state?.trim() ?? "",
    product,
    quantity,
    amount: Number.isFinite(amount) ? amount : 0,
    notes: payload.id ? `WooCommerce order #${payload.id}` : "WooCommerce order",
    status: mapWooStatus(payload.status),
    sub_status: null,
    delivery_company: "",
    source: channel.name,
  });

  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.status(200).json({ ok: true });
}
