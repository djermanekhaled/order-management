import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle,
  Clock,
  Filter,
  Package,
  PackageCheck,
  PackageX,
  RefreshCw,
  RotateCcw,
  Truck,
  XCircle,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts";
import { WILAYAS_58_LABELS } from "../constants/algeriaWilayas58";
import { supabase } from "../lib/supabase";

type AnalyticsRow = {
  status: string;
  sub_status: string | null;
};

type Segment = {
  label: string;
  value: number;
  color: string;
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

type PieDatum = { name: string; value: number; fill: string };

function DonutTooltip({
  active,
  payload,
  sliceSum,
}: TooltipProps<number, string> & { sliceSum: number }) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const name = String(row.name ?? "");
  const count = typeof row.value === "number" ? row.value : Number(row.value);
  const pct = sliceSum > 0 ? (count / sliceSum) * 100 : 0;
  return (
    <div className="rounded-lg border border-slate-600/80 bg-slate-900/95 px-3 py-2 text-sm shadow-xl ring-1 ring-white/10 backdrop-blur-sm">
      <p className="font-medium text-slate-50">{name}</p>
      <p className="mt-0.5 tabular-nums text-slate-300">Count: {count}</p>
      <p className="mt-0.5 tabular-nums text-slate-400">{pct.toFixed(1)}%</p>
    </div>
  );
}

function DonutChart({ title, segments }: { title: string; segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const chartData = useMemo<PieDatum[]>(
    () =>
      segments
        .filter((s) => s.value > 0)
        .map((s) => ({
          name: s.label,
          value: s.value,
          fill: s.color,
        })),
    [segments]
  );

  const sliceSum = useMemo(
    () => chartData.reduce((sum, d) => sum + d.value, 0),
    [chartData]
  );

  const renderSliceLabel = useCallback(
    (props: {
      cx: number;
      cy: number;
      midAngle: number;
      innerRadius: number;
      outerRadius: number;
      percent: number;
    }) => {
      const p = props.percent;
      if (p <= 0 || !Number.isFinite(p)) return null;
      const RAD = Math.PI / 180;
      const r = props.innerRadius + (props.outerRadius - props.innerRadius) * 0.55;
      const x = props.cx + r * Math.cos(-props.midAngle * RAD);
      const y = props.cy + r * Math.sin(-props.midAngle * RAD);
      return (
        <text
          x={x}
          y={y}
          fill="#f8fafc"
          textAnchor="middle"
          dominantBaseline="central"
          className="text-[11px] font-semibold tabular-nums"
          style={{ paintOrder: "stroke", stroke: "rgba(15,23,42,0.85)", strokeWidth: 3 }}
        >
          {(p * 100).toFixed(1)}%
        </text>
      );
    },
    []
  );

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
      <h3 className="border-b border-slate-800/90 pb-2 text-base font-semibold tracking-tight text-slate-50">
        {title}
      </h3>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="h-[220px] w-full min-h-[220px]">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No data for this chart
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius="52%"
                  outerRadius="78%"
                  paddingAngle={1.5}
                  stroke="rgb(15 23 42 / 0.9)"
                  strokeWidth={2}
                  label={renderSliceLabel}
                  labelLine={false}
                  isAnimationActive={false}
                >
                  {chartData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip sliceSum={sliceSum} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <ul className="w-full space-y-2 border-t border-slate-800/80 pt-3">
          {segments.map((s) => {
            const p = pct(s.value, total);
            return (
              <li
                key={`${title}-${s.label}`}
                className="flex items-baseline justify-between gap-3 text-sm text-slate-200"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/15"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="truncate font-medium">{s.label}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-400">
                  <span className="text-slate-200">{s.value}</span>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span>{p.toFixed(1)}%</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  Icon,
  label,
  value,
  percentOfTotal,
  className,
  iconClassName,
}: {
  Icon: LucideIcon;
  label: string;
  value: number;
  percentOfTotal: number;
  className: string;
  iconClassName: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ring-1 ${className}`}>
      <div className="flex items-center gap-2">
        <Icon className={`h-7 w-7 shrink-0 ${iconClassName}`} strokeWidth={2} />
        <p className="text-xs uppercase tracking-wider text-slate-200/80">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-sm text-slate-200/80">
        {percentOfTotal.toFixed(1)}% of total
      </p>
    </div>
  );
}

export function OrdersAnalyticsPage() {
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [salesChannelFilter, setSalesChannelFilter] = useState("");
  const [wilayaFilter, setWilayaFilter] = useState("");
  const [deliveryCompanyFilter, setDeliveryCompanyFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [salesChannelOptions, setSalesChannelOptions] = useState<string[]>([]);
  const [deliveryCompanyOptions, setDeliveryCompanyOptions] = useState<string[]>(
    []
  );

  const resetFilters = useCallback(() => {
    setDateFrom("");
    setDateTo("");
    setProductFilter("");
    setSalesChannelFilter("");
    setWilayaFilter("");
    setDeliveryCompanyFilter("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from("products").select("name").eq("active", true).order("name"),
      supabase.from("sales_channels").select("name").order("name"),
      supabase
        .from("delivery_companies")
        .select("name")
        .eq("active", true)
        .order("name"),
    ]).then(([pRes, sRes, dRes]) => {
      if (cancelled) return;
      if (!pRes.error && pRes.data) {
        setProductOptions(
          [...new Set((pRes.data as { name: string }[]).map((x) => x.name.trim()))].filter(
            Boolean
          )
        );
      }
      if (!sRes.error && sRes.data) {
        setSalesChannelOptions(
          [...new Set((sRes.data as { name: string }[]).map((x) => x.name.trim()))].filter(
            Boolean
          )
        );
      }
      if (!dRes.error && dRes.data) {
        setDeliveryCompanyOptions(
          [...new Set((dRes.data as { name: string }[]).map((x) => x.name.trim()))].filter(
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
      .select("status, sub_status")
      .order("created_at", { ascending: false });

    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (productFilter) query = query.eq("product", productFilter);
    if (salesChannelFilter) query = query.eq("source", salesChannelFilter);
    if (wilayaFilter) query = query.eq("wilaya", wilayaFilter);
    if (deliveryCompanyFilter) {
      query = query.eq("delivery_company", deliveryCompanyFilter);
    }

    void query.then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setRows((res.data ?? []) as AnalyticsRow[]);
    });

    return () => {
      cancelled = true;
    };
  }, [
    dateFrom,
    dateTo,
    productFilter,
    salesChannelFilter,
    wilayaFilter,
    deliveryCompanyFilter,
  ]);

  const stats = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((o) => o.status === "under_process").length;
    const postponed = rows.filter((o) => o.sub_status === "postponed").length;
    const cancelled = rows.filter((o) => o.status === "cancelled").length;
    const confirmed = rows.filter((o) => o.status === "confirmed").length;
    const inDelivery = rows.filter((o) => o.status === "follow").length;
    const delivered = rows.filter(
      (o) => o.status === "completed" && o.sub_status === "delivered"
    ).length;
    const returned = rows.filter(
      (o) => o.status === "completed" && o.sub_status === "returned"
    ).length;
    return {
      total,
      pending,
      postponed,
      cancelled,
      confirmed,
      inDelivery,
      delivered,
      returned,
    };
  }, [rows]);

  const confirmationSegments = useMemo<Segment[]>(
    () => [
      { label: "Call 1", value: rows.filter((o) => o.sub_status === "call_1").length, color: "#60a5fa" },
      { label: "Call 2", value: rows.filter((o) => o.sub_status === "call_2").length, color: "#818cf8" },
      { label: "Call 3", value: rows.filter((o) => o.sub_status === "call_3").length, color: "#c084fc" },
      { label: "Busy", value: rows.filter((o) => o.sub_status === "busy").length, color: "#f59e0b" },
      { label: "Postponed", value: rows.filter((o) => o.sub_status === "postponed").length, color: "#f97316" },
      { label: "Confirmed", value: rows.filter((o) => o.sub_status === "confirmed").length, color: "#22c55e" },
      { label: "Duplicated", value: rows.filter((o) => o.sub_status === "duplicated").length, color: "#ef4444" },
    ],
    [rows]
  );

  const cancelledSegments = useMemo<Segment[]>(() => {
    const map = new Map<string, number>();
    for (const o of rows.filter((r) => r.status === "cancelled")) {
      const key = o.sub_status ?? "unknown";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const palette = ["#f43f5e", "#fb7185", "#e11d48", "#be123c", "#9f1239"];
    return [...map.entries()].map(([label, value], i) => ({
      label,
      value,
      color: palette[i % palette.length],
    }));
  }, [rows]);

  const followSegments = useMemo<Segment[]>(() => {
    const map = new Map<string, number>();
    for (const o of rows.filter((r) => r.status === "follow")) {
      const key = o.sub_status ?? "follow";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const palette = ["#10b981", "#34d399", "#059669", "#2dd4bf", "#14b8a6"];
    return [...map.entries()].map(([label, value], i) => ({
      label,
      value,
      color: palette[i % palette.length],
    }));
  }, [rows]);

  const completedSegments = useMemo<Segment[]>(
    () => [
      {
        label: "Delivered",
        value: rows.filter(
          (o) => o.status === "completed" && o.sub_status === "delivered"
        ).length,
        color: "#22c55e",
      },
      {
        label: "Returned",
        value: rows.filter(
          (o) => o.status === "completed" && o.sub_status === "returned"
        ).length,
        color: "#ef4444",
      },
    ],
    [rows]
  );

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
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            />
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value="">All products</option>
              {productOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select
              value={salesChannelFilter}
              onChange={(e) => setSalesChannelFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value="">All sales channels</option>
              {salesChannelOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select
              value={wilayaFilter}
              onChange={(e) => setWilayaFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value="">All wilayas</option>
              {WILAYAS_58_LABELS.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select
              value={deliveryCompanyFilter}
              onChange={(e) => setDeliveryCompanyFilter(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
            >
              <option value="">All delivery companies</option>
              {deliveryCompanyOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-slate-400">Loading analytics...</div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              Icon={Package}
              label="Total Orders"
              value={stats.total}
              percentOfTotal={pct(stats.total, stats.total)}
              className="border-slate-700/80 bg-slate-900/60 ring-white/5"
              iconClassName="text-white"
            />
            <StatCard
              Icon={RefreshCw}
              label="Under Process"
              value={stats.pending}
              percentOfTotal={pct(stats.pending, stats.total)}
              className="border-sky-500/30 bg-sky-950/30 ring-sky-400/10"
              iconClassName="text-sky-300"
            />
            <StatCard
              Icon={Clock}
              label="Postponed"
              value={stats.postponed}
              percentOfTotal={pct(stats.postponed, stats.total)}
              className="border-amber-500/30 bg-amber-950/30 ring-amber-400/10"
              iconClassName="text-yellow-300"
            />
            <StatCard
              Icon={XCircle}
              label="Cancelled"
              value={stats.cancelled}
              percentOfTotal={pct(stats.cancelled, stats.total)}
              className="border-rose-500/30 bg-rose-950/30 ring-rose-400/10"
              iconClassName="text-rose-300"
            />
            <StatCard
              Icon={CheckCircle}
              label="Confirmed"
              value={stats.confirmed}
              percentOfTotal={pct(stats.confirmed, stats.total)}
              className="border-emerald-500/30 bg-emerald-950/30 ring-emerald-400/10"
              iconClassName="text-emerald-300"
            />
            <StatCard
              Icon={Truck}
              label="In Delivery"
              value={stats.inDelivery}
              percentOfTotal={pct(stats.inDelivery, stats.total)}
              className="border-blue-500/30 bg-blue-950/30 ring-blue-400/10"
              iconClassName="text-blue-400"
            />
            <StatCard
              Icon={PackageCheck}
              label="Delivered"
              value={stats.delivered}
              percentOfTotal={pct(stats.delivered, stats.total)}
              className="border-green-500/30 bg-green-950/30 ring-green-400/10"
              iconClassName="text-green-400"
            />
            <StatCard
              Icon={PackageX}
              label="Returned"
              value={stats.returned}
              percentOfTotal={pct(stats.returned, stats.total)}
              className="border-red-700/30 bg-red-950/40 ring-red-600/10"
              iconClassName="text-red-800"
            />
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DonutChart title="Confirmation" segments={confirmationSegments} />
            <DonutChart title="Cancelled" segments={cancelledSegments} />
            <DonutChart title="Follow" segments={followSegments} />
            <DonutChart title="Completed" segments={completedSegments} />
          </section>
        </>
      )}
    </div>
  );
}
