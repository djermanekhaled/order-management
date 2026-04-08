import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";

type WebhookRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type WebhookResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseJsonBody(req: WebhookRequest): unknown | null {
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

function firstStringFrom(obj: unknown, keys: string[]): string | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function walkWebhookLayers(root: unknown): unknown[] {
  if (!root || typeof root !== "object") return [];
  const o = root as Record<string, unknown>;
  return [
    root,
    o.data,
    o.payload,
    o.body,
    o.parcel,
    o.event,
    o.eventData,
    o.event_data,
  ].filter(Boolean);
}

function extractOrderIdFromZrWebhook(body: unknown): string | null {
  const layers = walkWebhookLayers(body);
  for (const layer of layers) {
    const s = firstStringFrom(layer, [
      "externalId",
      "external_id",
      "orderId",
      "order_id",
    ]);
    if (s) return s;
  }
  return null;
}

function stringifyState(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null;
}

function extractShippingStatusFromZrWebhook(body: unknown): string | null {
  const layers = walkWebhookLayers(body);
  for (const layer of layers) {
    if (!layer || typeof layer !== "object" || Array.isArray(layer)) continue;
    const o = layer as Record<string, unknown>;
    const keys = [
      "state",
      "status",
      "parcelState",
      "parcel_state",
      "newState",
      "new_state",
      "situation",
      "situationName",
      "situation_name",
    ];
    for (const k of keys) {
      const s = stringifyState(o[k]);
      if (s) return s;
    }
  }
  return null;
}

function extractTrackingFromZrWebhook(body: unknown): string | null {
  const layers = walkWebhookLayers(body);
  const keys = [
    "trackingNumber",
    "tracking_number",
    "trackingCode",
    "tracking_code",
    "barcode",
    "tracking",
  ];
  for (const layer of layers) {
    const s = firstStringFrom(layer, keys);
    if (s) return s;
  }
  return null;
}

function extractZrParcelIdFromWebhook(body: unknown): string | null {
  const layers = walkWebhookLayers(body);
  const keys = ["parcelId", "parcel_id", "parcelUUID", "parcel_uuid"];
  for (const layer of layers) {
    const s = firstStringFrom(layer, keys);
    if (s) return s;
  }
  const root = body && typeof body === "object" && !Array.isArray(body) ? body : null;
  if (root) {
    const o = root as Record<string, unknown>;
    const id = o.id;
    if (typeof id === "string" && id.trim()) {
      const tid = id.trim();
      const ext = extractOrderIdFromZrWebhook(body);
      if (!ext || tid !== ext) return tid;
    }
  }
  return null;
}

export default async function handler(req: WebhookRequest, res: WebhookResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = parseJsonBody(req);
  if (body == null) {
    res.status(400).json({ error: "Invalid or empty JSON body" });
    return;
  }

  const orderId = extractOrderIdFromZrWebhook(body);
  if (!orderId || !UUID_RE.test(orderId)) {
    res.status(400).json({ error: "Missing or invalid externalId (order id)" });
    return;
  }

  const shippingStatus = extractShippingStatusFromZrWebhook(body);
  const trackingNumber = extractTrackingFromZrWebhook(body);
  const zrParcelId = extractZrParcelIdFromWebhook(body);

  if (!shippingStatus && !trackingNumber && !zrParcelId) {
    res.status(400).json({
      error: "No state, tracking number, or parcel id found in payload",
    });
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

  const patch: Record<string, string> = {};
  if (shippingStatus) patch.shipping_status = shippingStatus;
  if (trackingNumber) patch.tracking_number = trackingNumber;
  if (zrParcelId) patch.zr_parcel_id = zrParcelId;

  const { error: uErr } = await supabaseAdmin.from("orders").update(patch).eq("id", orderId);
  if (uErr) {
    console.error("[zr-webhook] orders update failed", uErr);
    res.status(500).json({ error: uErr.message });
    return;
  }

  res.status(200).json({ ok: true });
}
