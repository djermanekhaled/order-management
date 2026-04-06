import { useEffect, useState, type FormEvent } from "react";
import { WILAYAS } from "../constants/wilayas";
import {
  allowedNextStatuses,
  CREATE_STATUS_OPTIONS,
  defaultSubForStatus,
  isValidOrderState,
  isValidTransition,
  ORDER_STATUSES,
  statusLabel,
  subStatusLabel,
  subStatusesForStatus,
} from "../lib/orderWorkflow";
import { generateInternalTrackingId } from "../lib/internalTracking";
import type {
  Order,
  OrderDeliveryType,
  OrderFormValues,
  OrderStatus,
  OrderSubStatus,
  OrderSnapshot,
} from "../types/order";

const emptyForm: OrderFormValues = {
  customer_name: "",
  phone: "",
  wilaya: "",
  commune: "",
  address: "",
  product: "",
  sku: "",
  quantity: 1,
  amount: 0,
  notes: "",
  status: "new",
  sub_status: null,
  delivery_company: "",
  delivery_type: "home",
  internal_tracking_id: "",
};

type Mode = "create" | "edit";

interface OrderFormModalProps {
  open: boolean;
  mode: Mode;
  initialOrder: Order | null;
  onClose: () => void;
  onSubmit: (values: OrderFormValues, previous: OrderSnapshot | null) => Promise<void>;
}

export function OrderFormModal({
  open,
  mode,
  initialOrder,
  onClose,
  onSubmit,
}: OrderFormModalProps) {
  const [values, setValues] = useState<OrderFormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "edit" && initialOrder) {
      setValues({
        customer_name: initialOrder.customer_name,
        phone: initialOrder.phone ?? "",
        wilaya: initialOrder.wilaya ?? "",
        commune: initialOrder.commune ?? "",
        address: initialOrder.address ?? "",
        product: initialOrder.product,
        sku: initialOrder.sku ?? "",
        quantity: initialOrder.quantity ?? 1,
        amount: Number(initialOrder.amount),
        notes: initialOrder.notes ?? "",
        status: initialOrder.status,
        sub_status:
          initialOrder.status === "confirmed" || initialOrder.status === "follow"
            ? initialOrder.sub_status ?? "confirmed"
            : initialOrder.sub_status ?? null,
        delivery_company: initialOrder.delivery_company ?? "",
        delivery_type: initialOrder.delivery_type ?? "home",
        internal_tracking_id: initialOrder.internal_tracking_id ?? "",
      });
    } else {
      setValues({
        ...emptyForm,
        status: "new",
        sub_status: null,
        internal_tracking_id: "",
      });
    }
  }, [open, mode, initialOrder]);

  if (!open) return null;

  const statusChoices: OrderStatus[] =
    mode === "create"
      ? CREATE_STATUS_OPTIONS
      : (() => {
          const next = allowedNextStatuses(values.status);
          const set = new Set<OrderStatus>([values.status, ...next]);
          return ORDER_STATUSES.filter((s) => set.has(s));
        })();

  const subChoices = subStatusesForStatus(values.status);
  const showSubSelect = subChoices.some((s) => s !== null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!values.customer_name.trim() || !values.product.trim()) {
      setLocalError("Customer name and product are required.");
      return;
    }
    if (!values.wilaya) {
      setLocalError("Please select a wilaya.");
      return;
    }
    if (!isValidOrderState(values.status, values.sub_status)) {
      setLocalError("Pick a valid sub-status for the selected main status.");
      return;
    }
    const prevSnap: OrderSnapshot | null =
      mode === "edit" && initialOrder
        ? {
            status: initialOrder.status,
            sub_status: initialOrder.sub_status ?? null,
          }
        : null;
    if (
      prevSnap &&
      !isValidTransition(prevSnap, {
        status: values.status,
        sub_status: values.sub_status,
      })
    ) {
      setLocalError("That status / sub-status change is not allowed.");
      return;
    }
    setSaving(true);
    try {
      const valuesToSave: OrderFormValues =
        mode === "create"
          ? { ...values, internal_tracking_id: generateInternalTrackingId() }
          : values;
      await onSubmit(valuesToSave, prevSnap);
      onClose();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Could not save order."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-form-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="order-form-title" className="text-lg font-semibold text-white">
            {mode === "create" ? "Create order" : "Edit order"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {localError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
              {localError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Customer name
              </label>
              <input
                required
                value={values.customer_name}
                onChange={(e) =>
                  setValues((v) => ({ ...v, customer_name: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Phone
              </label>
              <input
                type="tel"
                value={values.phone}
                onChange={(e) =>
                  setValues((v) => ({ ...v, phone: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Wilaya
              </label>
              <select
                required
                value={values.wilaya}
                onChange={(e) =>
                  setValues((v) => ({ ...v, wilaya: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="">Select wilaya</option>
                {WILAYAS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Commune
              </label>
              <input
                value={values.commune}
                onChange={(e) =>
                  setValues((v) => ({ ...v, commune: e.target.value }))
                }
                placeholder="District / commune"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Delivery Type
              </label>
              <select
                value={values.delivery_type}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    delivery_type: e.target.value as OrderDeliveryType,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="home">À domicile</option>
                <option value="pickup-point">Stop desk</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Internal Tracking ID
              </label>
              <input
                readOnly
                value={values.internal_tracking_id}
                placeholder={
                  mode === "create" ? "Assigned when you save" : undefined
                }
                className="mt-1 w-full cursor-default rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-400 outline-none placeholder:text-slate-600"
                title={
                  mode === "create"
                    ? "Generated on save (ORD-YYYYMMDD-XXXX)"
                    : "Internal reference"
                }
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Address
              </label>
              <textarea
                rows={2}
                value={values.address}
                onChange={(e) =>
                  setValues((v) => ({ ...v, address: e.target.value }))
                }
                className="mt-1 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Product
              </label>
              <input
                required
                value={values.product}
                onChange={(e) =>
                  setValues((v) => ({ ...v, product: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                SKU
              </label>
              <input
                value={values.sku}
                onChange={(e) =>
                  setValues((v) => ({ ...v, sku: e.target.value }))
                }
                placeholder="Product or variant SKU (optional)"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Quantity
              </label>
              <input
                type="number"
                min={1}
                step={1}
                required
                value={values.quantity}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Items (DZD, excl. shipping)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={values.amount}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    amount: parseFloat(e.target.value) || 0,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Delivery company
              </label>
              <input
                value={values.delivery_company}
                onChange={(e) =>
                  setValues((v) => ({ ...v, delivery_company: e.target.value }))
                }
                placeholder="e.g. Yalidine, Colis Privé…"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Notes
              </label>
              <textarea
                rows={3}
                value={values.notes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, notes: e.target.value }))
                }
                className="mt-1 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Status
              </label>
              <select
                value={values.status}
                onChange={(e) => {
                  const ns = e.target.value as OrderStatus;
                  setValues((v) => ({
                    ...v,
                    status: ns,
                    sub_status: defaultSubForStatus(ns),
                  }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              >
                {statusChoices.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            {showSubSelect && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-300">
                  Sub-status
                </label>
                <select
                  value={values.sub_status ?? ""}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setValues((v) => ({
                      ...v,
                      sub_status: raw === "" ? null : (raw as OrderSubStatus),
                    }));
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                >
                  {subChoices.map((s) => (
                    <option key={s ?? "none"} value={s ?? ""}>
                      {subStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
