import { useState, type FormEvent } from "react";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60";

const empty = {
  name: "",
  token: "",
  tenant_id: "",
};

interface DeliveryCompanyModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  insert: (row: typeof empty) => Promise<void>;
}

export function DeliveryCompanyModal({
  open,
  onClose,
  onSaved,
  insert,
}: DeliveryCompanyModalProps) {
  const [values, setValues] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!values.name.trim() || !values.token.trim() || !values.tenant_id.trim()) {
      setLocalError("Name, token, and tenant ID are required.");
      return;
    }
    setSaving(true);
    try {
      await insert({
        name: values.name.trim(),
        token: values.token.trim(),
        tenant_id: values.tenant_id.trim(),
      });
      setValues(empty);
      onSaved();
      onClose();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not save company.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dc-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="dc-modal-title" className="text-lg font-semibold text-white">
            New delivery company
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-5">
          <p className="text-xs text-slate-500">
            Type is fixed to <span className="text-slate-400">ZR Express</span> for API integration.
          </p>
          {localError && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-sm text-rose-200">
              {localError}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-300">Name</label>
            <input
              required
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              className={inputClass}
              placeholder="My ZR account"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">Token</label>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={values.token}
              onChange={(e) => setValues((v) => ({ ...v, token: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300">Tenant ID</label>
            <input
              required
              value={values.tenant_id}
              onChange={(e) => setValues((v) => ({ ...v, tenant_id: e.target.value }))}
              className={inputClass}
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
              {saving ? "Saving…" : "Save company"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
