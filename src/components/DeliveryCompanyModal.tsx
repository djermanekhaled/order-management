import { useState, type FormEvent } from "react";

const inputClass =
  "mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60";

const empty = {
  name: "",
  secret_key: "",
  tenant_id: "",
};

type DeliveryProvider = "zr_express" | "yalidine" | "noest" | "dhd" | "maystro";

const PROVIDERS: Array<{
  id: DeliveryProvider;
  name: string;
  logoUrl: string;
}> = [
  { id: "zr_express", name: "ZR Express", logoUrl: "https://zrexpress.app/favicon.ico" },
  { id: "yalidine", name: "Yalidine", logoUrl: "https://yalidine.app/favicon.ico" },
  { id: "noest", name: "Noest", logoUrl: "https://noest.dz/favicon.ico" },
  { id: "dhd", name: "DHD", logoUrl: "https://dhd.dz/favicon.ico" },
  { id: "maystro", name: "Maystro", logoUrl: "https://maystrodelivery.com/favicon.ico" },
];

interface DeliveryCompanyModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  insert: (row: typeof empty & { provider: DeliveryProvider }) => Promise<void>;
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
  const [selectedProvider, setSelectedProvider] = useState<DeliveryProvider | null>(null);

  if (!open) return null;

  function resetModal() {
    setValues(empty);
    setLocalError(null);
    setSelectedProvider(null);
  }

  function closeModal() {
    resetModal();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (
      !values.name.trim() ||
      !values.secret_key.trim() ||
      !values.tenant_id.trim()
    ) {
      setLocalError("Name, secret key, and tenant ID are required.");
      return;
    }
    setSaving(true);
    try {
      await insert({
        name: values.name.trim(),
        secret_key: values.secret_key.trim(),
        tenant_id: values.tenant_id.trim(),
        provider: selectedProvider ?? "zr_express",
      });
      resetModal();
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
        onClick={closeModal}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="dc-modal-title" className="text-lg font-semibold text-white">
            New delivery company
          </h2>
          <button
            type="button"
            onClick={closeModal}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>
        {!selectedProvider ? (
          <div className="space-y-4 px-5 py-5">
            <p className="text-sm text-slate-400">Step 1: Choose a delivery company</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedProvider(provider.id)}
                  className="group rounded-xl border border-slate-700 bg-slate-950 px-4 py-4 text-center text-slate-100 transition hover:-translate-y-0.5 hover:border-indigo-500/60 hover:bg-slate-900"
                >
                  <div className="flex min-h-12 items-center justify-center">
                    <img
                      src={provider.logoUrl}
                      alt={`${provider.name} logo`}
                      className="block h-9 w-9 object-contain"
                      loading="lazy"
                    />
                  </div>
                  <div className="mt-2 text-sm font-semibold text-slate-200 group-hover:text-white">
                    {provider.name}
                  </div>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={closeModal}
              className="w-full rounded-xl border border-slate-600 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 px-5 py-5">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-400">
                Step 2: {PROVIDERS.find((p) => p.id === selectedProvider)?.name} credentials
              </p>
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  setSelectedProvider(null);
                }}
                className="rounded-lg border border-slate-600 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Back
              </button>
            </div>
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
                placeholder="My delivery account"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {selectedProvider === "zr_express" ? "Secret Key" : "API Secret"}
              </label>
              <input
                required
                type="password"
                autoComplete="new-password"
                value={values.secret_key}
                onChange={(e) =>
                  setValues((v) => ({ ...v, secret_key: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                {selectedProvider === "zr_express" ? "Tenant ID" : "API Key / Account ID"}
              </label>
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
                onClick={closeModal}
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
        )}
      </div>
    </div>
  );
}
