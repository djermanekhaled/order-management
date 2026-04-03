import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { supabase } from "./lib/supabase";
import type { NewOrderInput, Order, OrderStatus } from "./types/order";

const STATUS_OPTIONS: OrderStatus[] = ["pending", "confirmed", "cancelled"];

function statusStyles(status: OrderStatus) {
  switch (status) {
    case "confirmed":
      return "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30";
    case "cancelled":
      return "bg-rose-500/15 text-rose-300 ring-rose-500/30";
    default:
      return "bg-amber-500/15 text-amber-200 ring-amber-500/30";
  }
}

function formatMoney(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [form, setForm] = useState<NewOrderInput>({
    customer_name: "",
    product: "",
    amount: 0,
  });
  const [submitting, setSubmitting] = useState(false);

  const loadOrders = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setOrders((data ?? []) as Order[]);
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const counts = useMemo(() => {
    return orders.reduce(
      (acc, o) => {
        acc[o.status] += 1;
        return acc;
      },
      { pending: 0, confirmed: 0, cancelled: 0 } as Record<OrderStatus, number>
    );
  }, [orders]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!form.customer_name.trim() || !form.product.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error: insErr } = await supabase.from("orders").insert({
      customer_name: form.customer_name.trim(),
      product: form.product.trim(),
      amount: form.amount,
      status: "pending",
    });
    setSubmitting(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setForm({ customer_name: "", product: "", amount: 0 });
    await loadOrders();
  }

  async function updateStatus(id: string, status: OrderStatus) {
    setSavingId(id);
    setError(null);
    const { error: upErr } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id);
    setSavingId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o))
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1419] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.18),transparent)]">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-indigo-400/90">
              SaaS dashboard
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Order management
            </h1>
            <p className="mt-2 max-w-xl text-slate-400">
              Track customer orders, amounts, and fulfillment status in one
              place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadOrders()}
            disabled={loading}
            className="inline-flex items-center justify-center rounded-xl border border-slate-700/80 bg-slate-800/50 px-4 py-2.5 text-sm font-medium text-slate-200 shadow-sm transition hover:border-slate-600 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {error && (
          <div
            className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
            role="alert"
          >
            {error}
          </div>
        )}

        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          {(
            [
              { key: "pending" as const, label: "Pending", accent: "amber" },
              { key: "confirmed" as const, label: "Confirmed", accent: "emerald" },
              { key: "cancelled" as const, label: "Cancelled", accent: "rose" },
            ] as const
          ).map(({ key, label, accent }) => (
            <div
              key={key}
              className={`rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 shadow-lg shadow-black/20 backdrop-blur-sm ring-1 ring-white/5`}
            >
              <p className="text-sm font-medium text-slate-400">{label}</p>
              <p
                className={`mt-1 text-3xl font-semibold tabular-nums ${
                  accent === "amber"
                    ? "text-amber-200"
                    : accent === "emerald"
                      ? "text-emerald-300"
                      : "text-rose-300"
                }`}
              >
                {counts[key]}
              </p>
            </div>
          ))}
        </section>

        <div className="grid gap-8 lg:grid-cols-5">
          <section className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6 shadow-xl shadow-black/25 backdrop-blur-md ring-1 ring-white/5">
              <h2 className="text-lg font-semibold text-white">New order</h2>
              <p className="mt-1 text-sm text-slate-400">
                Creates a row in your Supabase{" "}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-indigo-300">
                  orders
                </code>{" "}
                table.
              </p>
              <form onSubmit={handleAdd} className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="customer_name"
                    className="block text-sm font-medium text-slate-300"
                  >
                    Customer name
                  </label>
                  <input
                    id="customer_name"
                    required
                    value={form.customer_name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, customer_name: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none ring-indigo-500/0 transition placeholder:text-slate-600 focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="Jane Cooper"
                  />
                </div>
                <div>
                  <label
                    htmlFor="product"
                    className="block text-sm font-medium text-slate-300"
                  >
                    Product
                  </label>
                  <input
                    id="product"
                    required
                    value={form.product}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, product: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="Pro plan — annual"
                  />
                </div>
                <div>
                  <label
                    htmlFor="amount"
                    className="block text-sm font-medium text-slate-300"
                  >
                    Amount (USD)
                  </label>
                  <input
                    id="amount"
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={form.amount || ""}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        amount: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                    placeholder="0.00"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 transition hover:bg-indigo-500 disabled:opacity-60"
                >
                  {submitting ? "Saving…" : "Add order"}
                </button>
              </form>
            </div>
          </section>

          <section className="lg:col-span-3">
            <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl shadow-black/25 ring-1 ring-white/5">
              <div className="border-b border-slate-800/80 px-6 py-5">
                <h2 className="text-lg font-semibold text-white">All orders</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {loading
                    ? "Loading…"
                    : orders.length === 0
                      ? "No orders yet. Add one on the left."
                      : `${orders.length} order${orders.length === 1 ? "" : "s"}`}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-6 py-3 font-medium">Customer</th>
                      <th className="px-6 py-3 font-medium">Product</th>
                      <th className="px-6 py-3 font-medium">Amount</th>
                      <th className="px-6 py-3 font-medium">Status</th>
                      <th className="px-6 py-3 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {!loading &&
                      orders.map((o) => (
                        <tr
                          key={o.id}
                          className="transition hover:bg-slate-800/30"
                        >
                          <td className="px-6 py-4 font-medium text-slate-100">
                            {o.customer_name}
                          </td>
                          <td className="px-6 py-4 text-slate-300">
                            {o.product}
                          </td>
                          <td className="px-6 py-4 tabular-nums text-slate-200">
                            {formatMoney(Number(o.amount))}
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={o.status}
                              disabled={savingId === o.id}
                              onChange={(e) =>
                                void updateStatus(
                                  o.id,
                                  e.target.value as OrderStatus
                                )
                              }
                              className={`cursor-pointer rounded-lg border-0 px-2.5 py-1.5 text-xs font-semibold capitalize ring-1 ring-inset outline-none transition focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50 ${statusStyles(o.status)}`}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s} className="bg-slate-900">
                                  {s}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {formatDate(o.created_at)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
