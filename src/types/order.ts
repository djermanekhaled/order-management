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
 * - under_process: call_1 | call_2 | call_3 | postponed
 * - completed: delivered | returned
 * - cancelled: cancelled | fake_order | duplicated
 */
export type OrderSubStatus =
  | "call_1"
  | "call_2"
  | "call_3"
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
  address: string;
  product: string;
  quantity: number;
  amount: number;
  notes: string;
  status: OrderStatus;
  /** Nullable: required only for certain `status` values. */
  sub_status: OrderSubStatus | null;
  /** Human-readable origin: "Manual" or a sales channel name. */
  source?: string;
  delivery_company: string;
  created_at: string;
  updated_at: string;
}

export interface OrderFormValues {
  customer_name: string;
  phone: string;
  wilaya: string;
  address: string;
  product: string;
  quantity: number;
  amount: number;
  notes: string;
  status: OrderStatus;
  sub_status: OrderSubStatus | null;
  delivery_company: string;
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
