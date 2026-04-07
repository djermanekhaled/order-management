import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ZR_BASE,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territories-sync]";

export type ZrDeliveryCompanyCredentials = {
  id: string;
  tenant_id: string;
  secret_key: string;
};

export type SyncZrTerritoriesOk = {
  ok: true;
  cityCount: number;
  districtCount: number;
  sources: string[];
  error: undefined;
  zrStep: undefined;
  zrStatus: undefined;
};

export type SyncZrTerritoriesErr = {
  ok: false;
  error: string;
  zrStep: string;
  zrStatus?: number;
  cityCount?: undefined;
  districtCount?: undefined;
  sources?: undefined;
};

export type SyncZrTerritoriesResult = SyncZrTerritoriesOk | SyncZrTerritoriesErr;

function normGeoKey(s: string): string {
  const t = s.trim().toLowerCase().replace(/\s+/g, " ");
  try {
    return t.normalize("NFD").replace(/\p{M}/gu, "");
  } catch {
    return t;
  }
}

function isGuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function asTerritoryId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Parse ZR response: primary `items` array (optional `data.items`). */
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

function pickTerritoryGuid(o: Record<string, unknown>): string | null {
  const candidates = [
    o.territory_id,
    o.territoryId,
    o.cityTerritoryId,
    o.districtTerritoryId,
    o.id,
  ];
  for (const c of candidates) {
    const s = asTerritoryId(c);
    if (s && isGuid(s)) return s;
  }
  return null;
}

function pickName(o: Record<string, unknown>): string | null {
  for (const k of [
    "name",
    "title",
    "label",
    "englishName",
    "communeName",
    "districtName",
  ]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

type UpsertRow = {
  company_id: string;
  territory_id: string;
  kind: "city" | "district";
  name: string;
  normalized_name: string;
  parent_city_territory_id: string | null;
  source: string;
};

function rowFromCityItem(
  companyId: string,
  item: Record<string, unknown>
): UpsertRow | null {
  const territory_id = pickTerritoryGuid(item);
  const name = pickName(item);
  if (!territory_id || !name) return null;
  const normalizedRaw = item.normalized_name;
  const normalized_name =
    typeof normalizedRaw === "string" && normalizedRaw.trim()
      ? normalizedRaw.trim()
      : normGeoKey(name);
  return {
    company_id: companyId,
    territory_id,
    kind: "city",
    name,
    normalized_name,
    parent_city_territory_id: null,
    source: "zr_territories_api",
  };
}

function rowFromDistrictItem(
  companyId: string,
  item: Record<string, unknown>
): UpsertRow | null {
  const territory_id = pickTerritoryGuid(item);
  const name = pickName(item);
  if (!territory_id || !name) return null;
  const normalizedRaw = item.normalized_name;
  const normalized_name =
    typeof normalizedRaw === "string" && normalizedRaw.trim()
      ? normalizedRaw.trim()
      : normGeoKey(name);
  const parentRaw =
    item.parent_city_territory_id ??
    item.cityTerritoryId ??
    item.parentCityTerritoryId;
  const parent = asTerritoryId(parentRaw);
  return {
    company_id: companyId,
    territory_id,
    kind: "district",
    name,
    normalized_name,
    parent_city_territory_id: parent && isGuid(parent) ? parent : null,
    source: "zr_territories_api",
  };
}

async function getZrTerritoryList(
  kind: "cities" | "districts",
  companyId: string,
  tenantId: string,
  secretKey: string
): Promise<
  | { ok: true; items: Record<string, unknown>[] }
  | { ok: false; error: string; zrStatus: number; zrStep: string }
> {
  const url = `${ZR_BASE}/api/v1/territories/${kind}?company_id=${encodeURIComponent(companyId)}`;
  const out = await zrRequestWithAuthVariants(
    url,
    { method: "GET" },
    tenantId,
    secretKey,
    { logPrefix: LOG_PREFIX }
  );
  if (!out.res.ok) {
    return {
      ok: false,
      error: zrExpressErrorMessage(out.res.status, out.json, out.text),
      zrStatus: out.res.status,
      zrStep: `territories_${kind}`,
    };
  }
  const items = extractItemsArray(out.json);
  console.log(
    `${LOG_PREFIX} GET /api/v1/territories/${kind}?company_id=… → ${items.length} item(s)`
  );
  return { ok: true, items };
}

export async function syncZrTerritoriesForCompany(
  db: SupabaseClient,
  company: ZrDeliveryCompanyCredentials
): Promise<SyncZrTerritoriesResult> {
  const tenantId = company.tenant_id.trim();
  const zrCompanyId = company.id;

  const citiesRes = await getZrTerritoryList(
    "cities",
    zrCompanyId,
    tenantId,
    company.secret_key
  );
  if (!citiesRes.ok) {
    return {
      ok: false,
      error: citiesRes.error,
      zrStep: citiesRes.zrStep,
      zrStatus: citiesRes.zrStatus,
    };
  }

  const districtsRes = await getZrTerritoryList(
    "districts",
    zrCompanyId,
    tenantId,
    company.secret_key
  );
  if (!districtsRes.ok) {
    return {
      ok: false,
      error: districtsRes.error,
      zrStep: districtsRes.zrStep,
      zrStatus: districtsRes.zrStatus,
    };
  }

  const cityRows = new Map<string, UpsertRow>();
  for (const item of citiesRes.items) {
    const row = rowFromCityItem(zrCompanyId, item);
    if (row) cityRows.set(row.territory_id, row);
  }

  const districtRows = new Map<string, UpsertRow>();
  for (const item of districtsRes.items) {
    const row = rowFromDistrictItem(zrCompanyId, item);
    if (row) districtRows.set(row.territory_id, row);
  }

  const toUpsert = [...cityRows.values(), ...districtRows.values()];
  if (toUpsert.length === 0) {
    return {
      ok: false,
      error:
        "ZR territories sync returned no rows: empty or unparsable `items` from GET /api/v1/territories/cities and GET /api/v1/territories/districts.",
      zrStep: "territory_sync_empty",
    };
  }

  const { error: territoryUpsertErr } = await db
    .from("zr_territories")
    .upsert(toUpsert, { onConflict: "company_id,territory_id,kind" });

  if (territoryUpsertErr) {
    return {
      ok: false,
      error: `Failed to persist ZR territories in Supabase: ${territoryUpsertErr.message}`,
      zrStep: "territory_sync_store",
    };
  }

  return {
    ok: true,
    error: undefined,
    zrStep: undefined,
    zrStatus: undefined,
    cityCount: cityRows.size,
    districtCount: districtRows.size,
    sources: [
      "GET /api/v1/territories/cities",
      "GET /api/v1/territories/districts",
    ],
  };
}
