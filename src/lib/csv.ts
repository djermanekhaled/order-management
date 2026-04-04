import { statusLabel, subStatusLabel } from "./orderWorkflow";
import type { Order } from "../types/order";

function orderGrandTotal(o: Order): number {
  const t = o.total_amount;
  if (t != null && Number.isFinite(Number(t))) return Number(t);
  return Number(o.amount) + Number(o.shipping_cost ?? 0);
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportOrdersToCsv(orders: Order[], filenameBase = "orders"): void {
  const headers = [
    "id",
    "customer_name",
    "phone",
    "wilaya",
    "commune",
    "address",
    "product",
    "quantity",
    "amount",
    "shipping_cost",
    "total_amount",
    "notes",
    "status",
    "sub_status",
    "source",
    "delivery_company",
    "delivery_type",
    "shipping_status",
    "tracking_number",
    "internal_tracking_id",
    "created_at",
    "updated_at",
  ];

  const lines = [
    headers.join(","),
    ...orders.map((o) =>
      [
        o.id,
        o.customer_name,
        o.phone,
        o.wilaya,
        o.commune ?? "",
        o.address,
        o.product,
        o.quantity,
        o.amount,
        o.shipping_cost ?? 0,
        orderGrandTotal(o),
        o.notes,
        statusLabel(o.status),
        subStatusLabel(o.sub_status ?? null),
        o.source ?? "Manual",
        o.delivery_company,
        o.delivery_type ?? "home",
        o.shipping_status ?? "",
        o.tracking_number ?? "",
        o.internal_tracking_id ?? "",
        o.created_at,
        o.updated_at,
      ]
        .map((v) => escapeCell(String(v ?? "")))
        .join(",")
    ),
  ];

  const blob = new Blob(["\ufeff", lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filenameBase}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
