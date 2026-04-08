import {
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territory-resolve]";

export const cleanWilaya = (wilaya: string) =>
  wilaya.replace(/^\d+\s*[—-]\s*/, "").trim();

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
  return id && isGuid(id) ? id : null;
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
  const communeT = (commune ?? "").trim();
  if (!communeT) {
    return { ok: false, error: "Commune is required to resolve district territory." };
  }
  const wilayaNameFromOrder = cleanWilaya(wilaya);
  if (!wilayaNameFromOrder) {
    return { ok: false, error: "Wilaya is empty." };
  }

  const wilayaRes = await postTerritoriesSearch(
    tenantId,
    bodyWilayaSearch(wilayaNameFromOrder)
  );
  if (!wilayaRes.ok) {
    return {
      ok: false,
      error: `ZR territories/search (wilaya): ${wilayaRes.error}`,
    };
  }

  const citySearchResult = wilayaRes.items;
  const cityTerritoryId = firstResultId(citySearchResult);
  if (!cityTerritoryId) {
    return {
      ok: false,
      error: `No wilaya territory result for "${wilayaNameFromOrder}" (empty items or missing id).`,
    };
  }

  const communeRes = await postTerritoriesSearch(
    tenantId,
    bodyCommuneSearch(communeT, cityTerritoryId)
  );
  if (!communeRes.ok) {
    return {
      ok: false,
      error: `ZR territories/search (commune): ${communeRes.error}`,
    };
  }

  const districtSearchResult = communeRes.items;
  const districtTerritoryId = firstResultId(districtSearchResult);
  if (!districtTerritoryId) {
    return {
      ok: false,
      error: `No commune territory result for "${communeT}" under wilaya territory ${cityTerritoryId} (empty items or missing id).`,
    };
  }

  return {
    ok: true,
    cityTerritoryId,
    districtTerritoryId,
    citySearchResult,
    districtSearchResult,
  };
}
