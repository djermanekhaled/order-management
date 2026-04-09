import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import {
  buildOrderRowFromWooCommerce,
  wooOrderNote,
  type WooOrderPayload,
} from "./wooOrderMapping.js";

type WebhookRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type WebhookResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

function rawBodyString(req: WebhookRequest): string | null {
  const b = req.body;
  if (typeof b === "string") return b;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  return null;
}

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

function verifyWooSignature(
  rawBody: string,
  signatureB64: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signatureB64, "utf8"));
  } catch {
    return false;
  }
}

function firstHeader(req: WebhookRequest, name: string): string | null {
  const h = req.headers[name.toLowerCase()];
  if (typeof h === "string" && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]) return String(h[0]).trim();
  return null;
}

export default async function handler(req: WebhookRequest, res: WebhookResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const channelId =
    typeof req.query?.channel_id === "string" ? req.query.channel_id : null;
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
    .select("id, name, webhook_secret")
    .eq("id", channelId)
    .single();

  if (chErr || !channel) {
    res.status(404).json({ error: "Unknown channel" });
    return;
  }

  const secret = (channel.webhook_secret ?? "").trim();
  const sigHeader = firstHeader(req, "x-wc-webhook-signature");
  if (secret && sigHeader) {
    const raw = rawBodyString(req);
    if (raw) {
      if (!verifyWooSignature(raw, sigHeader, secret)) {
        console.warn("[woo-webhook] invalid X-WC-Webhook-Signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }
  }

  const payload = parseWooOrderBody(req);
  if (!payload) {
    res.status(400).json({ error: "Invalid or missing JSON body" });
    return;
  }

  const wcId = payload.id;
  if (wcId == null) {
    res.status(400).json({ error: "Missing order id" });
    return;
  }

  const noteKey = wooOrderNote(wcId);
  const { data: existing } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("notes", noteKey)
    .maybeSingle();

  if (existing) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  const row = buildOrderRowFromWooCommerce(payload, channel.name);
  const { error: insErr } = await supabaseAdmin.from("orders").insert(row);

  if (insErr) {
    console.error("[woo-webhook] insert error:", insErr.message);
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.status(200).json({ ok: true });
}
