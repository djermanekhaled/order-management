import { statusLabel, subStatusLabel } from "./orderWorkflow";
import type { Order } from "../types/order";

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
    "address",
    "product",
    "quantity",
    "amount",
    "notes",
    "status",
    "sub_status",
    "source",
    "delivery_company",
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
        o.address,
        o.product,
        o.quantity,
        o.amount,
        o.notes,
        statusLabel(o.status),
        subStatusLabel(o.sub_status ?? null),
        o.source ?? "Manual",
        o.delivery_company,
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
