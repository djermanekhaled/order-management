import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ZR_BASE,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territories-sync]";

/** Documented as POST /api/v{version}/territories/search (OpenAPI at api.zrexpress.app/swagger/v1/swagger.json). */
const ZR_TERRITORIES_SEARCH_PATH = "/api/v1/territories/search";

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
};

export type SyncZrTerritoriesErr = {
  ok: false;
  error: string;
  zrStep: string;
  zrStatus?: number;
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

function extractHasNext(zrJson: unknown): boolean | undefined {
  if (zrJson == null || typeof zrJson !== "object" || Array.isArray(zrJson)) {
    return undefined;
  }
  const o = zrJson as Record<string, unknown>;
  const v = o.hasNext;
  return typeof v === "boolean" ? v : undefined;
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
    item.parentCityTerritoryId ??
    item.parentId ??
    item.parent_id;
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

/** TerritoryResponse.level (OpenAPI); distinguishes wilaya/city vs commune/district when parentId alone is ambiguous. */
function territoryKindFromItem(
  item: Record<string, unknown>
): "city" | "district" | null {
  const raw = item.level;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const L = raw.trim().toLowerCase();
  if (
    L === "district" ||
    L.includes("district") ||
    L.includes("commune") ||
    L.includes("daira") ||
    L.includes("daïra")
  ) {
    return "district";
  }
  if (
    L === "city" ||
    L.includes("wilaya") ||
    L.includes("city") ||
    L.includes("province")
  ) {
    return "city";
  }
  return null;
}

function upsertRowFromTerritoryItem(
  companyId: string,
  item: Record<string, unknown>
): UpsertRow | null {
  const byLevel = territoryKindFromItem(item);
  if (byLevel === "city") return rowFromCityItem(companyId, item);
  if (byLevel === "district") return rowFromDistrictItem(companyId, item);

  const parent = asTerritoryId(item.parentId ?? item.parent_id);
  if (!parent || !isGuid(parent)) {
    return rowFromCityItem(companyId, item);
  }
  return rowFromDistrictItem(companyId, item);
}

type TerritorySearchFailure = {
  ok: false;
  error: string;
  zrStatus: number;
  zrStep: string;
};

type TerritorySearchSuccess = {
  ok: true;
  items: Record<string, unknown>[];
};

async function fetchTerritoriesViaSearch(
  tenantId: string,
  secretKey: string
): Promise<TerritorySearchSuccess | TerritorySearchFailure> {
  const url = `${ZR_BASE}${ZR_TERRITORIES_SEARCH_PATH}`;
  const pageSize = 1000;
  const all: Record<string, unknown>[] = [];
  let pageNumber = 1;
  let hasNext: boolean | undefined = true;

  while (hasNext !== false && pageNumber <= 500) {
    const body = JSON.stringify({ pageNumber, pageSize });
    const out = await zrRequestWithAuthVariants(
      url,
      { method: "POST", body },
      tenantId,
      secretKey,
      { logPrefix: LOG_PREFIX }
    );
    if (!out.res.ok) {
      return {
        ok: false,
        error: zrExpressErrorMessage(out.res.status, out.json, out.text),
        zrStatus: out.res.status,
        zrStep: "territories_search",
      };
    }
    const items = extractItemsArray(out.json);
    for (const it of items) {
      all.push(it);
    }
    const nextFromApi = extractHasNext(out.json);
    if (nextFromApi !== undefined) {
      hasNext = nextFromApi;
    } else {
      hasNext = items.length >= pageSize;
    }
    console.log(
      `${LOG_PREFIX} POST ${ZR_TERRITORIES_SEARCH_PATH} page=${pageNumber} pageSize=${pageSize} → ${items.length} item(s), hasNext=${String(hasNext)}`
    );
    if (!hasNext) break;
    pageNumber += 1;
  }

  return { ok: true, items: all };
}

export async function syncZrTerritoriesForCompany(
  db: SupabaseClient,
  company: ZrDeliveryCompanyCredentials
): Promise<SyncZrTerritoriesResult> {
  const tenantId = company.tenant_id.trim();
  const zrCompanyId = company.id;

  const searchRes = await fetchTerritoriesViaSearch(
    tenantId,
    company.secret_key
  );
  if (!searchRes.ok) {
    return {
      ok: false,
      error: searchRes.error,
      zrStep: searchRes.zrStep,
      zrStatus: searchRes.zrStatus,
    };
  }

  const cityRows = new Map<string, UpsertRow>();
  const districtRows = new Map<string, UpsertRow>();

  for (const item of searchRes.items) {
    const row = upsertRowFromTerritoryItem(zrCompanyId, item);
    if (!row) continue;
    if (row.kind === "city") {
      cityRows.set(row.territory_id, row);
    } else {
      districtRows.set(row.territory_id, row);
    }
  }

  const toUpsert = [...cityRows.values(), ...districtRows.values()];
  if (toUpsert.length === 0) {
    return {
      ok: false,
      error:
        `ZR territories sync returned no rows: empty or unparsable \`items\` from POST ${ZR_TERRITORIES_SEARCH_PATH}.`,
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
    cityCount: cityRows.size,
    districtCount: districtRows.size,
    sources: [`POST ${ZR_TERRITORIES_SEARCH_PATH}`],
  };
}
