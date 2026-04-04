import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { DeliveryCompany } from "../types/deliveryCompany";
import { DeliveryCompanyModal } from "./DeliveryCompanyModal";

interface DeliveryCompaniesPageProps {
  companyModalOpen: boolean;
  onCompanyModalOpen: () => void;
  onCompanyModalClose: () => void;
  onCompaniesChanged?: () => void;
}

export function DeliveryCompaniesPage({
  companyModalOpen,
  onCompanyModalOpen,
  onCompanyModalClose,
  onCompaniesChanged,
}: DeliveryCompaniesPageProps) {
  const [companies, setCompanies] = useState<DeliveryCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadCompanies = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("delivery_companies")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setCompanies((data ?? []) as DeliveryCompany[]);
  }, []);

  useEffect(() => {
    void loadCompanies();
  }, [loadCompanies]);

  async function insertCompany(row: {
    name: string;
    secret_key: string;
    tenant_id: string;
  }) {
    const { error: insErr } = await supabase.from("delivery_companies").insert({
      name: row.name,
      secret_key: row.secret_key,
      tenant_id: row.tenant_id,
      type: "zr_express",
      active: true,
    });
    if (insErr) throw new Error(insErr.message);
    await loadCompanies();
    onCompaniesChanged?.();
  }

  async function toggleActive(id: string, next: boolean) {
    setError(null);
    const { error: upErr } = await supabase
      .from("delivery_companies")
      .update({ active: next })
      .eq("id", id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    await loadCompanies();
    onCompaniesChanged?.();
  }

  async function deleteCompany(c: DeliveryCompany) {
    if (
      !window.confirm(`Delete delivery company "${c.name}"? Orders keep the assigned name text.`)
    ) {
      return;
    }
    setError(null);
    const { error: delErr } = await supabase.from("delivery_companies").delete().eq("id", c.id);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await loadCompanies();
    onCompaniesChanged?.();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Logistics
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Delivery companies</h2>
          <p className="mt-1 text-sm text-slate-500">
            ZR Express credentials (tenant + secret key). Assign companies on the Confirmed orders tab.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadCompanies()}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={onCompanyModalOpen}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
          >
            New company
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
              ? "Loading…"
              : `${companies.length} compan${companies.length === 1 ? "y" : "ies"}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!loading &&
                companies.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/20">
                    <td className="px-5 py-3 font-medium text-slate-100">{c.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{c.type}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${
                          c.active
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "bg-slate-600/30 text-slate-300 ring-1 ring-slate-600/50"
                        }`}
                      >
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex justify-end flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleActive(c.id, !c.active)}
                          className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          {c.active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteCompany(c)}
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

      <DeliveryCompanyModal
        open={companyModalOpen}
        onClose={onCompanyModalClose}
        onSaved={() => {}}
        insert={insertCompany}
      />
    </div>
  );
}
