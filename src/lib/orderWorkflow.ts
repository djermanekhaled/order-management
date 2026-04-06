import type {
  OrderSnapshot,
  OrderStatus,
  OrderSubStatus,
} from "../types/order";

export const ORDER_STATUSES: OrderStatus[] = [
  "new",
  "under_process",
  "confirmed",
  "follow",
  "completed",
  "cancelled",
];

export const UNDER_PROCESS_SUBS: OrderSubStatus[] = [
  "call_1",
  "call_2",
  "call_3",
  "postponed",
];

export const COMPLETED_SUBS: OrderSubStatus[] = ["delivered", "returned"];

export const CANCELLED_SUBS: OrderSubStatus[] = [
  "cancelled",
  "fake_order",
  "duplicated",
];

export function statusLabel(s: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    new: "New",
    under_process: "Under Process",
    confirmed: "Confirmed",
    follow: "Follow",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return map[s];
}

export function subStatusLabel(sub: OrderSubStatus | null): string {
  if (sub == null) return "—";
  const map: Record<OrderSubStatus, string> = {
    call_1: "Call 1",
    call_2: "Call 2",
    call_3: "Call 3",
    postponed: "Postponed",
    confirmed: "Confirmed",
    delivered: "Delivered",
    returned: "Returned",
    cancelled: "Cancelled",
    fake_order: "Fake Order",
    duplicated: "Duplicated",
  };
  return map[sub];
}

export function isValidOrderState(
  status: OrderStatus,
  sub: OrderSubStatus | null
): boolean {
  switch (status) {
    case "new":
      return sub === null;
    case "under_process":
      return sub !== null && UNDER_PROCESS_SUBS.includes(sub);
    case "confirmed":
    case "follow":
      return sub === "confirmed";
    case "completed":
      return sub !== null && COMPLETED_SUBS.includes(sub);
    case "cancelled":
      return sub !== null && CANCELLED_SUBS.includes(sub);
    default:
      return false;
  }
}

/** Allowed next main statuses from current main status (ignoring sub). */
export function allowedNextStatuses(current: OrderStatus): OrderStatus[] {
  switch (current) {
    case "new":
      // New orders can go to:
      // - Confirmed (no "follow" yet)
      // - Under Process (call_*)
      // - Cancelled (cancelled/fake/duplicated)
      return ["confirmed", "under_process", "cancelled"];
    case "under_process":
      return ["confirmed", "cancelled"];
    case "follow":
      return ["confirmed", "cancelled"];
    case "confirmed":
      // After being Confirmed, we allow the "Follow" stage,
      // and we keep the path to Completed for existing UX.
      return ["follow", "completed", "cancelled"];
    case "completed":
      return ["cancelled"];
    case "cancelled":
      return [];
    default:
      return [];
  }
}

/**
 * Valid transitions between snapshots (including sub-only updates within
 * under_process, completed, cancelled).
 */
export function isValidTransition(from: OrderSnapshot, to: OrderSnapshot): boolean {
  if (from.status === to.status && from.sub_status === to.sub_status) {
    return true;
  }
  if (!isValidOrderState(to.status, to.sub_status)) return false;

  // From Confirmed: table UI allows New, Postponed, Cancelled (plus staying Confirmed).
  if (from.status === "confirmed" && from.sub_status === "confirmed") {
    if (to.status === "new" && to.sub_status === null) return true;
    if (to.status === "under_process" && to.sub_status === "postponed") {
      return true;
    }
    if (to.status === "cancelled" && to.sub_status === "cancelled") {
      return true;
    }
  }

  if (from.status === to.status) {
    if (from.status === "under_process") {
      return (
        to.sub_status !== null &&
        UNDER_PROCESS_SUBS.includes(to.sub_status) &&
        from.sub_status !== to.sub_status
      );
    }
    if (from.status === "completed") {
      return (
        to.sub_status !== null &&
        COMPLETED_SUBS.includes(to.sub_status) &&
        from.sub_status !== to.sub_status
      );
    }
    if (from.status === "cancelled") {
      return (
        to.sub_status !== null &&
        CANCELLED_SUBS.includes(to.sub_status) &&
        from.sub_status !== to.sub_status
      );
    }
    return false;
  }

  const nextMain = allowedNextStatuses(from.status);
  if (!nextMain.includes(to.status)) return false;

  if (to.status === "under_process") {
    return (
      to.sub_status !== null && UNDER_PROCESS_SUBS.includes(to.sub_status)
    );
  }
  if (to.status === "completed") {
    return to.sub_status !== null && COMPLETED_SUBS.includes(to.sub_status);
  }
  if (to.status === "cancelled") {
    return to.sub_status !== null && CANCELLED_SUBS.includes(to.sub_status);
  }
  if (to.status === "confirmed" || to.status === "follow") {
    return to.sub_status === "confirmed";
  }
  return true;
}

/** Create order: start as New (no sub) or Follow. */
export const CREATE_STATUS_OPTIONS: OrderStatus[] = ["new", "follow"];

/** Values allowed for `sub_status` for a given main `status` (includes `null` when valid). */
export function subStatusesForStatus(
  status: OrderStatus
): (OrderSubStatus | null)[] {
  switch (status) {
    case "new":
      return [null];
    case "confirmed":
    case "follow":
      return ["confirmed"];
    case "under_process":
      return [...UNDER_PROCESS_SUBS];
    case "completed":
      return [...COMPLETED_SUBS];
    case "cancelled":
      return [...CANCELLED_SUBS];
    default:
      return [null];
  }
}

export function defaultSubForStatus(status: OrderStatus): OrderSubStatus | null {
  switch (status) {
    case "new":
      return null;
    case "confirmed":
    case "follow":
      return "confirmed";
    case "under_process":
      return "call_1";
    case "completed":
      return "delivered";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}
