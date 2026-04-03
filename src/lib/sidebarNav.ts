import type { Order, SidebarNavKey } from "../types/order";

export function orderMatchesNavKey(order: Order, key: SidebarNavKey): boolean {
  if (key === "all") return true;
  if (key === "new") {
    return order.status === "new" && order.sub_status == null;
  }
  if (key === "confirmed") {
    return (
      order.status === "confirmed" &&
      (order.sub_status == null || order.sub_status === "confirmed")
    );
  }
  if (key === "follow") {
    return (
      order.status === "follow" &&
      (order.sub_status == null || order.sub_status === "confirmed")
    );
  }
  if (key === "under_process") return order.status === "under_process";
  if (key === "completed") return order.status === "completed";
  if (key === "cancelled") return order.status === "cancelled";
  return false;
}

export function countByNavKey(
  orders: Order[],
  key: SidebarNavKey
): number {
  return orders.filter((o) => orderMatchesNavKey(o, key)).length;
}

const NAV_LABELS: Record<SidebarNavKey, string> = {
  all: "All orders",
  new: "New",
  under_process: "Under Process",
  confirmed: "Confirmed",
  follow: "Follow",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function navKeyLabel(key: SidebarNavKey): string {
  return NAV_LABELS[key];
}
