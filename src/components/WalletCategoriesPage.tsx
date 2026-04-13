import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { WalletCategory, WalletTransactionType } from "../types/wallet";

interface CategoryDraft {
  name: string;
  type: WalletTransactionType;
}

const EMPTY_DRAFT: CategoryDraft = {
  name: "",
  type: "income",
};

export function WalletCategoriesPage() {
  const [categories, setCategories] = useState<WalletCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CategoryDraft>(EMPTY_DRAFT);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: qErr } = await supabase
      .from("wallet_categories")
      .select("id, name, type, created_at")
      .order("name", { ascending: true });
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setCategories((data ?? []) as WalletCategory[]);
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  function openCreate(type: WalletTransactionType) {
    setModalMode("create");
    setEditingId(null);
    setDraft({ name: "", type });
    setModalOpen(true);
  }

  function openEdit(cat: WalletCategory) {
    setModalMode("edit");
    setEditingId(cat.id);
    setDraft({ name: cat.name, type: cat.type });
    setModalOpen(true);
  }

  async function saveCategory() {
    const name = draft.name.trim();
    if (!name) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    if (modalMode === "create") {
      const { error: insErr } = await supabase
        .from("wallet_categories")
        .insert({ name, type: draft.type });
      if (insErr) {
        setSaving(false);
        setError(insErr.message);
        return;
      }
    } else if (editingId) {
      const { error: upErr } = await supabase
        .from("wallet_categories")
        .update({ name, type: draft.type })
        .eq("id", editingId);
      if (upErr) {
        setSaving(false);
        setError(upErr.message);
        return;
      }
    }
    setSaving(false);
    setModalOpen(false);
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    await loadCategories();
  }

  async function deleteCategory(cat: WalletCategory) {
    if (!window.confirm(`Delete "${cat.name}" category?`)) return;
    setSaving(true);
    setError(null);
    const { error: delErr } = await supabase
      .from("wallet_categories")
      .delete()
      .eq("id", cat.id);
    setSaving(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    await loadCategories();
  }

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
          Finance
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Wallet Categories</h2>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-xl ring-1 ring-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-emerald-200">Income Categories</h3>
          <button
            type="button"
            onClick={() => openCreate("income")}
            className="rounded-lg border border-emerald-600/40 px-3 py-1.5 text-sm font-medium text-emerald-200 hover:bg-emerald-950/40"
          >
            Add Income Category
          </button>
        </div>
        <CategoryRows
          rows={incomeCategories}
          loading={loading}
          onEdit={openEdit}
          onDelete={deleteCategory}
        />
      </section>

      <section className="rounded-2xl border border-slate-800/80 bg-slate-900/50 p-4 shadow-xl ring-1 ring-white/5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-rose-200">Expense Categories</h3>
          <button
            type="button"
            onClick={() => openCreate("expense")}
            className="rounded-lg border border-rose-600/40 px-3 py-1.5 text-sm font-medium text-rose-200 hover:bg-rose-950/40"
          >
            Add Expense Category
          </button>
        </div>
        <CategoryRows
          rows={expenseCategories}
          loading={loading}
          onEdit={openEdit}
          onDelete={deleteCategory}
        />
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              {modalMode === "create" ? "Add Category" : "Edit Category"}
            </h3>
            <div className="mt-4 space-y-3">
              <label className="space-y-1">
                <span className="text-sm text-slate-300">Name</span>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm text-slate-300">Type</span>
                <select
                  value={draft.type}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      type: e.target.value as WalletTransactionType,
                    }))
                  }
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveCategory()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryRows({
  rows,
  loading,
  onEdit,
  onDelete,
}: {
  rows: WalletCategory[];
  loading: boolean;
  onEdit: (cat: WalletCategory) => void;
  onDelete: (cat: WalletCategory) => void;
}) {
  if (loading) {
    return <p className="text-sm text-slate-400">Loading...</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400">No categories yet.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((cat) => (
        <div
          key={cat.id}
          className="flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-2"
        >
          <span className="text-sm text-slate-100">{cat.name}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onEdit(cat)}
              className="rounded-lg border border-slate-600 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
              title="Edit category"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={() => void onDelete(cat)}
              className="rounded-lg border border-rose-600/40 px-2 py-1 text-sm text-rose-200 hover:bg-rose-950/40"
              title="Delete category"
            >
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
