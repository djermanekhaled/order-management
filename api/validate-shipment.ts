import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  type ZrAuthVariant,
  getZrApiKeyFromEnv,
  zrAuthVariantDescription,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";
import { isZrTerritoryGuid } from "./zrTerritoryResolve.js";

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
  commune: string | null;
  address: string;
  product: string;
  quantity: number;
  amount: number;
  status: string;
  sub_status: string | null;
  delivery_type: string | null;
  wilaya_territory_id: string | null;
  commune_territory_id: string | null;
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

/** SKU sent to ZR create API (max 10 chars per prior spec). */
function skuForZrCreateApi(orderProduct: string): string {
  const p = orderProduct.trim();
  if (!p) return "product";
  return p.length <= 10 ? p : p.slice(0, 10);
}

/**
 * Never return empty sku: prefer ZR value, else full order product line, else product id.
 */
function finalizeProductSku(
  orderProduct: string,
  zrSkuOrEmpty: string,
  productId: string
): string {
  const z = zrSkuOrEmpty.trim();
  if (z) return z;
  const p = orderProduct.trim();
  if (p) return p;
  const id = productId.trim();
  if (id) return id;
  return "product";
}

/** Products array from POST /products/search (under /api/v1). */
function extractProductsArray(zrJson: unknown): Record<string, unknown>[] {
  if (zrJson == null) return [];
  if (Array.isArray(zrJson)) {
    return zrJson.filter(
      (x): x is Record<string, unknown> => x != null && typeof x === "object"
    );
  }
  if (typeof zrJson !== "object") return [];
  const o = zrJson as Record<string, unknown>;
  const tryArr = (v: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(v)) return null;
    return v.filter(
      (x): x is Record<string, unknown> => x != null && typeof x === "object"
    );
  };
  for (const k of ["products", "results", "items"]) {
    const inner = tryArr(o[k]);
    if (inner !== null) return inner;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of ["products", "items", "results"]) {
      const inner = tryArr(d[k]);
      if (inner !== null) return inner;
    }
  }
  return [];
}

function extractCreatedProductRecord(
  zrJson: unknown
): Record<string, unknown> | null {
  if (zrJson == null || typeof zrJson !== "object" || Array.isArray(zrJson)) {
    return null;
  }
  const o = zrJson as Record<string, unknown>;
  if (asTerritoryId(o.id ?? o.productId ?? o.product_id)) {
    return o;
  }
  const data = o.data;
  if (data != null && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (asTerritoryId(d.id ?? d.productId ?? d.product_id)) {
      return d;
    }
  }
  return null;
}

function pickZrProductIdSku(
  p: Record<string, unknown>,
  orderProductLine: string
): { id: string; sku: string } | null {
  const id = asTerritoryId(p.id ?? p.productId ?? p.product_id);
  if (!id) return null;
  const rawSku =
    typeof p.sku === "string" && p.sku.trim()
      ? p.sku.trim()
      : typeof p.SKU === "string" && p.SKU.trim()
        ? p.SKU.trim()
        : typeof p.productSku === "string" && p.productSku.trim()
          ? p.productSku.trim()
          : "";
  const sku = finalizeProductSku(orderProductLine, rawSku, id);
  return { id, sku };
}

function zrParcelDeliveryType(
  raw: string | null | undefined
): "home" | "pickup-point" {
  const t = (raw ?? "home").trim().toLowerCase().replace(/_/g, "-");
  return t === "pickup-point" ? "pickup-point" : "home";
}

function buildZrParcel(
  order: DbOrder,
  territory: { cityTerritoryId: string; districtTerritoryId: string },
  zrProduct: { productId: string; sku: string }
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
    deliveryAddress: {
      street: order.address || "",
      cityTerritoryId: territory.cityTerritoryId,
      districtTerritoryId: territory.districtTerritoryId,
    },
    orderedProducts: [
      {
        productId: zrProduct.productId,
        sku: zrProduct.sku,
        productSku: zrProduct.sku,
        productName: order.product,
        quantity: order.quantity,
        stockType: "local",
      },
    ],
    amount: Number(order.amount),
    deliveryType: zrParcelDeliveryType(order.delivery_type),
  };
}

function extractResultArray(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  for (const key of ["successes", "data", "parcels", "results", "items"]) {
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

/** ZR `CreateBulkParcelsResponse.successes[]` includes `parcelId` (uuid). */
function zrParcelIdFromResult(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const direct = o.parcelId ?? o.parcel_id;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const nested = o.parcel ?? o.data ?? o.result;
  if (nested && typeof nested === "object") {
    const n = nested as Record<string, unknown>;
    const np = n.parcelId ?? n.parcel_id ?? n.id;
    if (typeof np === "string" && np.trim()) return np.trim();
  }
  const topId = o.id;
  if (typeof topId === "string" && topId.trim()) {
    const tid = topId.trim();
    const ext = referenceFromResult(item);
    if (!ext || tid !== ext) return tid;
  }
  return null;
}

const LOG_PREFIX = "[validate-shipment]";

function first10LogPreview(value: string | undefined): string {
  if (value == null || value === "") return "(empty)";
  if (value.length <= 10) return value;
  return `${value.slice(0, 10)}…`;
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

async function resolveZrProductIdSku(
  productName: string,
  unitPrice: number,
  xTenantId: string
): Promise<{ productId: string; sku: string; source: "search" | "created" }> {
  const keyword = productName.trim();
  if (!keyword) {
    throw new Error("Product name is empty");
  }

  const searchBody = JSON.stringify({ keyword, pageSize: 10 });
  const searchOut = await zrRequestWithAuthVariants(
    "/products/search",
    { method: "POST", body: searchBody },
    xTenantId
  );

  if (!searchOut.res.ok) {
    const msg = zrExpressErrorMessage(
      searchOut.res.status,
      searchOut.json,
      searchOut.text
    );
    throw new Error(
      `ZR products/search failed (${searchOut.res.status}): ${msg}`
    );
  }

  const foundList = extractProductsArray(searchOut.json);
  console.log(
    `${LOG_PREFIX} products/search keyword="${keyword}" → ${foundList.length} result(s)`
  );
  for (const p of foundList) {
    const picked = pickZrProductIdSku(p, keyword);
    if (picked) {
      console.log(
        `${LOG_PREFIX} Using ZR catalog product id=${picked.id} sku=${picked.sku} productSku=${picked.sku} (search)`
      );
      return { productId: picked.id, sku: picked.sku, source: "search" };
    }
  }

  const skuNew = skuForZrCreateApi(keyword);
  const createBody = JSON.stringify({
    name: keyword,
    sku: skuNew,
    unitPrice: Number(unitPrice),
    stockType: "local",
  });
  const createOut = await zrRequestWithAuthVariants(
    "/products",
    { method: "POST", body: createBody },
    xTenantId
  );

  if (!createOut.res.ok) {
    const msg = zrExpressErrorMessage(
      createOut.res.status,
      createOut.json,
      createOut.text
    );
    throw new Error(
      `ZR products create failed (${createOut.res.status}): ${msg}`
    );
  }

  const createdObj =
    extractCreatedProductRecord(createOut.json) ??
    (createOut.json != null &&
    typeof createOut.json === "object" &&
    !Array.isArray(createOut.json)
      ? (createOut.json as Record<string, unknown>)
      : null);

  if (!createdObj) {
    throw new Error("ZR products create: could not parse product from response");
  }
  const picked = pickZrProductIdSku(createdObj, keyword);
  if (!picked) {
    throw new Error("ZR products create: missing product id in response");
  }
  console.log(
    `${LOG_PREFIX} Created ZR product id=${picked.id} sku=${picked.sku} productSku=${picked.sku}`
  );
  return { productId: picked.id, sku: picked.sku, source: "created" };
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
    .select("id, name, type, tenant_id, active")
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
      "id, customer_name, phone, wilaya, commune, address, product, quantity, amount, status, sub_status, delivery_type, wilaya_territory_id, commune_territory_id"
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

  /** ZR `X-Tenant` header: optional `ZR_TENANT_ID` env (e.g. Vercel), else `delivery_companies.tenant_id`. */
  const xTenantId =
    (process.env.ZR_TENANT_ID ?? "").trim() || company.tenant_id.trim();

  console.log(
    `${LOG_PREFIX} Using X-Tenant (first 10 chars):`,
    first10LogPreview(xTenantId),
    process.env.ZR_TENANT_ID ? "(from ZR_TENANT_ID)" : "(from delivery_companies.tenant_id)"
  );

  if (!getZrApiKeyFromEnv()) {
    res.status(500).json({
      error:
        "Server misconfiguration: ZR_API_KEY is not set. Add ZR_API_KEY in Vercel → Project Settings → Environment Variables (and redeploy).",
      zrStep: "zr_api_key_env",
    });
    return;
  }

  /** ZR parcel build uses `orders.wilaya_territory_id` / `commune_territory_id` from the order form (no live search). */
  const territoryByOrder = new Map<
    string,
    {
      cityTerritoryId: string;
      districtTerritoryId: string;
      citySearchResult: unknown;
      districtSearchResult: unknown;
    }
  >();

  const mappingErrors: string[] = [];

  for (const order of list) {
    const wId = (order.wilaya_territory_id ?? "").trim();
    const cId = (order.commune_territory_id ?? "").trim();
    if (!isZrTerritoryGuid(wId) || !isZrTerritoryGuid(cId)) {
      mappingErrors.push(
        `Order ${order.id}: missing or invalid wilaya_territory_id / commune_territory_id — edit the order and choose wilaya and commune from the ZR lists.`
      );
      continue;
    }
    territoryByOrder.set(order.id, {
      cityTerritoryId: wId,
      districtTerritoryId: cId,
      citySearchResult: [],
      districtSearchResult: [],
    });
  }

  if (mappingErrors.length > 0) {
    res.status(400).json({
      error:
        "Shipment validation failed: one or more orders are missing saved ZR territory IDs.",
      details: mappingErrors,
      zrStep: "territory_ids",
    });
    return;
  }

  const zrProductCacheByKeyword = new Map<
    string,
    { productId: string; sku: string }
  >();

  for (const order of list) {
    const kw = order.product.trim();
    if (!kw) {
      res.status(400).json({
        error: `Order ${order.id} has an empty product name.`,
      });
      return;
    }
    if (zrProductCacheByKeyword.has(kw)) continue;
    try {
      const r = await resolveZrProductIdSku(
        kw,
        Number(order.amount),
        xTenantId
      );
      const sku = finalizeProductSku(kw, r.sku, r.productId);
      zrProductCacheByKeyword.set(kw, {
        productId: r.productId,
        sku,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(502).json({
        error: msg,
        zrStep: "products_search_or_create",
      });
      return;
    }
  }

  try {
    for (const order of list) {
      const t = territoryByOrder.get(order.id)!;
      if (!t.cityTerritoryId || !t.districtTerritoryId) {
        throw new Error(
          `Territory GUIDs missing for order ${order.id} — city: ${t.cityTerritoryId}, district: ${t.districtTerritoryId}`
        );
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({
      error: msg,
      zrStep: "territory_pre_bulk",
    });
    return;
  }

  const parcels = list.map((order) => {
    const kw = order.product.trim();
    const zrProd = zrProductCacheByKeyword.get(kw)!;
    const t = territoryByOrder.get(order.id)!;
    return buildZrParcel(
      order,
      {
        cityTerritoryId: t.cityTerritoryId,
        districtTerritoryId: t.districtTerritoryId,
      },
      zrProd
    );
  });

  const zrPath = "/parcels/bulk";
  const requestBody = JSON.stringify({ parcels });

  let bulkOutcome: Awaited<ReturnType<typeof zrRequestWithAuthVariants>>;
  try {
    console.log(
      `${LOG_PREFIX} ZR Express parcels/bulk — parcel bodies (before fetch), count=${parcels.length}`
    );
    parcels.forEach((parcel, i) => {
      console.log(
        `${LOG_PREFIX} ZR Express parcels/bulk parcel[${i}]:`,
        JSON.stringify(parcel)
      );
    });
    bulkOutcome = await zrRequestWithAuthVariants(
      zrPath,
      { method: "POST", body: requestBody },
      xTenantId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${LOG_PREFIX} ZR parcels bulk fetch failed`, {
      path: zrPath,
      error: msg,
    });
    res.status(502).json({
      error: `Failed to reach ZR Express parcels API: ${msg}`,
      zrStep: "parcels_bulk",
      zrPath,
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
  const zrParcelIdByOrderId = new Map<string, string>();

  for (let i = 0; i < list.length; i++) {
    const order = list[i];
    let track: string | null = null;
    let parcelId: string | null = null;
    const r = results[i];
    if (r !== undefined) {
      track = trackingFromResult(r);
      parcelId = zrParcelIdFromResult(r);
      const ref = referenceFromResult(r);
      if (ref && ref !== order.id) {
        const byRef = results.find(
          (x) => referenceFromResult(x) === order.id
        );
        if (byRef) {
          track = trackingFromResult(byRef);
          parcelId = zrParcelIdFromResult(byRef);
        }
      }
    }
    if (!track && results.length === list.length) {
      track = trackingFromResult(results[i]);
    }
    if (!parcelId && results.length === list.length) {
      parcelId = zrParcelIdFromResult(results[i]);
    }
    if (!track && results.length > 0) {
      const byRef = results.find((x) => referenceFromResult(x) === order.id);
      if (byRef) track = trackingFromResult(byRef);
    }
    if (!parcelId && results.length > 0) {
      const byRef = results.find((x) => referenceFromResult(x) === order.id);
      if (byRef) parcelId = zrParcelIdFromResult(byRef);
    }
    if (track) trackingByOrderId.set(order.id, track);
    if (parcelId) zrParcelIdByOrderId.set(order.id, parcelId);
  }

  const errors: string[] = [];
  let updated = 0;

  for (const order of list) {
    const tracking = trackingByOrderId.get(order.id) ?? "";
    const zrParcelId = zrParcelIdByOrderId.get(order.id);
    const row: Record<string, unknown> = {
      status: "follow",
      sub_status: "confirmed",
      delivery_company: company.name,
      tracking_number: tracking,
      shipping_status: tracking ? "zr_validated" : "zr_submitted",
    };
    if (zrParcelId) row.zr_parcel_id = zrParcelId;
    const { error: uErr } = await db.from("orders").update(row).eq("id", order.id);
    if (uErr) {
      errors.push(`${order.id}: ${uErr.message}`);
      continue;
    }
    updated += 1;
  }

  const successWarnings: string[] = [];
  if (results.length === 0) {
    successWarnings.push(
      "ZR response had no parcel array; check API payload/response shape in api/validate-shipment.ts"
    );
  }
  successWarnings.push(
    "Territories: using saved wilaya_territory_id and commune_territory_id on each order."
  );

  res.status(200).json({
    ok: true,
    updated,
    zrResultCount: results.length,
    zrAuthorizationVariant: zrAuthVariantDescription(zrAuthVariantUsed),
    zrXTenantId: xTenantId,
    zrTerritoryListSource: "zr_territories_search",
    zrHubCount: territoryByOrder.size,
    zrHubsSearchOk: true,
    zrTerritoryResolutionSummary: {
      orderCount: list.length,
      distinctWilayaCommuneKeys: new Set(
        list.map(
          (o) =>
            `${(o.wilaya ?? "").trim()}|||${(o.commune ?? "").trim()}`
        )
      ).size,
      territoryResolution: "live_zr_search",
    },
    warnings: successWarnings.length ? successWarnings : undefined,
    errors: errors.length ? errors : undefined,
  });
}
