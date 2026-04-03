import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { statusLabel, subStatusLabel } from "../lib/orderWorkflow";
import type {
  OrderStatus,
  OrderStatusHistoryRow,
  OrderSubStatus,
} from "../types/order";

interface OrderHistoryPanelProps {
  open: boolean;
  orderId: string | null;
  customerLabel: string;
  onClose: () => void;
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function OrderHistoryPanel({
  open,
  orderId,
  customerLabel,
  onClose,
}: OrderHistoryPanelProps) {
  const [rows, setRows] = useState<OrderStatusHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orderId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qErr } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setLoading(false);
      if (qErr) {
        setError(qErr.message);
        return;
      }
      setRows((data ?? []) as OrderStatusHistoryRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  if (!open) return null;

  function formatSnapshot(
    status: string,
    sub: string | null
  ): string {
    const st = statusLabel(status as OrderStatus);
    const su = subStatusLabel(sub as OrderSubStatus | null);
    if (sub == null || sub === "") return st;
    return `${st} · ${su}`;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="history-title" className="text-lg font-semibold text-white">
              Order history
            </h2>
            <p className="text-sm text-slate-400">{customerLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="text-sm text-slate-500">Loading history…</p>
          )}
          {error && (
            <p className="text-sm text-rose-300">{error}</p>
          )}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-slate-500">No status changes recorded.</p>
          )}
          <ul className="space-y-4">
            {rows.map((r) => (
              <li
                key={r.id}
                className="relative border-l-2 border-indigo-500/40 pl-4"
              >
                <p className="text-xs text-slate-500">
                  {formatDateTime(r.created_at)}
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {r.previous_status == null ? (
                    <>
                      Created as{" "}
                      <span className="font-medium text-indigo-300">
                        {formatSnapshot(r.new_status, r.new_sub_status)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-400">
                        {formatSnapshot(
                          r.previous_status,
                          r.previous_sub_status
                        )}
                      </span>
                      <span className="mx-1 text-slate-600">→</span>
                      <span className="font-medium text-indigo-300">
                        {formatSnapshot(r.new_status, r.new_sub_status)}
                      </span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
