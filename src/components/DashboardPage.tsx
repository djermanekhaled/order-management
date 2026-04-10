import { useEffect, useMemo, useState } from "react";
import { WILAYAS_58_LABELS } from "../constants/algeriaWilayas58";
import { supabase } from "../lib/supabase";

type DashboardOrderRow = {
  status: string;
  sub_status: string | null;
};

type StatCardProps = {
  label: string;
  value: number;
  percent?: number;
};

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function StatCard({ label, value, percent }: StatCardProps) {
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

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DashboardOrderRow[]>([]);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [wilayaFilter, setWilayaFilter] = useState("");
  const [deliveryCompanyFilter, setDeliveryCompanyFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [deliveryCompanyOptions, setDeliveryCompanyOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>(["Manual"]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      supabase.from("products").select("name").eq("active", true).order("name"),
      supabase.from("delivery_companies").select("name").eq("active", true).order("name"),
      supabase.from("sales_channels").select("name").order("name"),
    ]).then(([pRes, dcRes, sRes]) => {
      if (cancelled) return;
      if (!pRes.error && pRes.data) {
        setProductOptions(
          [...new Set((pRes.data as { name: string }[]).map((x) => x.name.trim()).filter(Boolean))]
        );
      }
      if (!dcRes.error && dcRes.data) {
        setDeliveryCompanyOptions(
          [...new Set((dcRes.data as { name: string }[]).map((x) => x.name.trim()).filter(Boolean))]
        );
      }
      if (!sRes.error && sRes.data) {
        const names = (sRes.data as { name: string }[])
          .map((x) => x.name.trim())
          .filter(Boolean);
        setSourceOptions(["Manual", ...names]);
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
    if (wilayaFilter) query = query.eq("wilaya", wilayaFilter);
    if (deliveryCompanyFilter) query = query.eq("delivery_company", deliveryCompanyFilter);
    if (sourceFilter) query = query.eq("source", sourceFilter);

    void query.then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.error) {
        setError(res.error.message);
        return;
      }
      setRows((res.data ?? []) as DashboardOrderRow[]);
    });

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, productFilter, wilayaFilter, deliveryCompanyFilter, sourceFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const confirmed = rows.filter((o) => o.status === "confirmed").length;
    const cancelled = rows.filter((o) => o.status === "cancelled").length;
    const underProcess = rows.filter((o) => o.status === "under_process").length;
    const delivered = rows.filter((o) => o.status === "completed" && o.sub_status === "delivered").length;
    const returned = rows.filter((o) => o.status === "completed" && o.sub_status === "returned").length;
    const tracking = rows.filter((o) => o.status === "follow").length;

    return {
      total,
      confirmed,
      cancelled,
      underProcess,
      delivered,
      returned,
      tracking,
      confirmationRate: pct(confirmed, total),
      deliveryRate: pct(delivered, confirmed),
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 ring-1 ring-white/5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100" />
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="">All products</option>
            {productOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={wilayaFilter} onChange={(e) => setWilayaFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="">All wilayas</option>
            {WILAYAS_58_LABELS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={deliveryCompanyFilter} onChange={(e) => setDeliveryCompanyFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="">All delivery companies</option>
            {deliveryCompanyOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100">
            <option value="">All sources</option>
            {sourceOptions.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-indigo-500/30 bg-indigo-950/20 p-5 ring-1 ring-indigo-500/20">
          <p className="text-xs uppercase tracking-wider text-indigo-300">Taux de Confirmation</p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.confirmationRate.toFixed(1)}%</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 ring-1 ring-emerald-500/20">
          <p className="text-xs uppercase tracking-wider text-emerald-300">Taux de Livraison</p>
          <p className="mt-2 text-3xl font-semibold text-white">{stats.deliveryRate.toFixed(1)}%</p>
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-slate-400">Loading dashboard…</div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Total Orders" value={stats.total} />
          <StatCard label="Confirmed Orders" value={stats.confirmed} percent={pct(stats.confirmed, stats.total)} />
          <StatCard label="Cancelled Orders" value={stats.cancelled} percent={pct(stats.cancelled, stats.total)} />
          <StatCard label="Under Process Orders" value={stats.underProcess} percent={pct(stats.underProcess, stats.total)} />
          <StatCard label="Delivered Orders" value={stats.delivered} percent={pct(stats.delivered, stats.confirmed)} />
          <StatCard label="Returned Orders" value={stats.returned} percent={pct(stats.returned, stats.confirmed)} />
          <StatCard label="Tracking Orders / In Shipping" value={stats.tracking} />
        </section>
      )}
    </div>
  );
}

