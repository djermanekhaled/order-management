import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  ZR_BASE,
  type ZrAuthVariant,
  zrAuthVariantDescription,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";
import { syncZrTerritoriesForCompany } from "./zrTerritoriesSync.js";

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

function normGeoKey(s: string): string {
  const t = s.trim().toLowerCase().replace(/\s+/g, " ");
  try {
    return t.normalize("NFD").replace(/\p{M}/gu, "");
  } catch {
    return t;
  }
}

/** Wilaya option label is often "16 — Alger"; hub `address.city` is usually the city name. */
function primaryWilayaName(wilaya: string): string {
  const t = wilaya.trim();
  const m = t.match(/[—–-]\s*(.+)$/u);
  if (m?.[1]) return normGeoKey(m[1].trim());
  return normGeoKey(t);
}

type StoredTerritory = {
  territory_id: string;
  kind: "city" | "district";
  name: string;
  normalized_name: string;
  parent_city_territory_id: string | null;
};

/**
 * Match order wilaya text to a ZR city row (same data as POST /api/v1/territories/search).
 * Compares against both `name` and `normalized_name`.
 */
function wilayaMatchesCityRow(
  wilaya: string,
  row: Pick<StoredTerritory, "name" | "normalized_name">
): boolean {
  const wPrimary = primaryWilayaName(wilaya);
  const wFull = normGeoKey(wilaya);
  const orderKeys = [...new Set([wPrimary, wFull].filter(Boolean))];
  const rowNameN = normGeoKey(row.name);
  const rowNorm = row.normalized_name.trim();
  for (const key of orderKeys) {
    if (!key) continue;
    for (const cell of [rowNameN, rowNorm]) {
      if (!cell) continue;
      if (cell === key || cell.includes(key) || key.includes(cell)) return true;
    }
  }
  return false;
}

function scoreCityMatch(
  wilaya: string,
  row: Pick<StoredTerritory, "name" | "normalized_name">
): number {
  const wPrimary = primaryWilayaName(wilaya);
  const wFull = normGeoKey(wilaya);
  const rowNameN = normGeoKey(row.name);
  const rowNorm = row.normalized_name.trim();
  if (rowNorm && (rowNorm === wPrimary || rowNorm === wFull)) return 100;
  if (rowNameN && (rowNameN === wPrimary || rowNameN === wFull)) return 95;
  if (rowNorm && (wPrimary.includes(rowNorm) || rowNorm.includes(wPrimary)))
    return 70;
  if (rowNameN && (wPrimary.includes(rowNameN) || rowNameN.includes(wPrimary)))
    return 65;
  return 10;
}

function pickBestCityForWilaya(
  cities: StoredTerritory[],
  wilaya: string
): StoredTerritory | null {
  const matches = cities.filter((c) => wilayaMatchesCityRow(wilaya, c));
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => scoreCityMatch(wilaya, b) - scoreCityMatch(wilaya, a)
  );
  return matches[0] ?? null;
}

/**
 * Match order commune to a ZR district row scoped to the city (same as
 * POST /api/v1/territories/search + Supabase parent_city_territory_id).
 * Compares against both `name` and `normalized_name`.
 */
function communeMatchesDistrictRow(
  commune: string,
  row: Pick<StoredTerritory, "name" | "normalized_name">
): boolean {
  const c = normGeoKey(commune ?? "");
  if (!c) return false;
  const rowNameN = normGeoKey(row.name);
  const rowNorm = row.normalized_name.trim();
  for (const cell of [rowNameN, rowNorm]) {
    if (!cell) continue;
    if (cell === c || cell.includes(c) || c.includes(cell)) return true;
  }
  return false;
}

function scoreDistrictMatch(
  commune: string,
  row: Pick<StoredTerritory, "name" | "normalized_name">
): number {
  const c = normGeoKey(commune ?? "");
  if (!c) return 0;
  const rowNameN = normGeoKey(row.name);
  const rowNorm = row.normalized_name.trim();
  if (rowNorm === c) return 100;
  if (rowNameN === c) return 95;
  if (rowNorm && (rowNorm.includes(c) || c.includes(rowNorm))) return 70;
  if (rowNameN && (rowNameN.includes(c) || c.includes(rowNameN))) return 65;
  return 10;
}

function pickBestDistrictForCommune(
  districtsForCity: StoredTerritory[],
  commune: string
): StoredTerritory | null {
  const matches = districtsForCity.filter((d) =>
    communeMatchesDistrictRow(commune, d)
  );
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => scoreDistrictMatch(commune, b) - scoreDistrictMatch(commune, a)
  );
  return matches[0] ?? null;
}

/**
 * Resolve GUIDs like rows from POST /api/v1/territories/search (cities vs districts)
 * with city_territory_id (in-process; same Supabase queries / rows).
 */
function mapTerritoriesFromStore(
  rows: StoredTerritory[],
  wilaya: string,
  commune: string
): { cityTerritoryId: string | null; districtTerritoryId: string | null } {
  const cities = rows
    .filter((r) => r.kind === "city")
    .sort((a, b) => a.name.localeCompare(b.name));
  const city = pickBestCityForWilaya(cities, wilaya);
  if (!city) {
    return { cityTerritoryId: null, districtTerritoryId: null };
  }

  const communeKey = normGeoKey(commune ?? "");
  if (!communeKey) {
    return { cityTerritoryId: city.territory_id, districtTerritoryId: null };
  }

  const districtsForCity = rows.filter(
    (r) =>
      r.kind === "district" &&
      r.parent_city_territory_id === city.territory_id
  );
  const district = pickBestDistrictForCommune(districtsForCity, commune);
  return {
    cityTerritoryId: city.territory_id,
    districtTerritoryId: district?.territory_id ?? null,
  };
}

/** Products array from POST /api/v1/products/search or similar. */
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
    cityTerritoryId: territory.cityTerritoryId,
    districtTerritoryId: territory.districtTerritoryId,
    deliveryAddress: {
      street: order.address || "",
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
  xTenantId: string,
  secretKey: string
): Promise<{ productId: string; sku: string; source: "search" | "created" }> {
  const keyword = productName.trim();
  if (!keyword) {
    throw new Error("Product name is empty");
  }

  const searchUrl = `${ZR_BASE}/api/v1/products/search`;
  const searchBody = JSON.stringify({ keyword, pageSize: 10 });
  const searchOut = await zrRequestWithAuthVariants(
    searchUrl,
    { method: "POST", body: searchBody },
    xTenantId,
    secretKey
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
  const createUrl = `${ZR_BASE}/api/v1/products`;
  const createBody = JSON.stringify({
    name: keyword,
    sku: skuNew,
    unitPrice: Number(unitPrice),
    stockType: "local",
  });
  const createOut = await zrRequestWithAuthVariants(
    createUrl,
    { method: "POST", body: createBody },
    xTenantId,
    secretKey
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
      "id, customer_name, phone, wilaya, commune, address, product, quantity, amount, status, sub_status, delivery_type"
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

  const syncResult = await syncZrTerritoriesForCompany(db, {
    id: company.id,
    tenant_id: xTenantId,
    secret_key: company.secret_key,
  });
  if (!syncResult.ok) {
    res.status(syncResult.zrStatus && syncResult.zrStatus >= 400 ? 502 : 500).json({
      error: `Failed to sync ZR territories: ${syncResult.error}`,
      zrStep: syncResult.zrStep,
      zrStatus: syncResult.zrStatus,
    });
    return;
  }

  async function loadStoredTerritories(): Promise<StoredTerritory[]> {
    const { data: storedTerritories, error: territoryReadErr } = await db
      .from("zr_territories")
      .select("territory_id, kind, name, normalized_name, parent_city_territory_id")
      .eq("company_id", company.id)
      .order("name", { ascending: true });
    if (territoryReadErr) {
      throw new Error(territoryReadErr.message);
    }
    return (storedTerritories ?? []) as StoredTerritory[];
  }

  async function mapOrdersToTerritories(rows: StoredTerritory[]) {
    const territoryByOrder = new Map<
      string,
      { cityTerritoryId: string; districtTerritoryId: string }
    >();
    const mappingErrors: string[] = [];
    for (const order of list) {
      const mapped = mapTerritoriesFromStore(
        rows,
        order.wilaya ?? "",
        order.commune ?? ""
      );
      if (!mapped.cityTerritoryId) {
        mappingErrors.push(
          `Order ${order.id}: no CityTerritoryId mapping for wilaya "${order.wilaya}".`
        );
        continue;
      }
      if (!mapped.districtTerritoryId) {
        mappingErrors.push(
          `Order ${order.id}: no DistrictTerritoryId mapping for commune "${order.commune ?? ""}" (wilaya "${order.wilaya}").`
        );
        continue;
      }
      territoryByOrder.set(order.id, {
        cityTerritoryId: mapped.cityTerritoryId,
        districtTerritoryId: mapped.districtTerritoryId,
      });
    }
    return { territoryByOrder, mappingErrors };
  }

  let mappedRows: StoredTerritory[];
  try {
    mappedRows = await loadStoredTerritories();
  } catch (e) {
    res.status(500).json({
      error: `Failed to read ZR territories from Supabase: ${e instanceof Error ? e.message : String(e)}`,
      zrStep: "territory_read_store",
    });
    return;
  }
  if (mappedRows.length === 0) {
    res.status(400).json({
      error:
        "ZR territories are empty. Sync could not find any city/district data from ZR Express for this account.",
      zrStep: "territory_mapping",
    });
    return;
  }

  let { territoryByOrder, mappingErrors } = await mapOrdersToTerritories(mappedRows);

  if (mappingErrors.length > 0) {
    // Retry once after a fresh full sync to capture newly available territories.
    const retrySync = await syncZrTerritoriesForCompany(db, {
      id: company.id,
      tenant_id: xTenantId,
      secret_key: company.secret_key,
    });
    if (retrySync.ok) {
      try {
        mappedRows = await loadStoredTerritories();
        ({ territoryByOrder, mappingErrors } = await mapOrdersToTerritories(
          mappedRows
        ));
      } catch {
        // keep original mapping errors
      }
    }
  }

  if (mappingErrors.length > 0) {
    res.status(400).json({
      error:
        "Shipment validation failed: missing territory mapping for one or more orders. Please fix Wilaya/Commune values or sync ZR territories.",
      details: mappingErrors,
      zrStep: "territory_mapping",
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
        xTenantId,
        company.secret_key
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

  const parcels = list.map((order) => {
    const kw = order.product.trim();
    const zrProd = zrProductCacheByKeyword.get(kw)!;
    return buildZrParcel(
      order,
      territoryByOrder.get(order.id)!,
      zrProd
    );
  });
  const zrUrl = `${ZR_BASE}/api/v1/parcels/bulk`;
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

  const successWarnings: string[] = [];
  if (results.length === 0) {
    successWarnings.push(
      "ZR response had no parcel array; check API payload/response shape in api/validate-shipment.ts"
    );
  }
  successWarnings.push(
    `Territories synced: ${syncResult.cityCount} cities, ${syncResult.districtCount} districts (ZR POST /api/v1/territories/search).`
  );

  res.status(200).json({
    ok: true,
    updated,
    zrResultCount: results.length,
    zrAuthorizationVariant: zrAuthVariantDescription(zrAuthVariantUsed),
    zrXTenantId: xTenantId,
    zrTerritoryListSource: "zr_territories",
    zrHubCount: syncResult.cityCount + syncResult.districtCount,
    zrHubsSearchOk: true,
    zrTerritoryResolutionSummary: {
      orderCount: list.length,
      cityCount: syncResult.cityCount,
      districtCount: syncResult.districtCount,
      territorySyncSources: syncResult.sources,
    },
    warnings: successWarnings.length ? successWarnings : undefined,
    errors: errors.length ? errors : undefined,
  });
}
