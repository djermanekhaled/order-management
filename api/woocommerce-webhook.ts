import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function readRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

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

function mapWooStatus(status: string | undefined): "new" | "under_process" | "completed" | "cancelled" {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "pending") return "new";
  if (s === "processing" || s === "on-hold") return "under_process";
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "failed" || s === "refunded") return "cancelled";
  return "new";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const channelId = typeof req.query.channel_id === "string" ? req.query.channel_id : null;
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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: channel, error: chErr } = await supabaseAdmin
    .from("sales_channels")
    .select("id, name, consumer_secret")
    .eq("id", channelId)
    .single();

  if (chErr || !channel) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }

  const signatureHeader =
    (req.headers["x-wc-webhook-signature"] as string | undefined) ??
    (req.headers["X-WC-Webhook-Signature"] as string | undefined);

  if (!signatureHeader) {
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = await readRawBody(req);
  const expected = crypto
    .createHmac("sha256", channel.consumer_secret)
    .update(rawBody)
    .digest("base64");

  if (!safeEq(signatureHeader, expected)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: WooOrder;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as WooOrder;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
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

