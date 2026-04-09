import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import {
  getZrApiKeyFromEnv,
  zrExpressErrorMessage,
  zrRequestWithAuthVariants,
} from "./zrExpressClient.js";

type ApiRequest = IncomingMessage & {
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => { json: (body: unknown) => void };
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

function territoryName(row: Record<string, unknown>): string {
  const n =
    (typeof row.name === "string" && row.name.trim()) ||
    (typeof row.label === "string" && row.label.trim()) ||
    (typeof row.territoryName === "string" && row.territoryName.trim()) ||
    "";
  return n;
}

function territoryId(row: Record<string, unknown>): string | null {
  const id = row.id;
  if (typeof id === "string" && id.trim()) return id.trim();
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return null;
}

function bodyListWilayas(): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 500,
    advancedFilter: {
      filters: [{ field: "level", operator: "eq", value: "wilaya" }],
      logic: "and",
    },
  };
}

function bodyListCommunes(parentWilayaId: string): Record<string, unknown> {
  return {
    pageNumber: 1,
    pageSize: 1000,
    advancedFilter: {
      filters: [
        { field: "level", operator: "eq", value: "commune" },
        { field: "parentId", operator: "eq", value: parentWilayaId },
      ],
      logic: "and",
    },
  };
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

  const body = raw as {
    level?: unknown;
    parentId?: unknown;
    deliveryCompanyId?: unknown;
  };

  const level = body.level === "wilaya" || body.level === "commune" ? body.level : null;
  if (!level) {
    res.status(400).json({ error: 'level must be "wilaya" or "commune"' });
    return;
  }

  let parentId = "";
  if (level === "commune") {
    if (typeof body.parentId !== "string" || !body.parentId.trim()) {
      res.status(400).json({ error: "parentId (wilaya territory id) is required for commune level" });
      return;
    }
    parentId = body.parentId.trim();
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  if (!getZrApiKeyFromEnv()) {
    res.status(500).json({ error: "ZR_API_KEY is not configured" });
    return;
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let xTenantId = (process.env.ZR_TENANT_ID ?? "").trim();

  const dcId =
    typeof body.deliveryCompanyId === "string" && body.deliveryCompanyId.trim()
      ? body.deliveryCompanyId.trim()
      : null;

  if (dcId) {
    const { data: co, error: coErr } = await db
      .from("delivery_companies")
      .select("tenant_id, type, active")
      .eq("id", dcId)
      .single();
    if (!coErr && co?.active && co.type === "zr_express" && (co.tenant_id ?? "").trim()) {
      xTenantId = (co.tenant_id ?? "").trim();
    }
  }

  if (!xTenantId) {
    const { data: first } = await db
      .from("delivery_companies")
      .select("tenant_id")
      .eq("active", true)
      .eq("type", "zr_express")
      .limit(1)
      .maybeSingle();
    if ((first?.tenant_id ?? "").trim()) {
      xTenantId = (first?.tenant_id ?? "").trim();
    }
  }

  if (!xTenantId) {
    res.status(400).json({
      error:
        "No ZR tenant: add an active ZR Express delivery company, set ZR_TENANT_ID, or pass deliveryCompanyId.",
    });
    return;
  }

  const searchBody =
    level === "wilaya" ? bodyListWilayas() : bodyListCommunes(parentId);

  const out = await zrRequestWithAuthVariants(
    "/territories/search",
    { method: "POST", body: JSON.stringify(searchBody) },
    xTenantId,
    { logPrefix: "[zr-territories-search]" }
  );

  if (!out.res.ok) {
    res.status(502).json({
      error: zrExpressErrorMessage(out.res.status, out.json, out.text),
      zrStatus: out.res.status,
    });
    return;
  }

  const items = extractItemsArray(out.json);
  const territories: { id: string; name: string }[] = [];
  for (const row of items) {
    const id = territoryId(row);
    const name = territoryName(row);
    if (id && name) territories.push({ id, name });
  }

  territories.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  res.status(200).json({ territories });
}
