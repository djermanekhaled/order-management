import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import type { Product, ProductVariantDraft } from "../types/product";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60";

function newClientKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `v-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function emptyVariant(): ProductVariantDraft {
  return {
    clientKey: newClientKey(),
    name: "",
    sku: "",
    purchase_price: 0,
    sale_price: 0,
    confirmation_fee: 0,
    tracking_fee: 0,
    min_stock_alert: 0,
    active: true,
  };
}

const emptyProduct = {
  name: "",
  sku: "",
  purchase_price: 0,
  sale_price: 0,
  confirmation_fee: 0,
  tracking_fee: 0,
  min_stock_alert: 0,
  active: true,
};

interface ProductModalProps {
  open: boolean;
  mode: "create" | "edit";
  productId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProductModal({
  open,
  mode,
  productId,
  onClose,
  onSaved,
}: ProductModalProps) {
  const [product, setProduct] = useState(emptyProduct);
  const [variants, setVariants] = useState<ProductVariantDraft[]>([]);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "edit" && productId) {
      setLoading(true);
      void (async () => {
        const { data: p, error: pErr } = await supabase
          .from("products")
          .select("*")
          .eq("id", productId)
          .single();
        if (pErr || !p) {
          setLocalError(pErr?.message ?? "Product not found.");
          setLoading(false);
          return;
        }
        const row = p as Product;
        setProduct({
          name: row.name,
          sku: row.sku,
          purchase_price: Number(row.purchase_price),
          sale_price: Number(row.sale_price),
          confirmation_fee: Number(row.confirmation_fee),
          tracking_fee: Number(row.tracking_fee),
          min_stock_alert: row.min_stock_alert,
          active: row.active,
        });
        const { data: vRows, error: vErr } = await supabase
          .from("product_variants")
          .select("*")
          .eq("product_id", productId)
          .order("created_at", { ascending: true });
        setLoading(false);
        if (vErr) {
          setLocalError(vErr.message);
          return;
        }
        setVariants(
          (vRows ?? []).map((v) => ({
            clientKey: (v as { id: string }).id,
            name: (v as { name: string }).name,
            sku: (v as { sku: string }).sku,
            purchase_price: Number((v as { purchase_price: number }).purchase_price),
            sale_price: Number((v as { sale_price: number }).sale_price),
            confirmation_fee: Number((v as { confirmation_fee: number }).confirmation_fee),
            tracking_fee: Number((v as { tracking_fee: number }).tracking_fee),
            min_stock_alert: (v as { min_stock_alert: number }).min_stock_alert,
            active: (v as { active: boolean }).active,
          }))
        );
        setVariantsOpen((vRows?.length ?? 0) > 0);
      })();
    } else {
      setProduct(emptyProduct);
      setVariants([]);
      setVariantsOpen(false);
      setLoading(false);
    }
  }, [open, mode, productId]);

  if (!open) return null;

  function updateVariant(key: string, patch: Partial<ProductVariantDraft>) {
    setVariants((list) =>
      list.map((v) => (v.clientKey === key ? { ...v, ...patch } : v))
    );
  }

  function removeVariant(key: string) {
    setVariants((list) => list.filter((v) => v.clientKey !== key));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!product.name.trim() || !product.sku.trim()) {
      setLocalError("Name and SKU are required.");
      return;
    }
    const cleanedVariants = variants.filter((v) => v.name.trim() && v.sku.trim());

    setSaving(true);
    try {
      const payload = {
        name: product.name.trim(),
        sku: product.sku.trim(),
        purchase_price: product.purchase_price,
        sale_price: product.sale_price,
        confirmation_fee: product.confirmation_fee,
        tracking_fee: product.tracking_fee,
        min_stock_alert: Math.max(0, Math.floor(product.min_stock_alert)),
        active: product.active,
      };

      if (mode === "create") {
        const { data: inserted, error: insErr } = await supabase
          .from("products")
          .insert(payload)
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        const pid = (inserted as { id: string }).id;
        if (cleanedVariants.length > 0) {
          const { error: vInsErr } = await supabase.from("product_variants").insert(
            cleanedVariants.map((v) => ({
              product_id: pid,
              name: v.name.trim(),
              sku: v.sku.trim(),
              purchase_price: v.purchase_price,
              sale_price: v.sale_price,
              confirmation_fee: v.confirmation_fee,
              tracking_fee: v.tracking_fee,
              min_stock_alert: Math.max(0, Math.floor(v.min_stock_alert)),
              active: v.active,
            }))
          );
          if (vInsErr) throw new Error(vInsErr.message);
        }
      } else if (productId) {
        const { error: upErr } = await supabase
          .from("products")
          .update(payload)
          .eq("id", productId);
        if (upErr) throw new Error(upErr.message);
        const { error: delErr } = await supabase
          .from("product_variants")
          .delete()
          .eq("product_id", productId);
        if (delErr) throw new Error(delErr.message);
        if (cleanedVariants.length > 0) {
          const { error: vInsErr } = await supabase.from("product_variants").insert(
            cleanedVariants.map((v) => ({
              product_id: productId,
              name: v.name.trim(),
              sku: v.sku.trim(),
              purchase_price: v.purchase_price,
              sale_price: v.sale_price,
              confirmation_fee: v.confirmation_fee,
              tracking_fee: v.tracking_fee,
              min_stock_alert: Math.max(0, Math.floor(v.min_stock_alert)),
              active: v.active,
            }))
          );
          if (vInsErr) throw new Error(vInsErr.message);
        }
      }
      onSaved();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not save product.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="product-modal-title" className="text-lg font-semibold text-white">
            {mode === "create" ? "New product" : "Edit product"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-sm text-slate-400">Loading…</p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-5">
            {localError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
                {localError}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-300">Name</label>
                <input
                  required
                  value={product.name}
                  onChange={(e) => setProduct((p) => ({ ...p, name: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">SKU</label>
                <input
                  required
                  value={product.sku}
                  onChange={(e) => setProduct((p) => ({ ...p, sku: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={product.active}
                    onChange={(e) =>
                      setProduct((p) => ({ ...p, active: e.target.checked }))
                    }
                    className="rounded border-slate-600"
                  />
                  Active
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Purchase price (DZD)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={product.purchase_price}
                  onChange={(e) =>
                    setProduct((p) => ({
                      ...p,
                      purchase_price: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Sale price (DZD)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={product.sale_price}
                  onChange={(e) =>
                    setProduct((p) => ({
                      ...p,
                      sale_price: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Confirmation fee (DZD)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={product.confirmation_fee}
                  onChange={(e) =>
                    setProduct((p) => ({
                      ...p,
                      confirmation_fee: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Tracking fee (DZD)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={product.tracking_fee}
                  onChange={(e) =>
                    setProduct((p) => ({
                      ...p,
                      tracking_fee: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300">
                  Min stock alert
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={product.min_stock_alert}
                  onChange={(e) =>
                    setProduct((p) => ({
                      ...p,
                      min_stock_alert: parseInt(e.target.value, 10) || 0,
                    }))
                  }
                  className={inputClass}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-700/80 bg-slate-950/40 ring-1 ring-white/5">
              <button
                type="button"
                onClick={() => setVariantsOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-slate-200 hover:bg-slate-800/40"
              >
                <span>
                  Variants
                  {variants.length > 0 ? (
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      ({variants.length})
                    </span>
                  ) : null}
                </span>
                <span className="text-slate-500">{variantsOpen ? "▼" : "▶"}</span>
              </button>
              {variantsOpen && (
                <div className="space-y-4 border-t border-slate-800/80 p-4">
                  {variants.map((v) => (
                    <div
                      key={v.clientKey}
                      className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Variant
                        </span>
                        <button
                          type="button"
                          onClick={() => removeVariant(v.clientKey)}
                          className="text-xs text-rose-400 hover:text-rose-300"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs text-slate-500">Name</label>
                          <input
                            value={v.name}
                            onChange={(e) =>
                              updateVariant(v.clientKey, { name: e.target.value })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">SKU</label>
                          <input
                            value={v.sku}
                            onChange={(e) =>
                              updateVariant(v.clientKey, { sku: e.target.value })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">Purchase</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={v.purchase_price}
                            onChange={(e) =>
                              updateVariant(v.clientKey, {
                                purchase_price: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">Sale price</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={v.sale_price}
                            onChange={(e) =>
                              updateVariant(v.clientKey, {
                                sale_price: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">Confirm. fee</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={v.confirmation_fee}
                            onChange={(e) =>
                              updateVariant(v.clientKey, {
                                confirmation_fee: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">Tracking fee</label>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={v.tracking_fee}
                            onChange={(e) =>
                              updateVariant(v.clientKey, {
                                tracking_fee: parseFloat(e.target.value) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-500">Min stock alert</label>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={v.min_stock_alert}
                            onChange={(e) =>
                              updateVariant(v.clientKey, {
                                min_stock_alert: parseInt(e.target.value, 10) || 0,
                              })
                            }
                            className={inputClass}
                          />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={v.active}
                              onChange={(e) =>
                                updateVariant(v.clientKey, { active: e.target.checked })
                              }
                              className="rounded border-slate-600"
                            />
                            Active
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setVariants((list) => [...list, emptyVariant()])}
                    className="w-full rounded-lg border border-dashed border-slate-600 py-2 text-sm text-slate-400 hover:border-indigo-500/50 hover:text-indigo-200"
                  >
                    + Add variant
                  </button>
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
                {saving ? "Saving…" : "Save product"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
