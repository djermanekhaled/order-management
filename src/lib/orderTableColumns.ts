/** Orders table data columns (excluding the leading selection checkbox column). */
export type OrderColumnId =
  | "internalTracking"
  | "status"
  | "customer"
  | "phone"
  | "wilaya"
  | "commune"
  | "product"
  | "sku"
  | "qty"
  | "items"
  | "shipping"
  | "total"
  | "deliveryType"
  | "delivery"
  | "tracking"
  | "shipStatus"
  | "source"
  | "created"
  | "actions";

export const ORDER_COLUMN_IDS: OrderColumnId[] = [
  "internalTracking",
  "status",
  "customer",
  "phone",
  "wilaya",
  "commune",
  "product",
  "sku",
  "qty",
  "items",
  "shipping",
  "total",
  "deliveryType",
  "delivery",
  "tracking",
  "shipStatus",
  "source",
  "created",
  "actions",
];

export const ORDER_COLUMN_LABELS: Record<OrderColumnId, string> = {
  internalTracking: "ID",
  status: "Status",
  customer: "Customer",
  phone: "Phone",
  wilaya: "Wilaya",
  commune: "Commune",
  product: "Product",
  sku: "SKU",
  qty: "Qty",
  items: "Items",
  shipping: "Shipping",
  total: "Total",
  deliveryType: "Delivery Type",
  delivery: "Delivery",
  tracking: "Tracking",
  shipStatus: "Ship status",
  source: "Source",
  created: "Created",
  actions: "Actions",
};

export function defaultColumnVisibility(): Record<OrderColumnId, boolean> {
  return Object.fromEntries(
    ORDER_COLUMN_IDS.map((id) => [id, true])
  ) as Record<OrderColumnId, boolean>;
}
