import { Fragment, useCallback, useEffect, useState } from "react";
import { countOrdersMatchingAnyProductName } from "../lib/inventoryOrderMatch";
import { supabase } from "../lib/supabase";
import type { Product, ProductVariant } from "../types/product";
import { StockAdjustModal, type StockAdjustTarget } from "./StockAdjustModal";

function formatMoneyDzd(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 2,
  }).format(n);
}

type ProductRow = Product & { variants: ProductVariant[] };

export function InventoryPage() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [deliveryOrders, setDeliveryOrders] = useState<{ product: string }[]>([]);
  const [returnOrders, setReturnOrders] = useState<{ product: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [stockTarget, setStockTarget] = useState<StockAdjustTarget | null>(null);
  const [stockModalOpen, setStockModalOpen] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data: prows, error: pErr } = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("name");
    if (pErr) {
      setLoading(false);
      setError(pErr.message);
      return;
    }
    const plist = (prows ?? []) as Product[];
    const ids = plist.map((p) => p.id);
    let vmap = new Map<string, ProductVariant[]>();
    if (ids.length > 0) {
      const { data: vrows, error: vErr } = await supabase
        .from("product_variants")
        .select("*")
        .in("product_id", ids)
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (vErr) {
        setLoading(false);
        setError(vErr.message);
        return;
      }
      vmap = new Map();
      for (const v of (vrows ?? []) as ProductVariant[]) {
        const list = vmap.get(v.product_id) ?? [];
        list.push(v);
        vmap.set(v.product_id, list);
      }
    }

    const { data: dOrd, error: dErr } = await supabase
      .from("orders")
      .select("product")
      .in("status", ["confirmed", "follow"]);
    if (dErr) {
      setLoading(false);
      setError(dErr.message);
      return;
    }

    const { data: rOrd, error: rErr } = await supabase
      .from("orders")
      .select("product")
      .eq("sub_status", "returned");
    if (rErr) {
      setLoading(false);
      setError(rErr.message);
      return;
    }

    setDeliveryOrders((dOrd ?? []) as { product: string }[]);
    setReturnOrders((rOrd ?? []) as { product: string }[]);
    setProducts(
      plist.map((p) => ({
        ...p,
        variants: vmap.get(p.id) ?? [],
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const toggleExpand = (id: string) => {
    setExpanded((e) => ({ ...e, [id]: !e[id] }));
  };

  function openStock(target: StockAdjustTarget) {
    setStockTarget(target);
    setStockModalOpen(true);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Warehouse
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Inventory</h2>
          <p className="mt-1 text-sm text-slate-500">
            Active products only. Order counts match the order line product name (case-insensitive).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="flex gap-4 border-b border-slate-800/80">
        <button
          type="button"
          className="border-b-2 border-indigo-500 pb-3 text-sm font-semibold text-white"
        >
          Stock
        </button>
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
              ? "Loading…"
              : `${products.length} active product${products.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-medium">Product name</th>
                <th className="px-4 py-3 font-medium">Internal stock</th>
                <th className="px-4 py-3 font-medium">In delivery</th>
                <th className="px-4 py-3 font-medium">In return</th>
                <th className="px-4 py-3 font-medium">Purchase price</th>
                <th className="px-4 py-3 font-medium">Sale price</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!loading &&
                products.map((p) => {
                  const variantNames = p.variants.map((v) => v.name);
                  const aggregateNames =
                    p.variants.length > 0 ? [p.name, ...variantNames] : [p.name];
                  const inDelivery = countOrdersMatchingAnyProductName(
                    deliveryOrders,
                    aggregateNames
                  );
                  const inReturn = countOrdersMatchingAnyProductName(
                    returnOrders,
                    aggregateNames
                  );
                  const hasVariants = p.variants.length > 0;
                  const isOpen = expanded[p.id] ?? false;

                  return (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-slate-800/20">
                        <td className="px-4 py-3 font-medium text-slate-100">
                          <div className="flex items-center gap-2">
                            {hasVariants ? (
                              <button
                                type="button"
                                onClick={() => toggleExpand(p.id)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-600 text-slate-400 hover:bg-slate-800"
                                aria-expanded={isOpen}
                                title={isOpen ? "Collapse variants" : "Expand variants"}
                              >
                                {isOpen ? "▼" : "▶"}
                              </button>
                            ) : (
                              <span className="inline-block w-7" />
                            )}
                            <span>{p.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-200">
                          {p.current_stock ?? 0}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">
                          {inDelivery}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-300">
                          {inReturn}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-400">
                          {formatMoneyDzd(Number(p.purchase_price))}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-200">
                          {formatMoneyDzd(Number(p.sale_price))}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              openStock({
                                kind: "product",
                                productId: p.id,
                                label: p.name,
                                currentStock: p.current_stock ?? 0,
                                purchasePrice: Number(p.purchase_price),
                              })
                            }
                            className="rounded-lg border border-indigo-600/50 bg-indigo-950/40 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40"
                          >
                            Update stock
                          </button>
                        </td>
                      </tr>
                      {hasVariants &&
                        isOpen &&
                        p.variants.map((v) => {
                          const vDelivery = countOrdersMatchingAnyProductName(
                            deliveryOrders,
                            [v.name]
                          );
                          const vReturn = countOrdersMatchingAnyProductName(
                            returnOrders,
                            [v.name]
                          );
                          return (
                            <tr
                              key={v.id}
                              className="bg-slate-950/40 hover:bg-slate-800/15"
                            >
                              <td className="px-4 py-2 pl-14 text-sm text-slate-400">
                                {v.name}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-slate-300">
                                {Number(v.current_stock ?? 0)}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-slate-400">
                                {vDelivery}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-slate-400">
                                {vReturn}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-slate-500">
                                {formatMoneyDzd(Number(v.purchase_price))}
                              </td>
                              <td className="px-4 py-2 tabular-nums text-slate-300">
                                {formatMoneyDzd(Number(v.sale_price))}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    openStock({
                                      kind: "variant",
                                      productId: p.id,
                                      variantId: v.id,
                                      label: `${p.name} — ${v.name}`,
                                      currentStock: Number(v.current_stock ?? 0),
                                      purchasePrice: Number(v.purchase_price),
                                    })
                                  }
                                  className="rounded-lg border border-indigo-600/50 bg-indigo-950/40 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-900/40"
                                >
                                  Update stock
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      <StockAdjustModal
        open={stockModalOpen}
        target={stockTarget}
        onClose={() => {
          setStockModalOpen(false);
          setStockTarget(null);
        }}
        onSaved={() => void loadAll()}
      />
    </div>
  );
}
