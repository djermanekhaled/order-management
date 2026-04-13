import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type {
  Wallet,
  WalletCategory,
  WalletTransaction,
  WalletTransactionType,
} from "../types/wallet";

interface WalletDraft {
  name: string;
}

interface TransactionDraft {
  wallet_id: string;
  amount: string;
  note: string;
  type: WalletTransactionType;
  category_id: string;
}

function formatMoneyDzd(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 2,
  }).format(n);
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function inDateRange(
  iso: string,
  fromDate: string,
  toDate: string
): boolean {
  const t = new Date(iso).getTime();
  if (fromDate) {
    const from = new Date(`${fromDate}T00:00:00`).getTime();
    if (t < from) return false;
  }
  if (toDate) {
    const to = new Date(`${toDate}T23:59:59.999`).getTime();
    if (t > to) return false;
  }
  return true;
}

const EMPTY_WALLET_DRAFT: WalletDraft = { name: "" };

const EMPTY_TRANSACTION_DRAFT: TransactionDraft = {
  wallet_id: "",
  amount: "",
  note: "",
  type: "income",
  category_id: "",
};

export function WalletsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [categories, setCategories] = useState<WalletCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilterId, setCategoryFilterId] = useState("");

  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [singleDateFrom, setSingleDateFrom] = useState("");
  const [singleDateTo, setSingleDateTo] = useState("");
  const [singleCategoryId, setSingleCategoryId] = useState("");

  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletModalMode, setWalletModalMode] = useState<"create" | "edit">(
    "create"
  );
  const [editingWalletId, setEditingWalletId] = useState<string | null>(null);
  const [walletDraft, setWalletDraft] = useState<WalletDraft>(EMPTY_WALLET_DRAFT);

  const [transactionModalOpen, setTransactionModalOpen] = useState(false);
  const [transactionModalMode, setTransactionModalMode] = useState<
    "create" | "edit"
  >("create");
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(
    null
  );
  const [transactionDraft, setTransactionDraft] = useState<TransactionDraft>(
    EMPTY_TRANSACTION_DRAFT
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [walletsRes, txRes, catRes] = await Promise.all([
      supabase
        .from("wallets")
        .select("id, name, created_at, updated_at")
        .order("created_at", { ascending: true }),
      supabase
        .from("transactions")
        .select("id, wallet_id, category_id, note, amount, type, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("wallet_categories")
        .select("id, name, type, color, created_at")
        .order("name", { ascending: true }),
    ]);
    setLoading(false);

    if (walletsRes.error) {
      setError(walletsRes.error.message);
      return;
    }
    if (txRes.error) {
      setError(txRes.error.message);
      return;
    }
    if (catRes.error) {
      setError(catRes.error.message);
      return;
    }

    setWallets((walletsRes.data ?? []) as Wallet[]);
    setTransactions((txRes.data ?? []) as WalletTransaction[]);
    setCategories((catRes.data ?? []) as WalletCategory[]);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (categoryFilterId && tx.category_id !== categoryFilterId) return false;
      return inDateRange(tx.created_at, dateFrom, dateTo);
    });
  }, [transactions, categoryFilterId, dateFrom, dateTo]);

  const walletAggregates = useMemo(() => {
    const m = new Map<string, { income: number; expense: number; lastTx: string | null }>();
    for (const wallet of wallets) {
      m.set(wallet.id, { income: 0, expense: 0, lastTx: null });
    }
    for (const tx of filteredTransactions) {
      const agg = m.get(tx.wallet_id);
      if (!agg) continue;
      const amount = Number(tx.amount) || 0;
      if (tx.type === "income") agg.income += amount;
      else agg.expense += amount;
      if (!agg.lastTx || new Date(tx.created_at).getTime() > new Date(agg.lastTx).getTime()) {
        agg.lastTx = tx.created_at;
      }
    }
    return m;
  }, [wallets, filteredTransactions]);

  const totalIncome = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) => sum + (tx.type === "income" ? Number(tx.amount) || 0 : 0),
        0
      ),
    [filteredTransactions]
  );

  const totalExpense = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) => sum + (tx.type === "expense" ? Number(tx.amount) || 0 : 0),
        0
      ),
    [filteredTransactions]
  );

  const totalBalance = totalIncome - totalExpense;

  const selectedWallet = useMemo(
    () => wallets.find((w) => w.id === selectedWalletId) ?? null,
    [wallets, selectedWalletId]
  );

  const singleWalletTransactions = useMemo(() => {
    if (!selectedWalletId) return [];
    return transactions.filter((tx) => {
      if (tx.wallet_id !== selectedWalletId) return false;
      if (singleCategoryId && tx.category_id !== singleCategoryId) return false;
      return inDateRange(tx.created_at, singleDateFrom, singleDateTo);
    });
  }, [
    transactions,
    selectedWalletId,
    singleCategoryId,
    singleDateFrom,
    singleDateTo,
  ]);

  const singleTotals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of singleWalletTransactions) {
      const amount = Number(tx.amount) || 0;
      if (tx.type === "income") income += amount;
      else expense += amount;
    }
    return { income, expense, balance: income - expense };
  }, [singleWalletTransactions]);

  const categoryById = useMemo(() => {
    const m = new Map<string, WalletCategory>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const eligibleCategories = useMemo(
    () => categories.filter((c) => c.type === transactionDraft.type),
    [categories, transactionDraft.type]
  );

  useEffect(() => {
    if (!transactionModalOpen) return;
    if (eligibleCategories.some((c) => c.id === transactionDraft.category_id)) return;
    setTransactionDraft((prev) => ({
      ...prev,
      category_id: eligibleCategories[0]?.id ?? "",
    }));
  }, [transactionModalOpen, eligibleCategories, transactionDraft.category_id]);

  function openCreateWallet() {
    setWalletModalMode("create");
    setEditingWalletId(null);
    setWalletDraft(EMPTY_WALLET_DRAFT);
    setWalletModalOpen(true);
  }

  function openEditWallet(wallet: Wallet) {
    setWalletModalMode("edit");
    setEditingWalletId(wallet.id);
    setWalletDraft({ name: wallet.name });
    setWalletModalOpen(true);
  }

  async function saveWallet() {
    const name = walletDraft.name.trim();
    if (!name) {
      setError("Wallet name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    if (walletModalMode === "create") {
      const { error: insErr } = await supabase.from("wallets").insert({ name });
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    } else if (editingWalletId) {
      const { error: upErr } = await supabase
        .from("wallets")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", editingWalletId);
      if (upErr) {
        setSaving(false);
        setError(upErr.message);
        return;
      }
    }
    setSaving(false);
    setWalletModalOpen(false);
    setWalletDraft(EMPTY_WALLET_DRAFT);
    await loadAll();
  }

  async function deleteWallet(wallet: Wallet) {
    if (
      !window.confirm(
        `Delete wallet "${wallet.name}" and all its transactions? This cannot be undone.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    const { error: delErr } = await supabase.from("wallets").delete().eq("id", wallet.id);
    setSaving(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    if (selectedWalletId === wallet.id) {
      setSelectedWalletId(null);
    }
    await loadAll();
  }

  function openCreateTransaction(walletId: string, type: WalletTransactionType) {
    setTransactionModalMode("create");
    setEditingTransactionId(null);
    const firstCategory = categories.find((c) => c.type === type);
    setTransactionDraft({
      wallet_id: walletId,
      amount: "",
      note: "",
      type,
      category_id: firstCategory?.id ?? "",
    });
    setTransactionModalOpen(true);
  }

  function openEditTransaction(tx: WalletTransaction) {
    setTransactionModalMode("edit");
    setEditingTransactionId(tx.id);
    setTransactionDraft({
      wallet_id: tx.wallet_id,
      amount: String(Number(tx.amount) || 0),
      note: tx.note ?? "",
      type: tx.type,
      category_id: tx.category_id ?? "",
    });
    setTransactionModalOpen(true);
  }

  async function saveTransaction() {
    const amountNumber = Number(transactionDraft.amount);
    if (!transactionDraft.wallet_id) {
      setError("Please select a wallet.");
      return;
    }
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setError("Amount must be greater than 0.");
      return;
    }
    if (!transactionDraft.category_id) {
      setError("Please select a category.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      wallet_id: transactionDraft.wallet_id,
      amount: amountNumber,
      note: transactionDraft.note.trim() || null,
      type: transactionDraft.type,
      category_id: transactionDraft.category_id,
    };
    if (transactionModalMode === "create") {
      const { error: insErr } = await supabase.from("transactions").insert(payload);
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    } else if (editingTransactionId) {
      const { error: upErr } = await supabase
        .from("transactions")
        .update(payload)
        .eq("id", editingTransactionId);
      if (upErr) {
        setSaving(false);
        setError(upErr.message);
        return;
      }
    }
    await supabase
      .from("wallets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", transactionDraft.wallet_id);

    setSaving(false);
    setTransactionModalOpen(false);
    setEditingTransactionId(null);
    setTransactionDraft(EMPTY_TRANSACTION_DRAFT);
    await loadAll();
  }

  async function deleteTransaction(tx: WalletTransaction) {
    if (!window.confirm("Delete this transaction?")) return;
    setSaving(true);
    setError(null);
    const { error: delErr } = await supabase
      .from("transactions")
      .delete()
      .eq("id", tx.id);
    if (delErr) {
      setSaving(false);
      setError(delErr.message);
      return;
    }
    await supabase
      .from("wallets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", tx.wallet_id);
    setSaving(false);
    await loadAll();
  }

  if (selectedWallet) {
    return (
      <div className="space-y-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <button
              type="button"
              onClick={() => setSelectedWalletId(null)}
              className="mb-2 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              ← Back to Wallets
            </button>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
              Wallet
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">{selectedWallet.name}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openCreateTransaction(selectedWallet.id, "income")}
              className="rounded-xl border border-emerald-600/40 bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/40"
            >
              Add Income
            </button>
            <button
              type="button"
              onClick={() => openCreateTransaction(selectedWallet.id, "expense")}
              className="rounded-xl border border-rose-600/40 bg-rose-950/40 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-900/40"
            >
              Add Expense
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-xl ring-1 ring-white/5">
            <p className="text-xs uppercase tracking-wide text-slate-500">Balance</p>
            <p className="mt-2 text-3xl font-bold text-white">
              {formatMoneyDzd(singleTotals.balance)}
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-600/30 bg-emerald-950/30 p-5 shadow-xl ring-1 ring-emerald-400/10">
            <p className="text-xs uppercase tracking-wide text-emerald-400">Total Income</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-200">
              {formatMoneyDzd(singleTotals.income)}
            </p>
          </div>
          <div className="rounded-2xl border border-rose-600/30 bg-rose-950/30 p-5 shadow-xl ring-1 ring-rose-400/10">
            <p className="text-xs uppercase tracking-wide text-rose-400">Total Expenses</p>
            <p className="mt-2 text-2xl font-semibold text-rose-200">
              {formatMoneyDzd(singleTotals.expense)}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-xl ring-1 ring-white/5">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">Date from</span>
              <input
                type="date"
                value={singleDateFrom}
                onChange={(e) => setSingleDateFrom(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">Date to</span>
              <input
                type="date"
                value={singleDateTo}
                onChange={(e) => setSingleDateTo(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">Category</span>
              <select
                value={singleCategoryId}
                onChange={(e) => setSingleCategoryId(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">All categories</option>
                {categories.map((cat) => (
                  <option
                    key={cat.id}
                    value={cat.id}
                    style={{ color: cat.color ?? undefined }}
                  >
                    ● {cat.name} ({cat.type})
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl ring-1 ring-white/5">
          <div className="border-b border-slate-800/80 px-5 py-4 text-sm text-slate-400">
            {singleWalletTransactions.length} transaction
            {singleWalletTransactions.length === 1 ? "" : "s"}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 font-medium">Note</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {singleWalletTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/20">
                    <td className="px-5 py-3 text-slate-100">{tx.note?.trim() || "-"}</td>
                    <td className="px-5 py-3 text-slate-300">
                      {tx.category_id ? (
                        (() => {
                          const cat = categoryById.get(tx.category_id);
                          if (!cat) return "-";
                          return (
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full ring-1 ring-white/20"
                                style={{ backgroundColor: cat.color ?? "#94a3b8" }}
                              />
                              {cat.name}
                            </span>
                          );
                        })()
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-200">
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
                    <td className="px-5 py-3 text-slate-400">{formatDateTime(tx.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditTransaction(tx)}
                          className="rounded-lg border border-slate-600 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTransaction(tx)}
                          className="rounded-lg border border-rose-600/40 px-2 py-1 text-sm text-rose-200 hover:bg-rose-950/40"
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

        {transactionModalOpen && (
          <TransactionModal
            mode={transactionModalMode}
            draft={transactionDraft}
            categories={eligibleCategories}
            wallets={wallets}
            saving={saving}
            onDraftChange={setTransactionDraft}
            onClose={() => {
              setTransactionModalOpen(false);
              setEditingTransactionId(null);
              setTransactionDraft(EMPTY_TRANSACTION_DRAFT);
            }}
            onSave={() => void saveTransaction()}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Finance
          </p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Wallets</h2>
        </div>
        <button
          type="button"
          onClick={openCreateWallet}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
        >
          Create Wallet
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-5 shadow-xl ring-1 ring-white/5">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total Balance</p>
          <p className="mt-2 text-3xl font-bold text-white">{formatMoneyDzd(totalBalance)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-600/30 bg-emerald-950/30 p-5 shadow-xl ring-1 ring-emerald-400/10">
          <p className="text-xs uppercase tracking-wide text-emerald-400">Total Income</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-200">
            {formatMoneyDzd(totalIncome)}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-600/30 bg-rose-950/30 p-5 shadow-xl ring-1 ring-rose-400/10">
          <p className="text-xs uppercase tracking-wide text-rose-400">Total Expenses</p>
          <p className="mt-2 text-2xl font-semibold text-rose-200">
            {formatMoneyDzd(totalExpense)}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-xl ring-1 ring-white/5">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Date from</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Date to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Category</span>
            <select
              value={categoryFilterId}
              onChange={(e) => setCategoryFilterId(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">All categories</option>
              {categories.map((cat) => (
                <option
                  key={cat.id}
                  value={cat.id}
                  style={{ color: cat.color ?? undefined }}
                >
                  ● {cat.name} ({cat.type})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl ring-1 ring-white/5">
        <div className="border-b border-slate-800/80 px-5 py-4 text-sm text-slate-400">
          {loading ? "Loading wallets..." : `${wallets.length} wallet${wallets.length === 1 ? "" : "s"}`}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Balance</th>
                <th className="px-5 py-3 font-medium">Total Income</th>
                <th className="px-5 py-3 font-medium">Total Expenses</th>
                <th className="px-5 py-3 font-medium">Created At</th>
                <th className="px-5 py-3 font-medium">Last Modified</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {!loading &&
                wallets.map((wallet) => {
                  const agg = walletAggregates.get(wallet.id) ?? {
                    income: 0,
                    expense: 0,
                    lastTx: null,
                  };
                  const balance = agg.income - agg.expense;
                  const lastModified = wallet.updated_at ?? agg.lastTx ?? wallet.created_at;
                  return (
                    <tr key={wallet.id} className="hover:bg-slate-800/20">
                      <td className="px-5 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedWalletId(wallet.id)}
                          className="font-medium text-indigo-300 hover:text-indigo-200"
                        >
                          {wallet.name}
                        </button>
                      </td>
                      <td className="px-5 py-3 tabular-nums text-slate-200">
                        {formatMoneyDzd(balance)}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-emerald-300">
                        {formatMoneyDzd(agg.income)}
                      </td>
                      <td className="px-5 py-3 tabular-nums text-rose-300">
                        {formatMoneyDzd(agg.expense)}
                      </td>
                      <td className="px-5 py-3 text-slate-400">
                        {formatDateTime(wallet.created_at)}
                      </td>
                      <td className="px-5 py-3 text-slate-400">
                        {formatDateTime(lastModified)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedWalletId(wallet.id)}
                            className="rounded-lg border border-indigo-600/40 px-2 py-1 text-sm text-indigo-200 hover:bg-indigo-950/40"
                            title="Open wallet"
                          >
                            👁️
                          </button>
                          <button
                            type="button"
                            onClick={() => openCreateTransaction(wallet.id, "income")}
                            className="rounded-lg border border-emerald-600/40 px-2 py-1 text-sm text-emerald-200 hover:bg-emerald-950/40"
                            title="Add transaction"
                          >
                            ➕
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditWallet(wallet)}
                            className="rounded-lg border border-slate-600 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
                            title="Edit wallet"
                          >
                            ✏️
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteWallet(wallet)}
                            className="rounded-lg border border-rose-600/40 px-2 py-1 text-sm text-rose-200 hover:bg-rose-950/40"
                            title="Delete wallet"
                          >
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>

      {walletModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              {walletModalMode === "create" ? "Create Wallet" : "Edit Wallet"}
            </h3>
            <div className="mt-4 space-y-2">
              <label className="text-sm text-slate-300" htmlFor="wallet-name">
                Name
              </label>
              <input
                id="wallet-name"
                type="text"
                value={walletDraft.name}
                onChange={(e) => setWalletDraft({ name: e.target.value })}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWalletModalOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveWallet()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {transactionModalOpen && (
        <TransactionModal
          mode={transactionModalMode}
          draft={transactionDraft}
          categories={eligibleCategories}
          wallets={wallets}
          saving={saving}
          onDraftChange={setTransactionDraft}
          onClose={() => {
            setTransactionModalOpen(false);
            setEditingTransactionId(null);
            setTransactionDraft(EMPTY_TRANSACTION_DRAFT);
          }}
          onSave={() => void saveTransaction()}
        />
      )}
    </div>
  );
}

function TransactionModal({
  mode,
  draft,
  categories,
  wallets,
  saving,
  onDraftChange,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  draft: TransactionDraft;
  categories: WalletCategory[];
  wallets: Wallet[];
  saving: boolean;
  onDraftChange: (next: TransactionDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">
          {mode === "create" ? "Add Transaction" : "Edit Transaction"}
        </h3>
        <div className="mt-4 space-y-3">
          <label className="space-y-1">
            <span className="text-sm text-slate-300">Wallet</span>
            <select
              value={draft.wallet_id}
              onChange={(e) => onDraftChange({ ...draft, wallet_id: e.target.value })}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select wallet</option>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm text-slate-300">Amount</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.amount}
              onChange={(e) => onDraftChange({ ...draft, amount: e.target.value })}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Type: {draft.type === "income" ? "Income" : "Expense"}
          </p>
          <label className="space-y-1">
            <span className="text-sm text-slate-300">Category</span>
            <select
              value={draft.category_id}
              onChange={(e) => onDraftChange({ ...draft, category_id: e.target.value })}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select category</option>
              {categories.map((cat) => (
                <option
                  key={cat.id}
                  value={cat.id}
                  style={{ color: cat.color ?? undefined }}
                >
                  ● {cat.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm text-slate-300">Note</span>
            <input
              type="text"
              value={draft.note}
              onChange={(e) => onDraftChange({ ...draft, note: e.target.value })}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
