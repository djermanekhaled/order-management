import {
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territory-resolve]";

export const cleanWilaya = (wilaya: string) =>
  wilaya.replace(/^\d+\s*[—-]\s*/, "").trim();

export function isZrTerritoryGuid(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v.trim()
  );
}

function asTerritoryId(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

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

/** First search hit: `id` from TerritoryResponse (OpenAPI). */
function firstResultId(items: Record<string, unknown>[]): string | null {
  const first = items[0];
  if (!first) return null;
  const id = asTerritoryId(first.id);
  return id && isZrTerritoryGuid(id) ? id : null;
}

async function postTerritoriesSearch(
  tenantId: string,
  body: Record<string, unknown>
): Promise<
  | { ok: true; items: Record<string, unknown>[] }
  | { ok: false; error: string }
> {
  const out = await zrRequestWithAuthVariants(
    "/territories/search",
    { method: "POST", body: JSON.stringify(body) },
    tenantId,
    { logPrefix: LOG_PREFIX }
  );
  if (!out.res.ok) {
    return {
      ok: false,
      error: zrExpressErrorMessage(out.res.status, out.json, out.text),
    };
  }
  return { ok: true, items: extractItemsArray(out.json) };
}

function bodyWilayaSearch(wilayaNameFromOrder: string): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 10,
    advancedSearch: {
      fields: ["name"],
      keyword: wilayaNameFromOrder,
    },
    advancedFilter: {
      filters: [
        { field: "level", operator: "eq", value: "wilaya" },
      ],
      logic: "and",
    },
  };
}

function bodyCommuneSearch(
  communeNameFromOrder: string,
  cityId: string
): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 10,
    advancedSearch: {
      fields: ["name"],
      keyword: communeNameFromOrder,
    },
    advancedFilter: {
      filters: [
        { field: "level", operator: "eq", value: "commune" },
        { field: "parentId", operator: "eq", value: cityId },
      ],
      logic: "and",
    },
  };
}

export type ResolveCityDistrictOk = {
  ok: true;
  cityTerritoryId: string;
  districtTerritoryId: string;
  citySearchResult: Record<string, unknown>[];
  districtSearchResult: Record<string, unknown>[];
};

function logTerritoryResolveReturn(result: unknown): void {
  console.log("TERRITORY RESOLVE RETURNING:", JSON.stringify(result));
}

/**
 * POST https://api.zrexpress.app/api/v1/territories/search with X-Api-Key + X-Tenant.
 * Wilaya: advancedSearch keyword + level eq wilaya → first item id = cityTerritoryId.
 * Commune: advancedSearch keyword + level eq commune + parentId eq cityId → first item id = districtTerritoryId.
 */
export async function resolveCityDistrictGuidsForOrder(
  wilaya: string,
  commune: string | null | undefined,
  tenantId: string
): Promise<ResolveCityDistrictOk | { ok: false; error: string }> {
  console.log(
    "TERRITORY RESOLVE CALLED - wilaya:",
    wilaya,
    "commune:",
    commune
  );
  console.log("TERRITORY RESOLVE - xTenantId:", tenantId);
  console.log(
    "TERRITORY RESOLVE - ZR_API_KEY exists:",
    !!process.env.ZR_API_KEY
  );

  const wilayaName = cleanWilaya(wilaya);
  console.log("DEBUG - territory search starting for wilaya:", wilayaName);

  const communeT = (commune ?? "").trim();
  if (!communeT) {
    const result = {
      ok: false as const,
      error: "Commune is required to resolve district territory.",
    };
    logTerritoryResolveReturn(result);
    return result;
  }
  if (!wilayaName) {
    const result = { ok: false as const, error: "Wilaya is empty." };
    logTerritoryResolveReturn(result);
    return result;
  }

  const wilayaRes = await postTerritoriesSearch(
    tenantId,
    bodyWilayaSearch(wilayaName)
  );
  if (wilayaRes.ok === false) {
    const result = {
      ok: false as const,
      error: `ZR territories/search (wilaya): ${wilayaRes.error}`,
    };
    logTerritoryResolveReturn(result);
    return result;
  }

  const citySearchResult = wilayaRes.items;
  const cityTerritoryId = firstResultId(citySearchResult);
  if (!cityTerritoryId) {
    const result = {
      ok: false as const,
      error: `No wilaya territory result for "${wilayaName}" (empty items or missing id).`,
    };
    logTerritoryResolveReturn(result);
    return result;
  }

  const communeRes = await postTerritoriesSearch(
    tenantId,
    bodyCommuneSearch(communeT, cityTerritoryId)
  );
  if (communeRes.ok === false) {
    const result = {
      ok: false as const,
      error: `ZR territories/search (commune): ${communeRes.error}`,
    };
    logTerritoryResolveReturn(result);
    return result;
  }

  const districtSearchResult = communeRes.items;
  const districtTerritoryId = firstResultId(districtSearchResult);
  if (!districtTerritoryId) {
    const result = {
      ok: false as const,
      error: `No commune territory result for "${communeT}" under wilaya territory ${cityTerritoryId} (empty items or missing id).`,
    };
    logTerritoryResolveReturn(result);
    return result;
  }

  const result: ResolveCityDistrictOk = {
    ok: true,
    cityTerritoryId,
    districtTerritoryId,
    citySearchResult,
    districtSearchResult,
  };
  logTerritoryResolveReturn(result);
  return result;
}
