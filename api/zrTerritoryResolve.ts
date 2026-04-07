import {
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

const LOG_PREFIX = "[zr-territory-resolve]";

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

type ParsedTerritory = {
  territory_id: string;
  kind: "city" | "district";
  name: string;
  normalized_name: string;
  parent_city_territory_id: string | null;
};

function rowFromCityItem(item: Record<string, unknown>): ParsedTerritory | null {
  const territory_id = pickTerritoryGuid(item);
  const name = pickName(item);
  if (!territory_id || !name) return null;
  const normalizedRaw = item.normalized_name;
  const normalized_name =
    typeof normalizedRaw === "string" && normalizedRaw.trim()
      ? normalizedRaw.trim()
      : normGeoKey(name);
  return {
    territory_id,
    kind: "city",
    name,
    normalized_name,
    parent_city_territory_id: null,
  };
}

function rowFromDistrictItem(item: Record<string, unknown>): ParsedTerritory | null {
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
    territory_id,
    kind: "district",
    name,
    normalized_name,
    parent_city_territory_id: parent && isGuid(parent) ? parent : null,
  };
}

function territoryKindFromItem(item: Record<string, unknown>): "city" | "district" | null {
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

function parseTerritoryItem(item: Record<string, unknown>): ParsedTerritory | null {
  const byLevel = territoryKindFromItem(item);
  if (byLevel === "city") return rowFromCityItem(item);
  if (byLevel === "district") return rowFromDistrictItem(item);

  const parent = asTerritoryId(item.parentId ?? item.parent_id);
  if (!parent || !isGuid(parent)) {
    return rowFromCityItem(item);
  }
  return rowFromDistrictItem(item);
}

function wilayaMatchesCityRow(
  wilaya: string,
  row: Pick<ParsedTerritory, "name" | "normalized_name">
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
  row: Pick<ParsedTerritory, "name" | "normalized_name">
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
  cities: ParsedTerritory[],
  wilaya: string
): ParsedTerritory | null {
  const matches = cities.filter((c) => wilayaMatchesCityRow(wilaya, c));
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => scoreCityMatch(wilaya, b) - scoreCityMatch(wilaya, a)
  );
  return matches[0] ?? null;
}

function communeMatchesDistrictRow(
  commune: string,
  row: Pick<ParsedTerritory, "name" | "normalized_name">
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
  row: Pick<ParsedTerritory, "name" | "normalized_name">
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
  districtsForCity: ParsedTerritory[],
  commune: string
): ParsedTerritory | null {
  const matches = districtsForCity.filter((d) =>
    communeMatchesDistrictRow(commune, d)
  );
  if (matches.length === 0) return null;
  matches.sort(
    (a, b) => scoreDistrictMatch(commune, b) - scoreDistrictMatch(commune, a)
  );
  return matches[0] ?? null;
}

async function postTerritoriesSearch(
  tenantId: string,
  secretKey: string,
  body: Record<string, unknown>
): Promise<
  | { ok: true; items: Record<string, unknown>[] }
  | { ok: false; error: string }
> {
  const out = await zrRequestWithAuthVariants(
    "/territories/search",
    { method: "POST", body: JSON.stringify(body) },
    tenantId,
    secretKey,
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

function parsedCitiesFromItems(items: Record<string, unknown>[]): ParsedTerritory[] {
  const cities: ParsedTerritory[] = [];
  for (const item of items) {
    const row = parseTerritoryItem(item);
    if (row?.kind === "city") cities.push(row);
  }
  return cities;
}

function parsedDistrictsUnderCity(
  items: Record<string, unknown>[],
  cityId: string
): ParsedTerritory[] {
  const districts: ParsedTerritory[] = [];
  for (const item of items) {
    const row = parseTerritoryItem(item);
    if (
      row?.kind === "district" &&
      row.parent_city_territory_id === cityId
    ) {
      districts.push(row);
    }
  }
  return districts;
}

/**
 * Resolve ZR city and district GUIDs for a shipment using POST /territories/search
 * (wilaya → city, commune → district scoped to that city).
 */
export async function resolveCityDistrictGuidsForOrder(
  wilaya: string,
  commune: string | null | undefined,
  tenantId: string,
  secretKey: string
): Promise<
  | { ok: true; cityTerritoryId: string; districtTerritoryId: string }
  | { ok: false; error: string }
> {
  const communeT = (commune ?? "").trim();
  if (!communeT) {
    return { ok: false, error: "Commune is required to resolve district territory." };
  }
  const wTrim = wilaya.trim();
  if (!wTrim) {
    return { ok: false, error: "Wilaya is empty." };
  }

  const tryKeywords = [
    ...new Set(
      [primaryWilayaName(wTrim), normGeoKey(wTrim), wTrim].filter(
        (k): k is string => Boolean(k && k.trim())
      )
    ),
  ];

  let city: ParsedTerritory | null = null;
  let wilayaItems: Record<string, unknown>[] = [];

  for (const keyword of tryKeywords) {
    const res = await postTerritoriesSearch(tenantId, secretKey, {
      pageNumber: 1,
      pageSize: 1000,
      keyword,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `ZR territories/search (wilaya): ${res.error}`,
      };
    }
    wilayaItems = res.items;
    const cities = parsedCitiesFromItems(res.items);
    city = pickBestCityForWilaya(cities, wTrim);
    if (city) break;
  }

  if (!city) {
    return {
      ok: false,
      error: `No ZR city territory matched wilaya "${wTrim}".`,
    };
  }

  const cityId = city.territory_id;

  const communeSearch = await postTerritoriesSearch(tenantId, secretKey, {
    pageNumber: 1,
    pageSize: 1000,
    keyword: communeT,
  });
  if (!communeSearch.ok) {
    return {
      ok: false,
      error: `ZR territories/search (commune): ${communeSearch.error}`,
    };
  }

  let districtCandidates = parsedDistrictsUnderCity(communeSearch.items, cityId);

  if (districtCandidates.length === 0) {
    districtCandidates = parsedDistrictsUnderCity(wilayaItems, cityId);
  }

  const district = pickBestDistrictForCommune(districtCandidates, communeT);
  if (!district) {
    return {
      ok: false,
      error: `No ZR district matched commune "${communeT}" under wilaya "${wTrim}" (city territory ${cityId}).`,
    };
  }

  return {
    ok: true,
    cityTerritoryId: cityId,
    districtTerritoryId: district.territory_id,
  };
}
