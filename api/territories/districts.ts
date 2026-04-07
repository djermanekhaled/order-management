import { createClient } from "@supabase/supabase-js";
import type { ApiRequest, ApiResponse } from "./_shared.js";
import { isUuid, parseRequestQuery } from "./_shared.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
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
