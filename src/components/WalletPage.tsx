import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type TransactionType = "income" | "expense";

interface Wallet {
  id: string;
  name: string;
  created_at: string;
}

interface WalletTransaction {
  id: string;
  wallet_id: string;
  note: string | null;
  amount: number | string;
  type: TransactionType;
  created_at: string;
}

interface TransactionDraft {
  amount: string;
  type: TransactionType;
  note: string;
}

function formatMoneyDzd(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

const EMPTY_DRAFT: TransactionDraft = {
  amount: "",
  type: "income",
  note: "",
};

export function WalletPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createWalletOpen, setCreateWalletOpen] = useState(false);
  const [walletName, setWalletName] = useState("");

  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [transactionMode, setTransactionMode] = useState<"create" | "edit">(
    "create"
  );
  const [editingTransactionId, setEditingTransactionId] = useState<
    string | null
  >(null);
  const [draft, setDraft] = useState<TransactionDraft>(EMPTY_DRAFT);

  const loadWallets = useCallback(async () => {
    setLoadingWallets(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("wallets")
      .select("id, name, created_at")
      .order("created_at", { ascending: true });
    setLoadingWallets(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    const rows = (data ?? []) as Wallet[];
    setWallets(rows);
    setSelectedWalletId((current) => {
      if (rows.length === 0) return "";
      if (current && rows.some((w) => w.id === current)) return current;
      return rows[0].id;
    });
  }, []);

  const loadTransactions = useCallback(async (walletId: string) => {
    if (!walletId) {
      setTransactions([]);
      return;
    }
    setLoadingTransactions(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("transactions")
      .select("id, wallet_id, note, amount, type, created_at")
      .eq("wallet_id", walletId)
      .order("created_at", { ascending: false });
    setLoadingTransactions(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setTransactions((data ?? []) as WalletTransaction[]);
  }, []);

  useEffect(() => {
    void loadWallets();
  }, [loadWallets]);

  useEffect(() => {
    void loadTransactions(selectedWalletId);
  }, [selectedWalletId, loadTransactions]);

  const selectedWallet = wallets.find((w) => w.id === selectedWalletId) ?? null;

  const { totalIncome, totalExpense, balance } = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      const amount = Number(tx.amount) || 0;
      if (tx.type === "income") income += amount;
      else expense += amount;
    }
    return { totalIncome: income, totalExpense: expense, balance: income - expense };
  }, [transactions]);

  function openCreateTransaction(type: TransactionType) {
    setTransactionMode("create");
    setEditingTransactionId(null);
    setDraft({
      amount: "",
      type,
      note: "",
    });
    setTransactionModalOpen(true);
  }

  function openEditTransaction(tx: WalletTransaction) {
    setTransactionMode("edit");
    setEditingTransactionId(tx.id);
    setDraft({
      amount: String(Number(tx.amount) || 0),
      type: tx.type,
      note: tx.note ?? "",
    });
    setTransactionModalOpen(true);
  }

  async function createWallet() {
    const name = walletName.trim();
    if (!name) {
      setError("Wallet name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    const { data, error: insErr } = await supabase
      .from("wallets")
      .insert({ name })
      .select("id")
      .single();
    setSaving(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setCreateWalletOpen(false);
    setWalletName("");
    await loadWallets();
    if (data?.id) setSelectedWalletId(data.id);
  }

  async function saveTransaction() {
    if (!selectedWalletId) return;
    const amountNumber = Number(draft.amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    setSaving(true);
    setError(null);
    if (transactionMode === "create") {
      const { error: insErr } = await supabase.from("transactions").insert({
        wallet_id: selectedWalletId,
        amount: amountNumber,
        type: draft.type,
        note: draft.note.trim() || null,
      });
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    } else if (editingTransactionId) {
      const { error: upErr } = await supabase
        .from("transactions")
        .update({
          amount: amountNumber,
          type: draft.type,
          note: draft.note.trim() || null,
        })
        .eq("id", editingTransactionId);
      if (upErr) {
        setSaving(false);
        setError(upErr.message);
        return;
      }
    }
    setSaving(false);
    setTransactionModalOpen(false);
    setEditingTransactionId(null);
    setDraft(EMPTY_DRAFT);
    await loadTransactions(selectedWalletId);
  }

  async function deleteTransaction(tx: WalletTransaction) {
    if (
      !window.confirm("Delete this transaction? This action cannot be undone.")
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .eq("id", tx.id);
    setSaving(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await loadTransactions(selectedWalletId);
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Finance
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Wallet</h2>
          <p className="mt-1 text-sm text-slate-500">
            Track income and expense per wallet in real time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedWalletId}
            onChange={(e) => setSelectedWalletId(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-100"
            disabled={loadingWallets || wallets.length === 0}
          >
            {wallets.length === 0 ? (
              <option value="">No wallets yet</option>
            ) : (
              wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => setCreateWalletOpen(true)}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
          >
            Create Wallet
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

      {selectedWallet ? (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-xl ring-1 ring-white/5">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Balance
              </p>
              <p className="mt-2 text-4xl font-bold text-white">
                {formatMoneyDzd(balance)}
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-600/30 bg-emerald-950/30 p-5 shadow-xl ring-1 ring-emerald-400/10">
              <p className="text-xs uppercase tracking-wide text-emerald-400">
                Total Income
              </p>
              <p className="mt-2 text-2xl font-semibold text-emerald-200">
                {formatMoneyDzd(totalIncome)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-600/30 bg-rose-950/30 p-5 shadow-xl ring-1 ring-rose-400/10">
              <p className="text-xs uppercase tracking-wide text-rose-400">
                Total Expense
              </p>
              <p className="mt-2 text-2xl font-semibold text-rose-200">
                {formatMoneyDzd(totalExpense)}
              </p>
            </div>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openCreateTransaction("income")}
              className="rounded-xl border border-emerald-600/40 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/40"
            >
              Add Income
            </button>
            <button
              type="button"
              onClick={() => openCreateTransaction("expense")}
              className="rounded-xl border border-rose-600/40 bg-rose-950/40 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-900/40"
            >
              Add Expense
            </button>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl ring-1 ring-white/5">
            <div className="border-b border-slate-800/80 px-5 py-4 text-sm text-slate-400">
              {loadingTransactions
                ? "Loading transactions..."
                : `${transactions.length} transaction${
                    transactions.length === 1 ? "" : "s"
                  } in ${selectedWallet.name}`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-3 font-medium">Note</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {!loadingTransactions &&
                    transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-800/20">
                        <td className="px-5 py-3 text-slate-100">
                          {tx.note?.trim() ? tx.note : "-"}
                        </td>
                        <td className="px-5 py-3 font-medium tabular-nums text-slate-200">
                          {formatMoneyDzd(Number(tx.amount) || 0)}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ring-1 ${
                              tx.type === "income"
                                ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                                : "bg-rose-500/15 text-rose-300 ring-rose-500/30"
                            }`}
                          >
                            {tx.type === "income" ? "Income" : "Expense"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-400">
                          {formatDateTime(tx.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => openEditTransaction(tx)}
                              className="rounded-lg border border-slate-600 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
                              title="Edit transaction"
                            >
                              ✏️
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteTransaction(tx)}
                              className="rounded-lg border border-rose-600/40 px-2 py-1 text-sm text-rose-200 hover:bg-rose-950/40"
                              title="Delete transaction"
                              disabled={saving}
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-8 text-center text-slate-300 shadow-xl ring-1 ring-white/5">
          {loadingWallets ? "Loading wallets..." : "Create your first wallet to start."}
        </section>
      )}

      {createWalletOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Create Wallet</h3>
            <div className="mt-4 space-y-2">
              <label className="text-sm text-slate-300" htmlFor="wallet-name">
                Name
              </label>
              <input
                id="wallet-name"
                type="text"
                value={walletName}
                onChange={(e) => setWalletName(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2"
                placeholder="Main Wallet"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateWalletOpen(false);
                  setWalletName("");
                }}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createWallet()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                disabled={saving}
              >
                {saving ? "Saving..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionModalOpen && selectedWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              {transactionMode === "create"
                ? draft.type === "income"
                  ? "Add Income"
                  : "Add Expense"
                : "Edit Transaction"}
            </h3>
            <div className="mt-4 space-y-3">
              <div className="space-y-1">
                <label className="text-sm text-slate-300" htmlFor="tx-amount">
                  Amount
                </label>
                <input
                  id="tx-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.amount}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2"
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300" htmlFor="tx-type">
                  Type
                </label>
                <select
                  id="tx-type"
                  value={draft.type}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      type: e.target.value as TransactionType,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm text-slate-300" htmlFor="tx-note">
                  Note
                </label>
                <input
                  id="tx-note"
                  type="text"
                  value={draft.note}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, note: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none ring-indigo-500 focus:ring-2"
                  placeholder="Short note"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setTransactionModalOpen(false);
                  setEditingTransactionId(null);
                  setDraft(EMPTY_DRAFT);
                }}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveTransaction()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                disabled={saving}
              >
                {saving ? "Saving..." : transactionMode === "create" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
