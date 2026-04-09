import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import {
  buildOrderRowFromWooCommerce,
  wooOrderNote,
  type WooOrderPayload,
} from "./wooOrderMapping.js";
import { isUuid, parseRequestQuery } from "./territoriesShared.js";
import { resolveWooWebhookPublicBaseUrl } from "./wooWebhookPublicUrl.js";
import {
  getZrApiKeyFromEnv,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";
import { registerZrParcelStateWebhook } from "./zrWebhookService.js";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

function getAction(req: ApiRequest): string | null {
  const a = req.query?.action;
  if (typeof a === "string" && a.trim()) return a.trim();
  if (Array.isArray(a) && typeof a[0] === "string" && a[0].trim()) return a[0].trim();
  return null;
}

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

// --- register-zr-webhook ---

async function handleRegisterZrWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const raw = parseJsonBody(req);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  const deliveryCompanyId = (raw as { deliveryCompanyId?: unknown }).deliveryCompanyId;
  if (typeof deliveryCompanyId !== "string" || !deliveryCompanyId.trim()) {
    res.status(400).json({ error: "deliveryCompanyId is required" });
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

  const { data: company, error: cErr } = await db
    .from("delivery_companies")
    .select("id, type, tenant_id, active")
    .eq("id", deliveryCompanyId.trim())
    .single();

  if (cErr || !company) {
    res.status(404).json({ error: "Delivery company not found" });
    return;
  }
  if (!company.active) {
    res.status(400).json({ error: "Delivery company is inactive" });
    return;
  }
  if (company.type !== "zr_express") {
    res.status(400).json({ error: "Only ZR Express companies register parcel webhooks" });
    return;
  }

  const xTenantId =
    (process.env.ZR_TENANT_ID ?? "").trim() || (company.tenant_id ?? "").trim();

  const result = await registerZrParcelStateWebhook(xTenantId);
  if (result.ok === false) {
    res.status(502).json({ error: result.error, zrStatus: result.zrStatus });
    return;
  }

  res.status(200).json({ ok: true, callbackUrl: result.callbackUrl });
}

// --- register-woo-webhook ---

function wooBasicAuthHeader(consumerKey: string, consumerSecret: string): string {
  const token = Buffer.from(`${consumerKey}:${consumerSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

type WcWebhookResponse = { id?: number };

async function handleRegisterWooWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
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
  const deliveryUrl = `${publicBase}/api/handler?action=woo-webhook&channel_id=${encodeURIComponent(id)}`;

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

// --- zr-webhook ---

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

async function handleZrWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
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

// --- zr-territories-search ---

function extractItemsArray(zrJson: unknown): Record<string, unknown>[] {
  if (zrJson == null || typeof zrJson !== "object" || Array.isArray(zrJson)) {
    return [];
  }
  const o = zrJson as Record<string, unknown>;
  const raw = o.items;
  if (Array.isArray(raw)) {
    return raw.filter(
      (x): x is Record<string, unknown> => x != null && typeof x === "object"
    );
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).items;
    if (Array.isArray(inner)) {
      return inner.filter(
        (x): x is Record<string, unknown> => x != null && typeof x === "object"
      );
    }
  }
  return [];
}

function territoryName(row: Record<string, unknown>): string {
  const n =
    (typeof row.name === "string" && row.name.trim()) ||
    (typeof row.label === "string" && row.label.trim()) ||
    (typeof row.territoryName === "string" && row.territoryName.trim()) ||
    "";
  return n;
}

function territoryId(row: Record<string, unknown>): string | null {
  const id = row.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

function bodyListWilayas(): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 500,
    advancedFilter: {
      filters: [{ field: "level", operator: "eq", value: "wilaya" }],
      logic: "and",
    },
  };
}

function bodyListCommunes(parentWilayaId: string): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 1000,
    advancedFilter: {
      filters: [
        { field: "level", operator: "eq", value: "commune" },
        { field: "parentId", operator: "eq", value: parentWilayaId },
      ],
      logic: "and",
    },
  };
}

async function handleZrTerritoriesSearch(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const raw = parseJsonBody(req);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  const body = raw as {
    level?: unknown;
    parentId?: unknown;
    deliveryCompanyId?: unknown;
  };

  const level = body.level === "wilaya" || body.level === "commune" ? body.level : null;
  if (!level) {
    res.status(400).json({ error: 'level must be "wilaya" or "commune"' });
    return;
  }

  let parentId = "";
  if (level === "commune") {
    if (typeof body.parentId !== "string" || !body.parentId.trim()) {
      res.status(400).json({ error: "parentId (wilaya territory id) is required for commune level" });
      return;
    }
    parentId = body.parentId.trim();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  if (!getZrApiKeyFromEnv()) {
    res.status(500).json({ error: "ZR_API_KEY is not configured" });
    return;
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let xTenantId = (process.env.ZR_TENANT_ID ?? "").trim();

  const dcId =
    typeof body.deliveryCompanyId === "string" && body.deliveryCompanyId.trim()
      ? body.deliveryCompanyId.trim()
      : null;

  if (dcId) {
    const { data: co, error: coErr } = await db
      .from("delivery_companies")
      .select("tenant_id, type, active")
      .eq("id", dcId)
      .single();
    if (!coErr && co?.active && co.type === "zr_express" && (co.tenant_id ?? "").trim()) {
      xTenantId = (co.tenant_id ?? "").trim();
    }
  }

  if (!xTenantId) {
    const { data: first } = await db
      .from("delivery_companies")
      .select("tenant_id")
      .eq("active", true)
      .eq("type", "zr_express")
      .limit(1)
      .maybeSingle();
    if ((first?.tenant_id ?? "").trim()) {
      xTenantId = (first?.tenant_id ?? "").trim();
    }
  }

  if (!xTenantId) {
    res.status(400).json({
      error:
        "No ZR tenant: add an active ZR Express delivery company, set ZR_TENANT_ID, or pass deliveryCompanyId.",
    });
    return;
  }

  const searchBody =
    level === "wilaya" ? bodyListWilayas() : bodyListCommunes(parentId);

  const out = await zrRequestWithAuthVariants(
    "/territories/search",
    { method: "POST", body: JSON.stringify(searchBody) },
    xTenantId,
    { logPrefix: "[zr-territories-search]" }
  );

  if (!out.res.ok) {
    res.status(502).json({
      error: zrExpressErrorMessage(out.res.status, out.json, out.text),
      zrStatus: out.res.status,
    });
    return;
  }

  const items = extractItemsArray(out.json);
  const territories: { id: string; name: string }[] = [];
  for (const row of items) {
    const id = territoryId(row);
    const name = territoryName(row);
    if (id && name) territories.push({ id, name });
  }

  territories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  res.status(200).json({ territories });
}

// --- woo-webhook ---

function rawBodyString(req: ApiRequest): string | null {
  const b = req.body;
  if (typeof b === "string") return b;
  if (Buffer.isBuffer(b)) return b.toString("utf8");
  return null;
}

function parseWooOrderBody(req: ApiRequest): WooOrderPayload | null {
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

function firstHeader(req: ApiRequest, name: string): string | null {
  const h = req.headers[name.toLowerCase()];
  if (typeof h === "string" && h.trim()) return h.trim();
  if (Array.isArray(h) && h[0]) return String(h[0]).trim();
  return null;
}

async function handleWooWebhook(req: ApiRequest, res: ApiResponse): Promise<void> {
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

// --- territories (cached zr_territories table) ---

async function handleTerritoriesCities(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const q = parseRequestQuery(req);
  const companyId = (q.company_id ?? q.deliveryCompanyId ?? "").trim();
  if (!companyId || !isUuid(companyId)) {
    res.status(400).json({
      error: "Missing or invalid query parameter: company_id (UUID of delivery company)",
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

  const { data, error } = await db
    .from("zr_territories")
    .select(
      "territory_id, name, normalized_name, source, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .eq("kind", "city")
    .order("name", { ascending: true });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({
    ok: true,
    items: data ?? [],
  });
}

async function handleTerritoriesDistricts(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const q = parseRequestQuery(req);
  const companyId = (q.company_id ?? q.deliveryCompanyId ?? "").trim();
  if (!companyId || !isUuid(companyId)) {
    res.status(400).json({
      error: "Missing or invalid query parameter: company_id (UUID of delivery company)",
    });
    return;
  }

  const cityTerritoryId = (q.city_territory_id ?? q.cityTerritoryId ?? "")
    .trim();
  if (cityTerritoryId && !isUuid(cityTerritoryId)) {
    res.status(400).json({
      error: "Invalid query parameter: city_territory_id must be a UUID",
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

  let query = db
    .from("zr_territories")
    .select(
      "territory_id, name, normalized_name, parent_city_territory_id, source, created_at, updated_at"
    )
    .eq("company_id", companyId)
    .eq("kind", "district")
    .order("name", { ascending: true });

  if (cityTerritoryId) {
    query = query.eq("parent_city_territory_id", cityTerritoryId);
  }

  const { data, error } = await query;

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({
    ok: true,
    items: data ?? [],
  });
}

// --- dispatch ---

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const action = getAction(req);
  if (!action) {
    res.status(400).json({ error: "Missing query parameter: action" });
    return;
  }

  switch (action) {
    case "register-zr-webhook":
      await handleRegisterZrWebhook(req, res);
      return;
    case "register-woo-webhook":
      await handleRegisterWooWebhook(req, res);
      return;
    case "zr-webhook":
      await handleZrWebhook(req, res);
      return;
    case "zr-territories-search":
      await handleZrTerritoriesSearch(req, res);
      return;
    case "woo-webhook":
      await handleWooWebhook(req, res);
      return;
    case "territories-cities":
      await handleTerritoriesCities(req, res);
      return;
    case "territories-districts":
      await handleTerritoriesDistricts(req, res);
      return;
    default:
      res.status(404).json({ error: "Unknown action", action });
  }
}
