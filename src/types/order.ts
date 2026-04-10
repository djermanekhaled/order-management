/** Main pipeline status (no `shipped` — use completed + sub_status). */
export type OrderStatus =
  | "new"
  | "under_process"
  | "confirmed"
  | "follow"
  | "completed"
  | "cancelled";

/**
 * Sub-status; `null` when not used for that main status.
 * - under_process: call_1 | call_2 | call_3 | busy | postponed
 * - completed: delivered | returned
 * - cancelled: cancelled | fake_order | duplicated
 */
export type OrderDeliveryType = "home" | "pickup-point";

export type OrderSubStatus =
  | "call_1"
  | "call_2"
  | "call_3"
  | "busy"
  | "postponed"
  | "confirmed"
  | "delivered"
  | "returned"
  | "cancelled"
  | "fake_order"
  | "duplicated";

export interface Order {
  id: string;
  customer_name: string;
  phone: string;
  wilaya: string;
  commune: string;
  /** ZR Express wilaya territory UUID from territories/search (level wilaya). */
  wilaya_territory_id?: string;
  /** ZR Express commune territory UUID (level commune, parent = wilaya). */
  commune_territory_id?: string;
  address: string;
  product: string;
  /** Product / line SKU (optional). */
  sku: string;
  quantity: number;
  /** Product / line-items subtotal (excludes shipping). */
  amount: number;
  /** Discount in DZD (subtracted before total). */
  discount?: number;
  shipping_cost?: number;
  /** Final total including shipping (WooCommerce `total`). */
  total_amount?: number;
  notes: string;
  status: OrderStatus;
  /** Nullable: required only for certain `status` values. */
  sub_status: OrderSubStatus | null;
  /** Human-readable origin: "Manual" or a sales channel name. */
  source?: string;
  delivery_company: string;
  delivery_type: OrderDeliveryType;
  hub_id?: string;
  shipping_status?: string | null;
  tracking_number?: string;
  /** Internal reference (e.g. ORD-YYYYMMDD-XXXX). */
  internal_tracking_id: string;
  /** ZR Express parcel id after bulk create (optional). */
  zr_parcel_id?: string;
  created_at: string;
  updated_at: string;
}

export interface OrderFormValues {
  customer_name: string;
  phone: string;
  wilaya: string;
  commune: string;
  wilaya_territory_id: string;
  commune_territory_id: string;
  address: string;
  product: string;
  /** Product / line SKU (optional). */
  sku: string;
  quantity: number;
  amount: number;
  discount: number;
  /** Shipping fee in DZD (manual). */
  shipping_cost: number;
  notes: string;
  status: OrderStatus;
  sub_status: OrderSubStatus | null;
  delivery_company: string;
  delivery_type: OrderDeliveryType;
  hub_id: string;
  internal_tracking_id: string;
}

export type OrderSnapshot = {
  status: OrderStatus;
  sub_status: OrderSubStatus | null;
};

export interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  previous_status: string | null;
  new_status: string;
  previous_sub_status: string | null;
  new_sub_status: string | null;
  created_at: string;
}

/** Sidebar filter: which list is shown in the main table. */
export type SidebarNavKey =
  | "all"
  | "new"
  | "under_process"
  | "confirmed"
  | "follow"
  | "completed"
  | "cancelled";
