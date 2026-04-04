import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { buildOrderRowFromWooCommerce, type WooOrderPayload } from "./wooOrderMapping.js";

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

function parseWooOrderBody(req: WebhookRequest): WooOrderPayload | null {
  const b = req.body;
  if (b == null || b === "") return null;
  if (typeof b === "string") {
    try {
      return JSON.parse(b) as WooOrderPayload;
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(b)) {
    try {
      return JSON.parse(b.toString("utf8")) as WooOrderPayload;
    } catch {
      return null;
    }
  }
  if (typeof b === "object") {
    return b as WooOrderPayload;
  }
  return null;
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

  const row = buildOrderRowFromWooCommerce(payload, channel.name);

  const { error: insErr } = await supabaseAdmin.from("orders").insert(row);

  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.status(200).json({ ok: true });
}
