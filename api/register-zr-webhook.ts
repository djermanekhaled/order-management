import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { registerZrParcelStateWebhook } from "./zrWebhookService.js";

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[] | undefined>;
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
  const deliveryCompanyId = (raw as { deliveryCompanyId?: unknown }).deliveryCompanyId;
  if (typeof deliveryCompanyId !== "string" || !deliveryCompanyId.trim()) {
    res.status(400).json({ error: "deliveryCompanyId is required" });
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

  const { data: company, error: cErr } = await db
    .from("delivery_companies")
    .select("id, type, tenant_id, active")
    .eq("id", deliveryCompanyId.trim())
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
    res.status(400).json({ error: "Only ZR Express companies register parcel webhooks" });
    return;
  }

  const xTenantId =
    (process.env.ZR_TENANT_ID ?? "").trim() || (company.tenant_id ?? "").trim();

  const result = await registerZrParcelStateWebhook(xTenantId);
  if (!result.ok) {
    res.status(502).json({ error: result.error, zrStatus: result.zrStatus });
    return;
  }

  res.status(200).json({ ok: true, callbackUrl: result.callbackUrl });
}
