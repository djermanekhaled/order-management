import { useEffect, useMemo, useState } from "react";
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

function DonutChart({ title, segments }: { title: string; segments: Segment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const gradient = useMemo(() => {
    if (total <= 0) return "conic-gradient(#1e293b 0 100%)";
    let start = 0;
    const parts: string[] = [];
    for (const s of segments) {
      const ratio = s.value / total;
      const end = start + ratio * 100;
      parts.push(`${s.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
      start = end;
    }
    return `conic-gradient(${parts.join(", ")})`;
  }, [segments, total]);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
      <p className="text-sm font-semibold text-slate-100">{title}</p>
      <div className="mt-3 flex items-center gap-4">
        <div
          className="relative h-28 w-28 rounded-full"
          style={{ background: gradient }}
          aria-hidden
        >
          <div className="absolute inset-4 rounded-full bg-slate-900/95" />
        </div>
        <div className="space-y-1 text-xs text-slate-300">
          {segments.map((s) => (
            <div key={`${title}-${s.label}`} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="min-w-[7rem]">{s.label}</span>
              <span className="tabular-nums text-slate-400">
                {s.value} ({pct(s.value, total).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  percent,
}: {
  label: string;
  value: number;
  percent?: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {typeof percent === "number" ? (
        <p className="mt-1 text-sm text-slate-400">{percent.toFixed(1)}%</p>
      ) : null}
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

  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [salesChannelOptions, setSalesChannelOptions] = useState<string[]>([]);
  const [deliveryCompanyOptions, setDeliveryCompanyOptions] = useState<string[]>(
    []
  );

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
    const duplicated = rows.filter((o) => o.sub_status === "duplicated").length;
    const totalValid = total - duplicated;
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
      totalValid,
      pending,
      postponed,
      cancelled,
      confirmed,
      inDelivery,
      delivered,
      returned,
      totalValidPct: pct(totalValid, total),
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
              label="Total Orders (Valid)"
              value={stats.totalValid}
              percent={stats.totalValidPct}
            />
            <StatCard label="Pending Orders (Under Process)" value={stats.pending} />
            <StatCard label="Postponed Orders" value={stats.postponed} />
            <StatCard label="Cancelled Orders" value={stats.cancelled} />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Confirmed Orders" value={stats.confirmed} />
            <StatCard label="In Delivery (Cancelled)" value={stats.inDelivery} />
            <StatCard label="Delivered Orders" value={stats.delivered} />
            <StatCard label="Returned Orders" value={stats.returned} />
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
