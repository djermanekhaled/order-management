import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { resolveWooWebhookPublicBaseUrl } from "./wooWebhookPublicUrl.js";

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

function wooBasicAuthHeader(consumerKey: string, consumerSecret: string): string {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

type WcWebhookResponse = { id?: number };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const raw = parseJsonBody(req);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const channelId = (raw as { channel_id?: unknown }).channel_id;
  if (typeof channelId !== "string" || !channelId.trim()) {
    res.status(400).json({ error: "channel_id is required" });
    return;
  }

  const publicBase = resolveWooWebhookPublicBaseUrl();
  if (!publicBase) {
    res.status(500).json({
      error:
        "Set WOO_WEBHOOK_PUBLIC_URL (e.g. https://your-app.vercel.app) or deploy with VERCEL_URL so the webhook delivery URL can be built.",
    });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const id = channelId.trim();
  const { data: channel, error: chErr } = await db
    .from("sales_channels")
    .select(
      "id, name, store_url, consumer_key, consumer_secret, status, woo_webhook_id"
    )
    .eq("id", id)
    .single();

  if (chErr || !channel) {
    res.status(404).json({ error: "Sales channel not found" });
    return;
  }
  if (channel.status !== "active") {
    res.status(400).json({ error: "Channel must be active to register a webhook" });
    return;
  }

  const base = channel.store_url.replace(/\/+$/, "");
  const auth = wooBasicAuthHeader(channel.consumer_key, channel.consumer_secret);
  const apiRoot = `${base}/wp-json/wc/v3`;

  const existingWooId = (channel.woo_webhook_id ?? "").trim();
  if (existingWooId) {
    try {
      const delRes = await fetch(`${apiRoot}/webhooks/${existingWooId}`, {
        method: "DELETE",
        headers: { Accept: "application/json", Authorization: auth },
      });
      if (!delRes.ok && delRes.status !== 404) {
        const t = (await delRes.text()).slice(0, 400);
        console.warn("[register-woo-webhook] delete old webhook:", delRes.status, t);
      }
    } catch (e) {
      console.warn("[register-woo-webhook] delete old webhook failed:", e);
    }
  }

  const webhookSecret = randomBytes(32).toString("base64url");
  const deliveryUrl = `${publicBase}/api/woo-webhook?channel_id=${encodeURIComponent(id)}`;

  const createBody = JSON.stringify({
    name: "COD Manager New Order",
    topic: "order.created",
    delivery_url: deliveryUrl,
    status: "active",
    secret: webhookSecret,
  });

  let wcRes: Response;
  try {
    wcRes = await fetch(`${apiRoot}/webhooks`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: auth,
      },
      body: createBody,
    });
  } catch (e) {
    res.status(502).json({
      error: "Failed to reach WooCommerce",
      details: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const wcText = await wcRes.text();
  if (!wcRes.ok) {
    res.status(502).json({
      error: "WooCommerce webhook registration failed",
      status: wcRes.status,
      details: wcText.slice(0, 800),
    });
    return;
  }

  let created: WcWebhookResponse;
  try {
    created = JSON.parse(wcText) as WcWebhookResponse;
  } catch {
    res.status(502).json({ error: "Invalid JSON from WooCommerce", details: wcText.slice(0, 400) });
    return;
  }

  const wooId = created.id != null ? String(created.id) : "";

  const { error: upErr } = await db
    .from("sales_channels")
    .update({
      webhook_secret: webhookSecret,
      woo_webhook_id: wooId,
    })
    .eq("id", id);

  if (upErr) {
    res.status(500).json({ error: upErr.message });
    return;
  }

  res.status(200).json({ ok: true, deliveryUrl, wooWebhookId: wooId || undefined });
}
