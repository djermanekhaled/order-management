import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { WILAYAS_58_LABELS } from "../constants/algeriaWilayas58";
import { MANUAL_ORDER_SOURCE } from "../constants/source";
import { supabase } from "../lib/supabase";

type OrderAnalyticsRow = {
  source: string | null;
  status: string;
  sub_status: string | null;
  amount: number;
};

function channelKey(source: string | null | undefined): string {
  const s = source?.trim();
  return s || MANUAL_ORDER_SOURCE;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

type ChannelStatsRow = {
  channel: string;
  total: number;
  confirmed: number;
  cancelled: number;
  delivered: number;
  returned: number;
  confirmationRate: number;
  deliveryRate: number;
  totalSales: number;
};

type ChartRow = {
  channel: string;
  total: number;
  confirmed: number;
  cancelled: number;
  confirmationRate: number;
  deliveryRate: number;
  totalSales: number;
};

const chartAxisTick = { fill: "#94a3b8", fontSize: 11 };
const chartAxisLine = { stroke: "#475569" };
const chartGrid = { stroke: "#334155", strokeDasharray: "3 3" };

function formatBarTooltipValue(value: unknown, suffix: string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  if (suffix === "%") return `${n}%`;
  if (suffix === " DZD") {
    return `${n.toLocaleString("fr-DZ", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })} DZD`;
  }
  return suffix ? `${n}${suffix}` : String(Math.round(n) === n ? n : Math.round(n * 100) / 100);
}

function BarTooltip({
  active,
  payload,
  label,
  valueSuffix = "",
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  valueSuffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-600/80 bg-slate-900/95 px-3 py-2 text-sm shadow-xl ring-1 ring-white/10">
      {label !== undefined && label !== null && label !== "" ? (
        <p className="mb-1 font-medium text-slate-100">{label}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((p, i) => (
          <li
            key={`${String(p.name)}-${i}`}
            className="flex items-center gap-2 tabular-nums text-slate-300"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ backgroundColor: p.color ?? "#64748b" }}
            />
            <span>
              {p.name}: {formatBarTooltipValue(p.value, valueSuffix)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SalesChannelsAnalyticsPage() {
  const [rows, setRows] = useState<OrderAnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [wilayaFilter, setWilayaFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [productOptions, setProductOptions] = useState<string[]>([]);

  const resetFilters = useCallback(() => {
    setDateFrom("");
    setDateTo("");
    setProductFilter("");
    setWilayaFilter("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("products")
      .select("name")
      .eq("active", true)
      .order("name")
      .then((res) => {
        if (cancelled) return;
        if (!res.error && res.data) {
          setProductOptions(
            [...new Set((res.data as { name: string }[]).map((x) => x.name.trim()))].filter(
              Boolean
            )
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    let query = supabase
      .from("orders")
      .select("source, status, sub_status, amount")
      .order("created_at", { ascending: false });

    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (productFilter) query = query.eq("product", productFilter);
    if (wilayaFilter) query = query.eq("wilaya", wilayaFilter);

    void query.then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      const data = (res.data ?? []) as OrderAnalyticsRow[];
      setRows(
        data.map((r) => ({
          ...r,
          amount: typeof r.amount === "number" ? r.amount : Number(r.amount) || 0,
        }))
      );
    });

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, productFilter, wilayaFilter]);

  const tableRows = useMemo((): ChannelStatsRow[] => {
    const map = new Map<
      string,
      {
        total: number;
        confirmed: number;
        cancelled: number;
        delivered: number;
        returned: number;
        totalSales: number;
      }
    >();

    for (const o of rows) {
      const ch = channelKey(o.source);
      let agg = map.get(ch);
      if (!agg) {
        agg = {
          total: 0,
          confirmed: 0,
          cancelled: 0,
          delivered: 0,
          returned: 0,
          totalSales: 0,
        };
        map.set(ch, agg);
      }
      agg.total += 1;
      if (o.status === "confirmed") {
        agg.confirmed += 1;
        agg.totalSales += o.amount;
      }
      if (o.status === "cancelled") agg.cancelled += 1;
      if (o.status === "completed" && o.sub_status === "delivered") agg.delivered += 1;
      if (o.status === "completed" && o.sub_status === "returned") agg.returned += 1;
    }

    return [...map.entries()]
      .map(([channel, a]) => ({
        channel,
        total: a.total,
        confirmed: a.confirmed,
        cancelled: a.cancelled,
        delivered: a.delivered,
        returned: a.returned,
        confirmationRate: pct(a.confirmed, a.total),
        deliveryRate: pct(a.delivered, a.confirmed),
        totalSales: a.totalSales,
      }))
      .sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));
  }, [rows]);

  const chartData = useMemo((): ChartRow[] => {
    return tableRows.map((r) => ({
      channel: r.channel,
      total: r.total,
      confirmed: r.confirmed,
      cancelled: r.cancelled,
      confirmationRate: Math.round(r.confirmationRate * 10) / 10,
      deliveryRate:
        r.confirmed > 0 ? Math.round(r.deliveryRate * 10) / 10 : 0,
      totalSales: Math.round(r.totalSales * 100) / 100,
    }));
  }, [tableRows]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
          >
            <Filter className="h-4 w-4" />
            Filters
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-600 hover:bg-slate-900"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
        {filtersOpen ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-400">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-400">Product</label>
              <select
                value={productFilter}
                onChange={(e) => setProductFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              >
                <option value="">All products</option>
                {productOptions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-xs text-slate-400">Wilaya</label>
              <select
                value={wilayaFilter}
                onChange={(e) => setWilayaFilter(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
              >
                <option value="">All wilayas</option>
                {WILAYAS_58_LABELS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-slate-400">Loading sales channel analytics…</div>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 ring-1 ring-white/5">
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/50 text-xs uppercase tracking-wider text-slate-400">
                    <th className="px-4 py-3 font-medium">Channel</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Total</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Confirmed</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Cancelled</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Delivered</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Returned</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Confirm %</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Delivery %</th>
                    <th className="px-4 py-3 font-medium text-right tabular-nums">Total sales (DZD)</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                        No orders match the current filters.
                      </td>
                    </tr>
                  ) : (
                    tableRows.map((r) => (
                      <tr
                        key={r.channel}
                        className="border-b border-slate-800/80 text-slate-200 last:border-0 hover:bg-slate-800/30"
                      >
                        <td className="px-4 py-3 font-medium text-slate-100">{r.channel}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{r.total}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-300/90">
                          {r.confirmed}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-rose-300/90">
                          {r.cancelled}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-sky-300/90">
                          {r.delivered}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-300/90">
                          {r.returned}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                          {r.confirmationRate.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">
                          {r.confirmed > 0 ? `${r.deliveryRate.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-100">
                          {r.totalSales.toLocaleString("fr-DZ", {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-1">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
              <h3 className="mb-1 text-base font-semibold text-slate-50">Orders by channel</h3>
              <p className="mb-4 text-xs text-slate-400">Total, confirmed, and cancelled counts</p>
              <div className="h-[320px] w-full min-h-[280px]">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid {...chartGrid} />
                      <XAxis
                        dataKey="channel"
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        interval={0}
                        angle={-28}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={
                          <BarTooltip valueSuffix="" />
                        }
                      />
                      <Legend
                        wrapperStyle={{ color: "#cbd5e1", fontSize: 12 }}
                        formatter={(value) => <span className="text-slate-300">{value}</span>}
                      />
                      <Bar dataKey="total" name="Total" fill="#64748b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="confirmed" name="Confirmed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cancelled" name="Cancelled" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
              <h3 className="mb-1 text-base font-semibold text-slate-50">Confirmation rate</h3>
              <p className="mb-4 text-xs text-slate-400">
                Confirmed orders as % of total orders per channel
              </p>
              <div className="h-[300px] w-full min-h-[260px]">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid {...chartGrid} />
                      <XAxis
                        dataKey="channel"
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        interval={0}
                        angle={-28}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip
                        content={
                          <BarTooltip valueSuffix="%" />
                        }
                      />
                      <Bar
                        dataKey="confirmationRate"
                        name="Confirmation rate"
                        fill="#a78bfa"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
              <h3 className="mb-1 text-base font-semibold text-slate-50">Delivery rate</h3>
              <p className="mb-4 text-xs text-slate-400">
                Delivered orders as % of confirmed orders per channel (0% when there are no
                confirmed orders)
              </p>
              <div className="h-[300px] w-full min-h-[260px]">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid {...chartGrid} />
                      <XAxis
                        dataKey="channel"
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        interval={0}
                        angle={-28}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <Tooltip content={<BarTooltip valueSuffix="%" />} />
                      <Bar
                        dataKey="deliveryRate"
                        name="Delivery rate"
                        fill="#2dd4bf"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
              <h3 className="mb-1 text-base font-semibold text-slate-50">Total sales</h3>
              <p className="mb-4 text-xs text-slate-400">
                Sum of line amount for confirmed orders (DZD)
              </p>
              <div className="h-[300px] w-full min-h-[260px]">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 48 }}>
                      <CartesianGrid {...chartGrid} />
                      <XAxis
                        dataKey="channel"
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        interval={0}
                        angle={-28}
                        textAnchor="end"
                        height={56}
                      />
                      <YAxis
                        tick={chartAxisTick}
                        axisLine={chartAxisLine}
                        tickLine={chartAxisLine}
                        tickFormatter={(v) =>
                          v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                        }
                      />
                      <Tooltip
                        content={
                          <BarTooltip valueSuffix=" DZD" />
                        }
                      />
                      <Bar dataKey="totalSales" name="Total sales" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
