import { useState, type FormEvent } from "react";

const empty = {
  name: "",
  store_url: "",
  consumer_key: "",
  consumer_secret: "",
};

interface SalesChannelModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  insert: (row: typeof empty) => Promise<void>;
}

export function SalesChannelModal({
  open,
  onClose,
  onSaved,
  insert,
}: SalesChannelModalProps) {
  const [values, setValues] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!values.name.trim() || !values.store_url.trim()) {
      setLocalError("Name and store URL are required.");
      return;
    }
    if (!values.consumer_key.trim() || !values.consumer_secret.trim()) {
      setLocalError("Consumer key and secret are required.");
      return;
    }
    setSaving(true);
    try {
      await insert({
        name: values.name.trim(),
        store_url: values.store_url.trim(),
        consumer_key: values.consumer_key.trim(),
        consumer_secret: values.consumer_secret.trim(),
      });
      setValues(empty);
      onSaved();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not save channel.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sc-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="sc-modal-title" className="text-lg font-semibold text-white">
            New sales channel
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {localError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
              {localError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Channel name
            </label>
            <input
              required
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="My WooCommerce store"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Store URL (WooCommerce)
            </label>
            <input
              type="url"
              required
              value={values.store_url}
              onChange={(e) =>
                setValues((v) => ({ ...v, store_url: e.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              placeholder="https://example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Consumer key
            </label>
            <input
              required
              autoComplete="off"
              value={values.consumer_key}
              onChange={(e) =>
                setValues((v) => ({ ...v, consumer_key: e.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">
              Consumer secret
            </label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={values.consumer_secret}
              onChange={(e) =>
                setValues((v) => ({ ...v, consumer_secret: e.target.value }))
              }
              className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-slate-600 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save channel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
