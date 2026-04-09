import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { SalesChannel, SalesChannelStatus } from "../types/salesChannel";
import { SalesChannelModal } from "./SalesChannelModal";

function appApiUrl(path: string): string {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim()) {
    return `${o.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

async function registerWooWebhookForChannel(channelId: string): Promise<void> {
  const res = await fetch(appApiUrl("/api/handler?action=register-woo-webhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_id: channelId }),
  });
  const raw = await res.text();
  let body: { error?: string } = {};
  try {
    body = raw ? (JSON.parse(raw) as { error?: string }) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(body.error ?? `Webhook registration failed (${res.status})`);
  }
}

interface SalesChannelsPageProps {
  channelModalOpen: boolean;
  onChannelModalOpen: () => void;
  onChannelModalClose: () => void;
  onChannelsChanged?: () => void;
}

export function SalesChannelsPage({
  channelModalOpen,
  onChannelModalOpen,
  onChannelModalClose,
  onChannelsChanged,
}: SalesChannelsPageProps) {
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("sales_channels")
      .select(
        "id, name, store_url, consumer_key, consumer_secret, status, last_synced_at, woo_webhook_id, created_at, updated_at"
      )
      .order("created_at", { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setChannels((data ?? []) as SalesChannel[]);
  }, []);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  async function insertChannel(row: {
    name: string;
    store_url: string;
    consumer_key: string;
    consumer_secret: string;
  }) {
    const { data: inserted, error: insErr } = await supabase
      .from("sales_channels")
      .insert({
        name: row.name,
        store_url: row.store_url,
        consumer_key: row.consumer_key,
        consumer_secret: row.consumer_secret,
        status: "active",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);
    if (inserted?.id) {
      try {
        await registerWooWebhookForChannel(inserted.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          `Channel saved, but WooCommerce webhook registration failed: ${msg}. Activate the channel again to retry.`
        );
      }
    }
    await loadChannels();
    onChannelsChanged?.();
  }

  async function toggleStatus(id: string, next: SalesChannelStatus) {
    setError(null);
    const { error: upErr } = await supabase
      .from("sales_channels")
      .update({ status: next })
      .eq("id", id);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    if (next === "active") {
      try {
        await registerWooWebhookForChannel(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Channel activated, but webhook registration failed: ${msg}. Try Activate again.`);
      }
    }
    await loadChannels();
    onChannelsChanged?.();
  }

  async function deleteChannel(ch: SalesChannel) {
    if (
      !window.confirm(
        `Remove "${ch.name}" from connected channels? This disconnects the store from this dashboard.`
      )
    ) {
      return;
    }
    setError(null);
    setDeletingId(ch.id);
    const { error: delErr } = await supabase
      .from("sales_channels")
      .delete()
      .eq("id", ch.id);
    setDeletingId(null);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await loadChannels();
    onChannelsChanged?.();
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Integrations
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Sales channels</h2>
          <p className="mt-1 text-sm text-slate-500">
            Connect WooCommerce stores with REST API keys. New orders are pushed via a
            registered webhook; pending orders also sync periodically while the app is open.
            Imported orders use the channel name as{" "}
            <span className="text-slate-400">source</span>.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadChannels()}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={onChannelModalOpen}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
          >
            New channel
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
              ? "Loading channels…"
              : `${channels.length} connected channel${channels.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Store URL</th>
                <th className="px-5 py-3 font-medium">Import</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!loading &&
                channels.map((ch) => (
                  <tr key={ch.id} className="hover:bg-slate-800/20">
                    <td className="px-5 py-3 font-medium text-slate-100">
                      {ch.name}
                    </td>
                    <td className="max-w-[280px] truncate px-5 py-3 text-slate-400">
                      <a
                        href={ch.store_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-300 hover:underline"
                      >
                        {ch.store_url}
                      </a>
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      <span
                        className="inline-flex rounded-lg bg-slate-800/80 px-2 py-1 text-xs font-medium text-slate-300 ring-1 ring-slate-600/50"
                        title="Background job runs while the app is open"
                      >
                        Auto · every 1 min
                      </span>
                      {ch.status !== "active" ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Activate the channel to include it in imports.
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${
                          ch.status === "active"
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                            : "bg-slate-600/30 text-slate-300 ring-1 ring-slate-600/50"
                        }`}
                      >
                        {ch.status === "active" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void toggleStatus(
                              ch.id,
                              ch.status === "active" ? "inactive" : "active"
                            )
                          }
                          className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                        >
                          {ch.status === "active" ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          disabled={deletingId === ch.id}
                          onClick={() => void deleteChannel(ch)}
                          className="rounded-lg border border-rose-600/50 bg-rose-950/30 px-2 py-1 text-xs font-medium text-rose-200 hover:bg-rose-950/50 disabled:cursor-not-allowed disabled:opacity-50"
                          title="Remove this channel from the dashboard"
                        >
                          {deletingId === ch.id ? "Removing…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <SalesChannelModal
        open={channelModalOpen}
        onClose={onChannelModalClose}
        onSaved={() => {}}
        insert={insertChannel}
      />
    </div>
  );
}
