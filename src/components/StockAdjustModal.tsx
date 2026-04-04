import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60";

export type StockAdjustTarget = {
  kind: "product" | "variant";
  productId: string;
  variantId?: string;
  label: string;
  currentStock: number;
  purchasePrice: number;
};

interface StockAdjustModalProps {
  open: boolean;
  target: StockAdjustTarget | null;
  onClose: () => void;
  onSaved: () => void;
}

export function StockAdjustModal({
  open,
  target,
  onClose,
  onSaved,
}: StockAdjustModalProps) {
  const [delta, setDelta] = useState(0);
  const [purchasePrice, setPurchasePrice] = useState(0);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setDelta(0);
    setPurchasePrice(target.purchasePrice);
    setLocalError(null);
  }, [open, target]);

  if (!open || !target) return null;

  const nextStock = target.currentStock + delta;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const t = target;
    if (!t) return;
    setLocalError(null);
    const resulting = t.currentStock + delta;
    if (!Number.isFinite(delta) || !Number.isInteger(delta)) {
      setLocalError("Quantity change must be a whole number.");
      return;
    }
    if (resulting < 0) {
      setLocalError("Resulting stock cannot be negative.");
      return;
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      setLocalError("Purchase price must be zero or positive.");
      return;
    }

    setSaving(true);
    try {
      if (t.kind === "product") {
        const { error } = await supabase
          .from("products")
          .update({
            current_stock: resulting,
            purchase_price: purchasePrice,
          })
          .eq("id", t.productId);
        if (error) throw new Error(error.message);
      } else if (t.variantId) {
        const { error } = await supabase
          .from("product_variants")
          .update({
            current_stock: resulting,
            purchase_price: purchasePrice,
          })
          .eq("id", t.variantId);
        if (error) throw new Error(error.message);
      }
      onSaved();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <h2 id="stock-modal-title" className="text-lg font-semibold text-white">
            Update stock
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-5">
          <p className="text-sm text-slate-400">
            <span className="font-medium text-slate-200">{target.label}</span>
            <span className="block text-xs text-slate-500">
              Current on hand: {target.currentStock}
            </span>
          </p>
          {localError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
              {localError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Quantity change
            </label>
            <p className="mt-0.5 text-xs text-slate-500">
              Positive adds stock, negative removes (e.g. +10 or -3).
            </p>
            <input
              type="number"
              step={1}
              value={delta}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || v === "-") {
                  setDelta(0);
                  return;
                }
                const n = parseInt(v, 10);
                setDelta(Number.isNaN(n) ? 0 : n);
              }}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-slate-500">
              New stock: <span className="tabular-nums text-slate-300">{nextStock}</span>
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Purchase price (DZD)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={purchasePrice}
              onChange={(e) =>
                setPurchasePrice(parseFloat(e.target.value) || 0)
              }
              className={inputClass}
            />
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
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
