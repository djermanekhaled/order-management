import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
};

type DbOrder = {
  id: string;
  customer_name: string;
  phone: string;
  wilaya: string;
  address: string;
  product: string;
  quantity: number;
  amount: number;
  status: string;
  sub_status: string | null;
};

const ZR_BASE = "https://api.zrexpress.app";

/** Supplier default territories when no hub matches order.wilaya → hub.address.city. */
const ZR_SUPPLIER_DEFAULT_CITY_TERRITORY_ID =
  process.env.ZR_DEFAULT_CITY_TERRITORY_ID?.trim() ||
  "37c70742-df6b-4019-981a-a16a29a14748";

const ZR_SUPPLIER_DEFAULT_DISTRICT_TERRITORY_ID =
  process.env.ZR_DEFAULT_DISTRICT_TERRITORY_ID?.trim() ||
  "340d6a99-c51e-4875-bbbe-fd4434aafa80";

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

function formatDzPhoneNumber1(raw: string): string {
  const s0 = raw.replace(/[\s\-.]/g, "").trim();
  if (!s0) return "+213";
  let s = s0;
  if (s.startsWith("+213")) {
    const rest = s.slice(4).replace(/^0+/, "");
    return `+213${rest}`;
  }
  if (s.startsWith("213")) {
    const rest = s.slice(3).replace(/^0+/, "");
    return `+213${rest}`;
  }
  if (s.startsWith("0")) s = s.slice(1);
  return `+213${s.replace(/^\+/, "")}`;
}

function asTerritoryId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function wilayaNamesMatch(orderWilaya: string, territoryName: string): boolean {
  const o = orderWilaya.trim().toLowerCase();
  const t = territoryName.trim().toLowerCase();
  if (!o || !t) return false;
  if (o === t) return true;
  const parts = o
    .split(/[—\-–]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const namePart = parts[parts.length - 1] ?? o;
  const codePart = parts[0] ?? "";
  if (namePart === t) return true;
  if (o.includes(t) || t.includes(namePart)) return true;
  if (codePart && (t.includes(codePart) || codePart === t)) return true;
  return false;
}

function extractWilayaNamePart(orderWilaya: string): string {
  const parts = orderWilaya
    .trim()
    .split(/[—\-–]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length > 0
    ? (parts[parts.length - 1] ?? "")
    : orderWilaya.trim().toLowerCase();
}

/** Hubs array from POST /api/v1/hubs/search response. */
function extractHubsArray(zrJson: unknown): Record<string, unknown>[] {
  if (zrJson == null) return [];
  if (Array.isArray(zrJson)) {
    return zrJson.filter(
      (x): x is Record<string, unknown> => x != null && typeof x === "object"
    );
  }
  if (typeof zrJson !== "object") return [];
  const o = zrJson as Record<string, unknown>;
  const candidates = [
    o.hubs,
    o.results,
    o.items,
    o.data,
    (o.data as Record<string, unknown> | undefined)?.hubs,
    (o.data as Record<string, unknown> | undefined)?.items,
    (o.data as Record<string, unknown> | undefined)?.results,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) {
      return c.filter(
        (x): x is Record<string, unknown> => x != null && typeof x === "object"
      );
    }
  }
  return [];
}

/**
 * Map hub.address.city (lowercase) → territory ids from each hub.
 */
function buildHubCityTerritoryMap(
  hubs: Record<string, unknown>[]
): Map<string, { cityTerritoryId: string; districtTerritoryId: string }> {
  const map = new Map<
    string,
    { cityTerritoryId: string; districtTerritoryId: string }
  >();
  for (const hub of hubs) {
    const addr = hub.address;
    if (addr == null || typeof addr !== "object") continue;
    const a = addr as Record<string, unknown>;
    const cityRaw = typeof a.city === "string" ? a.city.trim() : "";
    if (!cityRaw) continue;
    const cityTid = asTerritoryId(
      hub.cityTerritoryId ?? hub.cityTerritoryID
    );
    const distTid = asTerritoryId(
      hub.districtTerritoryId ?? hub.districtTerritoryID
    );
    if (!cityTid || !distTid) continue;
    const key = cityRaw.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        cityTerritoryId: cityTid,
        districtTerritoryId: distTid,
      });
    }
  }
  return map;
}

function resolveTerritoryFromHubMap(
  orderWilaya: string,
  hubMap: Map<string, { cityTerritoryId: string; districtTerritoryId: string }>
): {
  cityTerritoryId: string;
  districtTerritoryId: string;
  source: string;
} {
  const w = orderWilaya.trim();
  if (!w) {
    throw new Error("resolveTerritoryFromHubMap requires non-empty wilaya");
  }

  for (const [cityLower, ids] of hubMap) {
    if (wilayaNamesMatch(w, cityLower)) {
      return { ...ids, source: "hubs_search" };
    }
  }

  const namePart = extractWilayaNamePart(orderWilaya);
  if (namePart && hubMap.has(namePart)) {
    return { ...hubMap.get(namePart)!, source: "hubs_search" };
  }

  const wl = w.toLowerCase();
  for (const [cityLower, ids] of hubMap) {
    if (cityLower.length >= 2 && wl.includes(cityLower)) {
      return { ...ids, source: "hubs_search" };
    }
  }

  return {
    cityTerritoryId: ZR_SUPPLIER_DEFAULT_CITY_TERRITORY_ID,
    districtTerritoryId: ZR_SUPPLIER_DEFAULT_DISTRICT_TERRITORY_ID,
    source: "supplier_default_fallback",
  };
}

function hubCityNamesSample(
  hubMap: Map<string, { cityTerritoryId: string; districtTerritoryId: string }>,
  limit: number
): string[] {
  return [...hubMap.keys()].slice(0, limit);
}

function buildZrParcel(
  order: DbOrder,
  territory: { cityTerritoryId: string; districtTerritoryId: string }
) {
  return {
    stockType: "local",
    externalId: order.id,
    description: order.product,
    customer: {
      customerId: randomUUID(),
      name: order.customer_name,
      phone: { number1: formatDzPhoneNumber1(order.phone || "") },
    },
    cityTerritoryId: territory.cityTerritoryId,
    districtTerritoryId: territory.districtTerritoryId,
    deliveryAddress: {
      street: order.address || "",
    },
    orderedProducts: [
      {
        productName: order.product,
        quantity: order.quantity,
        stockType: "local",
      },
    ],
    amount: Number(order.amount),
    deliveryType: "home",
  };
}

function extractResultArray(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  for (const key of ["data", "parcels", "results", "items"]) {
    const v = d[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function trackingFromResult(item: unknown): string | null {
  if (typeof item === "string" && item.trim()) return item.trim();
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const keys = [
    "trackingNumber",
    "tracking_number",
    "trackingCode",
    "tracking_code",
    "barcode",
    "tracking",
  ];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const nested = o.parcel ?? o.data ?? o.result;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    for (const k of keys) {
      const v = n[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

function referenceFromResult(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const keys = ["reference", "orderReference", "orderId", "externalId"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const nested = o.parcel ?? o.data;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    for (const k of keys) {
      const v = n[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return null;
}

const LOG_PREFIX = "[validate-shipment]";

type ZrAuthVariant = "x_api_key" | "bearer" | "raw_secret";

function zrAuthVariantDescription(variant: ZrAuthVariant): string {
  switch (variant) {
    case "x_api_key":
      return "X-Api-Key: {secretKey} (no Authorization header)";
    case "bearer":
      return "Authorization: Bearer {secretKey}";
    case "raw_secret":
      return "Authorization: {secretKey} (no Bearer prefix)";
  }
}

function buildZrRequestHeaders(
  variant: ZrAuthVariant,
  tenantId: string,
  secretKey: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Tenant": tenantId,
  };
  if (variant === "x_api_key") {
    headers["X-Api-Key"] = secretKey;
    return headers;
  }
  if (variant === "bearer") {
    headers.Authorization = `Bearer ${secretKey}`;
    return headers;
  }
  headers.Authorization = secretKey;
  return headers;
}

/** Log preview: first 10 characters only (rest redacted). */
function first10LogPreview(value: string | undefined): string {
  if (value == null || value === "") return "(empty)";
  if (value.length <= 10) return value;
  return `${value.slice(0, 10)}…`;
}

function logFullZrOutboundRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string,
  authVariant: ZrAuthVariant
): void {
  console.log(`${LOG_PREFIX} ZR Express FULL outbound request`);
  console.log(`${LOG_PREFIX}   Method:`, method);
  console.log(`${LOG_PREFIX}   URL:`, url);
  console.log(
    `${LOG_PREFIX}   Auth attempt:`,
    zrAuthVariantDescription(authVariant)
  );
  console.log(
    `${LOG_PREFIX}   X-Tenant in use (first 10 chars):`,
    first10LogPreview(headers["X-Tenant"])
  );
  const apiKey = headers["X-Api-Key"];
  console.log(
    `${LOG_PREFIX}   X-Api-Key in use (first 10 chars):`,
    apiKey !== undefined
      ? first10LogPreview(apiKey)
      : "(not sent for this attempt — using Authorization header)"
  );
  const safeHeaders: Record<string, string> = { ...headers };
  if (safeHeaders["X-Tenant"] !== undefined) {
    safeHeaders["X-Tenant"] = first10LogPreview(safeHeaders["X-Tenant"]);
  }
  if (safeHeaders["X-Api-Key"] !== undefined) {
    safeHeaders["X-Api-Key"] = first10LogPreview(safeHeaders["X-Api-Key"]);
  }
  if (safeHeaders.Authorization !== undefined) {
    const a = safeHeaders.Authorization;
    const bearer = /^Bearer\s+/i.test(a);
    const secret = bearer ? a.replace(/^Bearer\s+/i, "") : a;
    safeHeaders.Authorization = bearer
      ? `Bearer ${first10LogPreview(secret)}`
      : first10LogPreview(a);
  }
  console.log(
    `${LOG_PREFIX}   Headers (sensitive values truncated to 10 chars):`,
    safeHeaders
  );
  console.log(`${LOG_PREFIX}   Body (complete):`, body);
}

/**
 * Best-effort human-readable message from ZR Express error responses.
 */
function zrExpressErrorMessage(
  httpStatus: number,
  zrJson: unknown,
  zrText: string
): string {
  if (zrJson && typeof zrJson === "object" && !Array.isArray(zrJson)) {
    const o = zrJson as Record<string, unknown>;
    const direct = o.message ?? o.detail ?? o.title;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    const errField = o.error;
    if (typeof errField === "string" && errField.trim()) return errField.trim();
    if (errField && typeof errField === "object" && !Array.isArray(errField)) {
      const nested = errField as Record<string, unknown>;
      const nm = nested.message ?? nested.error ?? nested.detail;
      if (typeof nm === "string" && nm.trim()) return nm.trim();
    }

    if (Array.isArray(o.errors)) {
      const parts = o.errors
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const e = item as Record<string, unknown>;
            const m = e.message ?? e.error ?? e.detail;
            if (typeof m === "string" && m.trim()) return m.trim();
          }
          return null;
        })
        .filter((s): s is string => Boolean(s));
      if (parts.length) return parts.join("; ");
    }

    const data = o.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const d = data as Record<string, unknown>;
      const m = d.message ?? d.error ?? d.detail;
      if (typeof m === "string" && m.trim()) return m.trim();
    }
  }

  const trimmed = zrText.trim();
  if (trimmed) return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}…` : trimmed;
  return `ZR Express returned HTTP ${httpStatus}`;
}

/** Collect nested ZR validation / error strings for UI. */
function collectZrErrorStrings(zrJson: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  if (zrJson == null) return [];
  if (typeof zrJson === "string") {
    const t = zrJson.trim();
    return t ? [t] : [];
  }
  if (typeof zrJson !== "object") return [];
  if (Array.isArray(zrJson)) {
    return zrJson.flatMap((x) => collectZrErrorStrings(x, depth + 1));
  }
  const o = zrJson as Record<string, unknown>;
  const found: string[] = [];
  for (const k of ["message", "error", "detail", "title", "description", "reason"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) {
      found.push(v.trim());
    } else if (v && typeof v === "object") {
      found.push(...collectZrErrorStrings(v, depth + 1));
    }
  }
  if (Array.isArray(o.errors)) {
    for (const e of o.errors) {
      if (typeof e === "string" && e.trim()) found.push(e.trim());
      else found.push(...collectZrErrorStrings(e, depth + 1));
    }
  }
  return [...new Set(found.filter(Boolean))];
}

function buildZrUiErrorPayload(
  httpStatus: number,
  zrJson: unknown,
  zrText: string,
  authVariant: ZrAuthVariant,
  zrStep: string
): Record<string, unknown> {
  const primary = zrExpressErrorMessage(httpStatus, zrJson, zrText);
  const details = collectZrErrorStrings(zrJson, 0).filter((s) => s !== primary);
  const error =
    details.length > 0 ? `${primary} — ${details.join("; ")}` : primary;
  return {
    error,
    zrStep,
    zrStatus: httpStatus,
    zrBody: zrJson !== null ? zrJson : zrText,
    zrErrorDetails: details.length ? [primary, ...details] : [primary],
    zrAuthorizationVariant: zrAuthVariantDescription(authVariant),
  };
}

async function zrRequestWithAuthVariants(
  url: string,
  init: { method?: string; body?: string | undefined },
  tenantId: string,
  secretKey: string
): Promise<{
  res: Response;
  text: string;
  json: unknown;
  variant: ZrAuthVariant;
}> {
  const method = init.method ?? "POST";
  const body = init.body;
  const variants: ZrAuthVariant[] = ["x_api_key", "bearer", "raw_secret"];
  let last!: {
    res: Response;
    text: string;
    json: unknown;
    variant: ZrAuthVariant;
  };

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const headers = buildZrRequestHeaders(variant, tenantId, secretKey);
    logFullZrOutboundRequest(method, url, headers, body ?? "", variant);

    const res = await fetch(url, { method, headers, body });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    console.log(
      `${LOG_PREFIX} ZR Express response status [${variant}]:`,
      res.status
    );
    console.log(`${LOG_PREFIX} ZR Express response body [${variant}]:`, text);

    last = { res, text, json, variant };

    if (res.ok) {
      console.log(
        `${LOG_PREFIX} ZR Express accepted auth method:`,
        zrAuthVariantDescription(variant)
      );
      return last;
    }

    const authRejected = res.status === 401 || res.status === 403;
    const hasNext = i < variants.length - 1;

    if (authRejected && hasNext) {
      const next = variants[i + 1];
      console.log(
        `${LOG_PREFIX} Auth rejected (HTTP ${res.status}); next attempt:`,
        zrAuthVariantDescription(next)
      );
      continue;
    }

    return last;
  }

  return last;
}

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
  const body = raw as { orderIds?: unknown; deliveryCompanyId?: unknown };
  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0) {
    res.status(400).json({ error: "orderIds must be a non-empty array" });
    return;
  }
  const orderIds = body.orderIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  if (orderIds.length === 0) {
    res.status(400).json({ error: "orderIds must contain valid UUID strings" });
    return;
  }
  if (typeof body.deliveryCompanyId !== "string" || !body.deliveryCompanyId.trim()) {
    res.status(400).json({ error: "deliveryCompanyId is required" });
    return;
  }
  const deliveryCompanyId = body.deliveryCompanyId.trim();

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
    .select("id, name, type, secret_key, tenant_id, active")
    .eq("id", deliveryCompanyId)
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
    res.status(400).json({ error: "Unsupported delivery company type" });
    return;
  }

  const { data: orders, error: oErr } = await db
    .from("orders")
    .select(
      "id, customer_name, phone, wilaya, address, product, quantity, amount, status, sub_status"
    )
    .in("id", orderIds);

  if (oErr) {
    res.status(500).json({ error: oErr.message });
    return;
  }
  const list = (orders ?? []) as DbOrder[];
  if (list.length !== orderIds.length) {
    res.status(400).json({ error: "One or more orders were not found" });
    return;
  }

  for (const o of list) {
    if (o.status !== "confirmed") {
      res.status(400).json({
        error: `Order ${o.id} must be in status "confirmed" (got ${o.status})`,
      });
      return;
    }
    if (o.sub_status != null && o.sub_status !== "confirmed") {
      res.status(400).json({
        error: `Order ${o.id} must have sub_status null or "confirmed"`,
      });
      return;
    }
  }

  const xTenantId = company.tenant_id.trim();

  console.log(
    `${LOG_PREFIX} Using delivery_companies.tenant_id as X-Tenant (first 10 chars):`,
    first10LogPreview(xTenantId)
  );

  const hubsUrl = `${ZR_BASE}/api/v1/hubs/search`;
  const hubsRequestBody = JSON.stringify({
    pageSize: 1000,
    pageNumber: 1,
  });

  let hubsOutcome: Awaited<ReturnType<typeof zrRequestWithAuthVariants>>;
  try {
    hubsOutcome = await zrRequestWithAuthVariants(
      hubsUrl,
      { method: "POST", body: hubsRequestBody },
      xTenantId,
      company.secret_key
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} ZR hubs/search fetch failed`, {
      url: hubsUrl,
      error: msg,
    });
    res.status(502).json({
      error: `Failed to reach ZR Express hubs/search: ${msg}`,
      zrStep: "hubs_search",
      zrUrl: hubsUrl,
    });
    return;
  }

  if (!hubsOutcome.res.ok) {
    console.error(`${LOG_PREFIX} ZR hubs/search API error`, {
      status: hubsOutcome.res.status,
      body: hubsOutcome.text,
    });
    res
      .status(502)
      .json(
        buildZrUiErrorPayload(
          hubsOutcome.res.status,
          hubsOutcome.json,
          hubsOutcome.text,
          hubsOutcome.variant,
          "hubs_search"
        )
      );
    return;
  }

  const hubsList = extractHubsArray(hubsOutcome.json);
  const hubCityMap = buildHubCityTerritoryMap(hubsList);
  const territoryListSource =
    hubCityMap.size > 0
      ? `hubs_search (${hubCityMap.size} cities)`
      : "hubs_search_empty_map";

  if (hubCityMap.size === 0) {
    console.log(
      `${LOG_PREFIX} hubs/search returned no usable hub city → territory mapping; orders will use supplier default city/district (X-Tenant first 10 chars: ${first10LogPreview(xTenantId)})`
    );
  } else {
    console.log(
      `${LOG_PREFIX} Built hub city map with ${hubCityMap.size} entr${hubCityMap.size === 1 ? "y" : "ies"} from hubs/search`
    );
  }

  const territoryFailures: {
    orderId: string;
    wilaya: string;
    reason: string;
  }[] = [];
  const territoryByOrder = new Map<
    string,
    { cityTerritoryId: string; districtTerritoryId: string }
  >();
  const territorySources: string[] = [];

  for (const order of list) {
    const w = (order.wilaya ?? "").trim();
    if (!w) {
      territoryFailures.push({
        orderId: order.id,
        wilaya: "",
        reason: "Order has no wilaya; cannot resolve cityTerritoryId",
      });
      continue;
    }
    const resolved = resolveTerritoryFromHubMap(w, hubCityMap);
    territoryByOrder.set(order.id, {
      cityTerritoryId: resolved.cityTerritoryId,
      districtTerritoryId: resolved.districtTerritoryId,
    });
    territorySources.push(resolved.source);
  }

  if (territoryFailures.length > 0) {
    const wilayaHint = hubCityNamesSample(hubCityMap, 24);
    res.status(400).json({
      error: territoryFailures
        .map(
          (f) =>
            `Order ${f.orderId}: ${f.reason}${
              f.wilaya ? ` (wilaya: "${f.wilaya}")` : ""
            }`
        )
        .join("\n"),
      zrStep: "territory_lookup",
      territoryFailures,
      zrHubCityNamesSample: wilayaHint.length ? wilayaHint : undefined,
      zrTerritoryListSource: territoryListSource,
      zrErrorDetails: territoryFailures.map(
        (f) =>
          `${f.orderId}: ${f.reason}${f.wilaya ? ` ["${f.wilaya}"]` : ""}`
      ),
    });
    return;
  }

  const parcels = list.map((order) =>
    buildZrParcel(order, territoryByOrder.get(order.id)!)
  );
  const zrUrl = `${ZR_BASE}/api/v1/parcels/bulk`;
  const requestBody = JSON.stringify({ parcels });

  let bulkOutcome: Awaited<ReturnType<typeof zrRequestWithAuthVariants>>;
  try {
    bulkOutcome = await zrRequestWithAuthVariants(
      zrUrl,
      { method: "POST", body: requestBody },
      xTenantId,
      company.secret_key
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} ZR parcels bulk fetch failed`, {
      url: zrUrl,
      error: msg,
    });
    res.status(502).json({
      error: `Failed to reach ZR Express parcels API: ${msg}`,
      zrStep: "parcels_bulk",
      zrUrl,
    });
    return;
  }

  const zrRes = bulkOutcome.res;
  const zrText = bulkOutcome.text;
  const zrJson = bulkOutcome.json;
  const zrAuthVariantUsed = bulkOutcome.variant;

  if (!zrRes.ok) {
    console.error(`${LOG_PREFIX} ZR parcels bulk error`, {
      authMethodLastUsed: zrAuthVariantDescription(zrAuthVariantUsed),
      status: zrRes.status,
      body: zrText,
    });
    res
      .status(502)
      .json(
        buildZrUiErrorPayload(
          zrRes.status,
          zrJson,
          zrText,
          zrAuthVariantUsed,
          "parcels_bulk"
        )
      );
    return;
  }

  const results = extractResultArray(zrJson);
  const trackingByOrderId = new Map<string, string>();

  for (let i = 0; i < list.length; i++) {
    const order = list[i];
    let track: string | null = null;
    const r = results[i];
    if (r !== undefined) {
      track = trackingFromResult(r);
      const ref = referenceFromResult(r);
      if (ref && ref !== order.id) {
        const byRef = results.find(
          (x) => referenceFromResult(x) === order.id
        );
        if (byRef) track = trackingFromResult(byRef);
      }
    }
    if (!track && results.length === list.length) {
      track = trackingFromResult(results[i]);
    }
    if (!track && results.length > 0) {
      const byRef = results.find((x) => referenceFromResult(x) === order.id);
      if (byRef) track = trackingFromResult(byRef);
    }
    if (track) trackingByOrderId.set(order.id, track);
  }

  const errors: string[] = [];
  let updated = 0;

  for (const order of list) {
    const tracking = trackingByOrderId.get(order.id) ?? "";
    const { error: uErr } = await db
      .from("orders")
      .update({
        status: "follow",
        sub_status: "confirmed",
        delivery_company: company.name,
        tracking_number: tracking,
        shipping_status: tracking ? "zr_validated" : "zr_submitted",
      })
      .eq("id", order.id);
    if (uErr) {
      errors.push(`${order.id}: ${uErr.message}`);
      continue;
    }
    updated += 1;
  }

  const usedSupplierDefault = territorySources.some(
    (s) => s === "supplier_default_fallback"
  );

  const successWarnings: string[] = [];
  if (results.length === 0) {
    successWarnings.push(
      "ZR response had no parcel array; check API payload/response shape in api/validate-shipment.ts"
    );
  }
  if (hubCityMap.size === 0) {
    successWarnings.push(
      "hubs/search produced no hub city → territory pairs; all orders used supplier default cityTerritoryId / districtTerritoryId."
    );
  } else if (usedSupplierDefault) {
    successWarnings.push(
      "Some orders did not match any hub.address.city and used supplier default cityTerritoryId / districtTerritoryId."
    );
  }

  res.status(200).json({
    ok: true,
    updated,
    zrResultCount: results.length,
    zrAuthorizationVariant: zrAuthVariantDescription(zrAuthVariantUsed),
    zrXTenantId: xTenantId,
    zrTerritoryListSource: territoryListSource,
    territoryResolutionSources: [...new Set(territorySources)],
    warnings: successWarnings.length ? successWarnings : undefined,
    errors: errors.length ? errors : undefined,
  });
}
