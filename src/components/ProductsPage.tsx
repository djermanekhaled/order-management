import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Product } from "../types/product";
import { ProductModal } from "./ProductModal";

function formatMoneyDzd(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 2,
  }).format(n);
}

interface ProductsPageProps {
  productModalOpen: boolean;
  onProductModalOpen: () => void;
  onProductModalClose: () => void;
  onProductsChanged?: () => void;
  /** Increment (e.g. sidebar +) to open modal for a new product. */
  productFreshKey?: number;
}

export function ProductsPage({
  productModalOpen,
  onProductModalOpen,
  onProductModalClose,
  onProductsChanged,
  productFreshKey = 0,
}: ProductsPageProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setProducts((data ?? []) as Product[]);
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (productFreshKey > 0) {
      setModalMode("create");
      setEditingId(null);
    }
  }, [productFreshKey]);

  function openCreate() {
    setModalMode("create");
    setEditingId(null);
    onProductModalOpen();
  }

  function openEdit(p: Product) {
    setModalMode("edit");
    setEditingId(p.id);
    onProductModalOpen();
  }

  async function toggleActive(p: Product) {
    setError(null);
    const { error: upErr } = await supabase
      .from("products")
      .update({ active: !p.active })
      .eq("id", p.id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await loadProducts();
    onProductsChanged?.();
  }

  async function deleteProduct(p: Product) {
    if (
      !window.confirm(
        `Delete product "${p.name}" and all its variants? This cannot be undone.`
      )
    ) {
      return;
    }
    setError(null);
    const { error: delErr } = await supabase.from("products").delete().eq("id", p.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await loadProducts();
    onProductsChanged?.();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Catalog
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Products</h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage SKUs, pricing, fees, and stock alerts. Variants are optional.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadProducts()}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
          >
            New product
          </button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
          role="alert"
        >
          {error}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl ring-1 ring-white/5">
        <div className="border-b border-slate-800/80 px-5 py-4">
          <p className="text-sm text-slate-400">
            {loading
              ? "Loading products…"
              : `${products.length} product${products.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Sale price</th>
                <th className="px-5 py-3 font-medium">Stock alert</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!loading &&
                products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/20">
                    <td className="px-5 py-3 font-medium text-slate-100">{p.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{p.sku}</td>
                    <td className="px-5 py-3 tabular-nums text-slate-200">
                      {formatMoneyDzd(Number(p.sale_price))}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-400">
                      {p.min_stock_alert}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${
                          p.active
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "bg-slate-600/30 text-slate-300 ring-1 ring-slate-600/50"
                        }`}
                      >
                        {p.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(p)}
                          className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void toggleActive(p)}
                          className="rounded-lg border border-indigo-600/40 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-950/50"
                        >
                          {p.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteProduct(p)}
                          className="rounded-lg border border-rose-600/40 px-2 py-1 text-xs font-medium text-rose-200 hover:bg-rose-950/40"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <ProductModal
        open={productModalOpen}
        mode={modalMode}
        productId={editingId}
        onClose={() => {
          onProductModalClose();
          setEditingId(null);
        }}
        onSaved={() => {
          void loadProducts();
          onProductsChanged?.();
        }}
      />
    </div>
  );
}
