import { randomInt } from "node:crypto";

/** WooCommerce REST / webhook order payload (subset used for DB insert). */
export type WooOrderPayload = {
  id?: number;
  status?: string;
  total?: string;
  shipping_total?: string;
  subtotal?: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    city?: string;
    address_1?: string;
    address_2?: string;
    state?: string;
  };
  line_items?: Array<{
    name?: string;
    sku?: string;
    quantity?: number;
    total?: string;
  }>;
};

export function wooOrderNote(wcId: number): string {
  return `WooCommerce order #${wcId}`;
}

function finiteMoney(v: string | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function productAmountFromWc(wc: WooOrderPayload, grandTotal: number, shipping: number): number {
  if (wc.subtotal != null && wc.subtotal !== "") {
    const sub = Number(wc.subtotal);
    if (Number.isFinite(sub) && sub >= 0) return sub;
  }
  const lineSum =
    wc.line_items?.reduce((s, li) => s + finiteMoney(li?.total, 0), 0) ?? 0;
  if (lineSum > 0) return lineSum;
  return Math.max(0, grandTotal - shipping);
}

function billingAddress(b: WooOrderPayload["billing"]): string {
  if (!b) return "";
  const parts = [b.address_1?.trim(), b.address_2?.trim()].filter(Boolean);
  return parts.join(", ");
}

const INTERNAL_TRACK_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newInternalTrackingId(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const datePrefix = `${y}${m}${day}`;
  let suffix = "";
  for (let i = 0; i < 4; i++) {
    suffix +=
      INTERNAL_TRACK_ALPHABET[randomInt(INTERNAL_TRACK_ALPHABET.length)]!;
  }
  return `ORD-${datePrefix}-${suffix}`;
}

export function mapWooStatus(
  status: string | undefined
): "new" | "under_process" | "completed" | "cancelled" {
  if (!status) return "new";
  const s = status.toLowerCase();
  if (s === "pending") return "new";
  if (s === "processing" || s === "on-hold") return "under_process";
  if (s === "completed") return "completed";
  if (s === "cancelled" || s === "failed" || s === "refunded") return "cancelled";
  return "new";
}

/** Row shape for Supabase `orders` insert (WooCommerce → app). */
export function buildOrderRowFromWooCommerce(wc: WooOrderPayload, sourceName: string) {
  const first = wc.billing?.first_name?.trim() ?? "";
  const last = wc.billing?.last_name?.trim() ?? "";
  const customerName =
    [first, last].filter(Boolean).join(" ").trim() || "WooCommerce Customer";

  const item0 = wc.line_items?.[0];
  const product = item0?.name?.trim() || "WooCommerce item";
  const sku = (item0?.sku ?? "").trim();
  const quantity =
    Number.isFinite(item0?.quantity) && (item0?.quantity ?? 0) > 0
      ? (item0?.quantity as number)
      : 1;

  const shippingCost = finiteMoney(wc.shipping_total, 0);
  const totalAmount = finiteMoney(wc.total, 0);
  const productAmount = productAmountFromWc(wc, totalAmount, shippingCost);

  const wcId = wc.id;

  return {
    customer_name: customerName,
    phone: wc.billing?.phone?.trim() ?? "",
    address: billingAddress(wc.billing),
    wilaya: (wc.billing?.state ?? "").trim(),
    commune: (wc.billing?.city ?? "").trim(),
    product,
    sku,
    quantity,
    amount: productAmount,
    shipping_cost: shippingCost,
    total_amount: totalAmount,
    notes: wcId != null ? wooOrderNote(wcId) : "WooCommerce order",
    status: mapWooStatus(wc.status),
    sub_status: null as null,
    delivery_company: "",
    delivery_type: "home" as const,
    internal_tracking_id: newInternalTrackingId(),
    source: sourceName,
  };
}
