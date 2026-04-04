import type { IncomingMessage } from "node:http";
import { createClient } from "@supabase/supabase-js";

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
  address: string;
  product: string;
  quantity: number;
  amount: number;
  status: string;
  sub_status: string | null;
};

const ZR_BASE = "https://api.zrexpress.app";

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

function mapOrderToZrParcel(order: DbOrder) {
  return {
    customer: {
      name: order.customer_name,
      phone: { number1: order.phone || "" },
    },
    deliveryAddress: {
      street: order.address || "",
    },
    orderedProducts: [
      {
        productName: order.product,
        quantity: order.quantity,
      },
    ],
    amount: Number(order.amount),
    deliveryType: "home",
    reference: order.id,
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
    .select("id, name, type, token, tenant_id, active")
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
      "id, customer_name, phone, address, product, quantity, amount, status, sub_status"
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

  const parcels = list.map(mapOrderToZrParcel);
  const zrUrl = `${ZR_BASE}/api/v1/parcels/bulk`;

  let zrRes: Response;
  try {
    zrRes = await fetch(zrUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Tenant": company.tenant_id,
        Authorization: `Bearer ${company.token}`,
      },
      body: JSON.stringify({ parcels }),
    });
  } catch (e) {
    res.status(502).json({
      error: "Failed to reach ZR Express API",
      details: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  const zrText = await zrRes.text();
  let zrJson: unknown;
  try {
    zrJson = zrText ? JSON.parse(zrText) : null;
  } catch {
    zrJson = null;
  }

  if (!zrRes.ok) {
    res.status(502).json({
      error: "ZR Express API error",
      status: zrRes.status,
      details: typeof zrJson === "object" && zrJson !== null ? zrJson : zrText.slice(0, 800),
    });
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

  res.status(200).json({
    ok: true,
    updated,
    zrResultCount: results.length,
    warnings:
      results.length === 0
        ? [
            "ZR response had no parcel array; check API payload/response shape in api/validate-shipment.ts",
          ]
        : undefined,
    errors: errors.length ? errors : undefined,
  });
}
