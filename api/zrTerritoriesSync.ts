import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ZR_BASE,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territories-sync]";

const HUB_PAGE_SIZE = 500;
const MAX_HUB_PAGES = 80;

export type ZrDeliveryCompanyCredentials = {
  id: string;
  tenant_id: string;
  secret_key: string;
};

export type SyncZrTerritoriesOk = {
  ok: true;
  cityCount: number;
  districtCount: number;
  hubPages: number;
  hubRecords: number;
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

function hubAddressCity(hub: Record<string, unknown>): string {
  const addr = hub.address;
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    const c = (addr as Record<string, unknown>).city;
    if (typeof c === "string") return c;
  }
  return "";
}

function hubCityTerritoryId(hub: Record<string, unknown>): string | null {
  return asTerritoryId(
    hub.cityTerritoryId ?? hub.city_territory_id ?? hub.cityTerritoryID
  );
}

function hubDistrictTerritoryId(hub: Record<string, unknown>): string | null {
  return asTerritoryId(
    hub.districtTerritoryId ??
      hub.district_territory_id ??
      hub.districtTerritoryID
  );
}

function hubCommuneLabels(hub: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const k of ["name", "title", "label", "districtName", "district", "commune"]) {
    const v = hub[k];
    if (typeof v === "string" && v.trim()) out.push(v.trim());
  }
  const addr = hub.address;
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    const a = addr as Record<string, unknown>;
    for (const k of ["district", "commune", "municipality"]) {
      const v = a[k];
      if (typeof v === "string" && v.trim()) out.push(v.trim());
    }
  }
  return [...new Set(out)];
}

function pickDistrictName(hub: Record<string, unknown>): string | null {
  const labels = hubCommuneLabels(hub);
  if (!labels.length) return null;
  return labels[0];
}

/** Hubs from POST /api/v1/hubs/search */
function extractHubsArray(zrJson: unknown): Record<string, unknown>[] {
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
  for (const k of ["hubs", "data", "results", "items"]) {
    const inner = tryArr(o[k]);
    if (inner !== null) return inner;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of ["hubs", "items", "results"]) {
      const inner = tryArr(d[k]);
      if (inner !== null) return inner;
    }
  }
  return [];
}

function extractGenericObjectArray(zrJson: unknown): Record<string, unknown>[] {
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
  for (const k of [
    "territories",
    "cities",
    "districts",
    "data",
    "results",
    "items",
  ]) {
    const inner = tryArr(o[k]);
    if (inner !== null) return inner;
  }
  const data = o.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const k of ["territories", "cities", "districts", "items", "results"]) {
      const inner = tryArr(d[k]);
      if (inner !== null) return inner;
    }
  }
  return [];
}

function pickGuidFromTerritoryRow(o: Record<string, unknown>): string | null {
  const candidates = [
    o.cityTerritoryId,
    o.districtTerritoryId,
    o.territoryId,
    o.territory_id,
    o.id,
  ];
  for (const c of candidates) {
    const s = asTerritoryId(c);
    if (s && isGuid(s)) return s;
  }
  return null;
}

function pickNameFromTerritoryRow(o: Record<string, unknown>): string | null {
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

async function fetchAllHubsPaginated(
  tenantId: string,
  secretKey: string
): Promise<
  | { ok: true; hubs: Record<string, unknown>[]; pages: number }
  | { ok: false; error: string; zrStatus: number; zrStep: string }
> {
  const hubsSearchUrl = `${ZR_BASE}/api/v1/hubs/search`;
  const all: Record<string, unknown>[] = [];
  let page = 1;

  for (;;) {
    const hubsSearchBody = JSON.stringify({
      pageNumber: page,
      pageSize: HUB_PAGE_SIZE,
    });
    const hubsOut = await zrRequestWithAuthVariants(
      hubsSearchUrl,
      { method: "POST", body: hubsSearchBody },
      tenantId,
      secretKey,
      { logPrefix: LOG_PREFIX }
    );
    if (!hubsOut.res.ok) {
      return {
        ok: false,
        error: zrExpressErrorMessage(
          hubsOut.res.status,
          hubsOut.json,
          hubsOut.text
        ),
        zrStatus: hubsOut.res.status,
        zrStep: "hubs_search",
      };
    }
    const batch = extractHubsArray(hubsOut.json);
    all.push(...batch);
    console.log(
      `${LOG_PREFIX} hubs/search page ${page} → ${batch.length} record(s); total ${all.length}`
    );
    if (batch.length < HUB_PAGE_SIZE) break;
    page += 1;
    if (page > MAX_HUB_PAGES) {
      console.warn(`${LOG_PREFIX} hubs/search stopped at max pages (${MAX_HUB_PAGES})`);
      break;
    }
  }

  return { ok: true, hubs: all, pages: page };
}

function rowsFromHubList(
  companyId: string,
  hubList: Record<string, unknown>[]
): { cityRows: Map<string, UpsertRow>; districtRows: Map<string, UpsertRow> } {
  const cityRowsById = new Map<string, UpsertRow>();
  const districtRowsById = new Map<string, UpsertRow>();

  for (const hub of hubList) {
    const cityId = hubCityTerritoryId(hub);
    const cityNameRaw = hubAddressCity(hub);
    if (cityId && isGuid(cityId) && cityNameRaw.trim()) {
      cityRowsById.set(cityId, {
        company_id: companyId,
        territory_id: cityId,
        kind: "city",
        name: cityNameRaw.trim(),
        normalized_name: normGeoKey(cityNameRaw),
        parent_city_territory_id: null,
        source: "hubs_search",
      });
    }
    const districtId = hubDistrictTerritoryId(hub);
    const districtName = pickDistrictName(hub);
    if (
      districtId &&
      isGuid(districtId) &&
      districtName &&
      districtName.trim() &&
      cityId &&
      isGuid(cityId)
    ) {
      districtRowsById.set(districtId, {
        company_id: companyId,
        territory_id: districtId,
        kind: "district",
        name: districtName.trim(),
        normalized_name: normGeoKey(districtName),
        parent_city_territory_id: cityId,
        source: "hubs_search",
      });
    }
  }
  return { cityRows: cityRowsById, districtRows: districtRowsById };
}

/**
 * Optional: merge cities/districts from ZR territory endpoints if available (varies by API version).
 */
async function tryMergeTerritoryEndpointRows(
  companyId: string,
  tenantId: string,
  secretKey: string,
  cityRows: Map<string, UpsertRow>,
  districtRows: Map<string, UpsertRow>
): Promise<string[]> {
  const sources: string[] = [];
  const cityEndpoints: { method: "GET" | "POST"; url: string; body?: string }[] = [
    { method: "GET", url: `${ZR_BASE}/api/v1/territories/cities` },
    {
      method: "POST",
      url: `${ZR_BASE}/api/v1/territories/cities/search`,
      body: JSON.stringify({ pageNumber: 1, pageSize: 5000 }),
    },
    {
      method: "POST",
      url: `${ZR_BASE}/api/v1/territories/cities`,
      body: JSON.stringify({ pageNumber: 1, pageSize: 5000 }),
    },
  ];

  let cityList: Record<string, unknown>[] = [];
  for (const ep of cityEndpoints) {
    const out = await zrRequestWithAuthVariants(
      ep.url,
      { method: ep.method, body: ep.body },
      tenantId,
      secretKey,
      { logPrefix: LOG_PREFIX }
    );
    if (!out.res.ok) continue;
    const arr = extractGenericObjectArray(out.json);
    if (arr.length > 0) {
      cityList = arr;
      sources.push(`territory_cities:${ep.method} ${ep.url}`);
      console.log(
        `${LOG_PREFIX} territory cities endpoint returned ${arr.length} row(s)`
      );
      break;
    }
  }

  for (const row of cityList) {
    const id = pickGuidFromTerritoryRow(row);
    const name = pickNameFromTerritoryRow(row);
    if (!id || !name) continue;
    cityRows.set(id, {
      company_id: companyId,
      territory_id: id,
      kind: "city",
      name,
      normalized_name: normGeoKey(name),
      parent_city_territory_id: null,
      source: "territories_api",
    });
  }

  /** Avoid hundreds of sequential calls (hubs may already supply districts). */
  const MAX_CITY_DISTRICT_FETCHES = 120;
  let districtFetchCount = 0;

  for (const cityId of cityRows.keys()) {
    if (!isGuid(cityId)) continue;
    if (districtFetchCount >= MAX_CITY_DISTRICT_FETCHES) {
      console.warn(
        `${LOG_PREFIX} territory districts: stopped after ${MAX_CITY_DISTRICT_FETCHES} city lookups (remaining cities use hub data only)`
      );
      break;
    }
    districtFetchCount += 1;
    const districtEndpoints: { method: "GET" | "POST"; url: string; body?: string }[] = [
      {
        method: "GET",
        url: `${ZR_BASE}/api/v1/territories/districts?cityTerritoryId=${encodeURIComponent(cityId)}`,
      },
      {
        method: "POST",
        url: `${ZR_BASE}/api/v1/territories/districts/search`,
        body: JSON.stringify({
          cityTerritoryId: cityId,
          pageNumber: 1,
          pageSize: 5000,
        }),
      },
    ];

    for (const ep of districtEndpoints) {
      const out = await zrRequestWithAuthVariants(
        ep.url,
        { method: ep.method, body: ep.body },
        tenantId,
        secretKey,
        { logPrefix: LOG_PREFIX }
      );
      if (!out.res.ok) continue;
      const arr = extractGenericObjectArray(out.json);
      if (arr.length === 0) continue;
      sources.push(`territory_districts:${ep.method} for city ${cityId}`);
      for (const row of arr) {
        const did = pickGuidFromTerritoryRow(row);
        const name = pickNameFromTerritoryRow(row);
        const parent =
          asTerritoryId(row.parentCityTerritoryId ?? row.cityTerritoryId) ?? cityId;
        if (!did || !name || !parent || !isGuid(parent)) continue;
        districtRows.set(did, {
          company_id: companyId,
          territory_id: did,
          kind: "district",
          name,
          normalized_name: normGeoKey(name),
          parent_city_territory_id: parent,
          source: "territories_api",
        });
      }
      break;
    }
  }

  return sources;
}

export async function syncZrTerritoriesForCompany(
  db: SupabaseClient,
  company: ZrDeliveryCompanyCredentials
): Promise<SyncZrTerritoriesResult> {
  const tenantId = company.tenant_id.trim();
  const hubFetch = await fetchAllHubsPaginated(tenantId, company.secret_key);
  if (!hubFetch.ok) {
    return {
      ok: false,
      error: hubFetch.error,
      zrStep: hubFetch.zrStep,
      zrStatus: hubFetch.zrStatus,
    };
  }

  const fromHubs = rowsFromHubList(company.id, hubFetch.hubs);
  const cityRows = fromHubs.cityRows;
  const districtRows = fromHubs.districtRows;

  let extraSources: string[] = [];
  try {
    extraSources = await tryMergeTerritoryEndpointRows(
      company.id,
      tenantId,
      company.secret_key,
      cityRows,
      districtRows
    );
  } catch (e) {
    console.warn(
      `${LOG_PREFIX} optional territories API merge failed (non-fatal):`,
      e instanceof Error ? e.message : e
    );
  }

  const toUpsert = [...cityRows.values(), ...districtRows.values()];
  if (toUpsert.length === 0) {
    return {
      ok: false,
      error:
        "No ZR territory rows could be built from hubs/search (empty hub list or missing territory IDs).",
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

  const sources = [`hubs_search:${hubFetch.pages} page(s)`].concat(extraSources);

  return {
    ok: true,
    cityCount: cityRows.size,
    districtCount: districtRows.size,
    hubPages: hubFetch.pages,
    hubRecords: hubFetch.hubs.length,
    sources,
  };
}
