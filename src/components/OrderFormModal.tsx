import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ALGERIA_WILAYAS_58,
  formatWilayaLabel58,
  parseWilayaCodeFromLabel,
} from "../constants/algeriaWilayas58";
import { supabase } from "../lib/supabase";
import { isValidOrderState } from "../lib/orderWorkflow";
import { generateInternalTrackingId } from "../lib/internalTracking";
import type {
  Order,
  OrderDeliveryType,
  OrderFormValues,
  OrderSnapshot,
} from "../types/order";

function appApiUrl(path: string): string {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim()) {
    return `${o.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

const emptyForm: OrderFormValues = {
  customer_name: "",
  phone: "",
  wilaya: "",
  commune: "",
  wilaya_territory_id: "",
  commune_territory_id: "",
  address: "",
  product: "",
  sku: "",
  quantity: 1,
  amount: 0,
  shipping_cost: 0,
  discount: 0,
  notes: "",
  status: "new",
  sub_status: null,
  delivery_company: "",
  delivery_type: "home",
  internal_tracking_id: "",
};

type Mode = "create" | "edit";

/** Form-only status options → stored workflow snapshot. */
type FormStatusChoice = "new" | "confirmed" | "postponed";

function snapshotFromFormStatusChoice(
  choice: FormStatusChoice
): Pick<OrderFormValues, "status" | "sub_status"> {
  switch (choice) {
    case "new":
      return { status: "new", sub_status: null };
    case "confirmed":
      return { status: "confirmed", sub_status: "confirmed" };
    case "postponed":
      return { status: "under_process", sub_status: "postponed" };
  }
}

function formStatusChoiceFromValues(v: OrderFormValues): FormStatusChoice {
  if (v.status === "new") return "new";
  if (v.status === "under_process" && v.sub_status === "postponed") {
    return "postponed";
  }
  if (v.status === "confirmed" || v.status === "follow") return "confirmed";
  if (v.status === "under_process") return "confirmed";
  return "new";
}

interface OrderFormModalProps {
  open: boolean;
  mode: Mode;
  initialOrder: Order | null;
  onClose: () => void;
  onSubmit: (values: OrderFormValues, previous: OrderSnapshot | null) => Promise<void>;
}

type ZrDeliveryCompanyRow = { id: string; name: string; tenant_id: string };

export function OrderFormModal({
  open,
  mode,
  initialOrder,
  onClose,
  onSubmit,
}: OrderFormModalProps) {
  const [values, setValues] = useState<OrderFormValues>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [catalogProducts, setCatalogProducts] = useState<
    { id: string; name: string; sku: string; sale_price: number }[]
  >([]);
  const [formDeliveryCompanies, setFormDeliveryCompanies] = useState<
    { id: string; name: string }[]
  >([]);
  const [zrDeliveryCompanies, setZrDeliveryCompanies] = useState<ZrDeliveryCompanyRow[]>(
    []
  );
  const [wilayaTerritoryOptions, setWilayaTerritoryOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [communeTerritoryOptions, setCommuneTerritoryOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [territoryListsLoading, setTerritoryListsLoading] = useState(false);
  const [communesLoading, setCommunesLoading] = useState(false);
  const [territoryListsError, setTerritoryListsError] = useState<string | null>(null);
  const [picklistsLoading, setPicklistsLoading] = useState(false);
  const [algeriaCommunesRows, setAlgeriaCommunesRows] = useState<
    { wilaya_code: string; name: string }[] | null
  >(null);
  const [algeriaCommunesLoading, setAlgeriaCommunesLoading] = useState(false);
  const [algeriaCommunesError, setAlgeriaCommunesError] = useState<string | null>(null);
  const didMatchLegacyWilaya = useRef(false);
  const didMatchLegacyCommune = useRef(false);
  const prevZrCompanyIdForTerritories = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      didMatchLegacyWilaya.current = false;
      didMatchLegacyCommune.current = false;
      prevZrCompanyIdForTerritories.current = null;
    }
  }, [open]);

  useEffect(() => {
    didMatchLegacyWilaya.current = false;
    didMatchLegacyCommune.current = false;
  }, [initialOrder?.id]);

  useEffect(() => {
    didMatchLegacyCommune.current = false;
  }, [values.wilaya_territory_id]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPicklistsLoading(true);
    void Promise.all([
      supabase
        .from("products")
        .select("id, name, sku, sale_price")
        .eq("active", true)
        .order("name"),
      supabase
        .from("delivery_companies")
        .select("id, name, type, tenant_id")
        .eq("active", true)
        .order("name"),
    ])
      .then(([proRes, dcRes]) => {
        if (cancelled) return;
        if (!proRes.error && proRes.data) {
          setCatalogProducts(
            proRes.data as {
              id: string;
              name: string;
              sku: string;
              sale_price: number;
            }[]
          );
        }
        if (!dcRes.error && dcRes.data) {
          const rows = dcRes.data as {
            id: string;
            name: string;
            type: string;
            tenant_id: string;
          }[];
          setFormDeliveryCompanies(rows.map((r) => ({ id: r.id, name: r.name })));
          setZrDeliveryCompanies(
            rows
              .filter((r) => r.type === "zr_express" && (r.tenant_id ?? "").trim())
              .map((r) => ({ id: r.id, name: r.name, tenant_id: r.tenant_id }))
          );
        }
      })
      .finally(() => {
        if (!cancelled) setPicklistsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAlgeriaCommunesLoading(true);
    setAlgeriaCommunesError(null);
    void fetch(`${import.meta.env.BASE_URL}data/algeria_communes.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ wilaya_code: string; name: string }[]>;
      })
      .then((rows) => {
        if (!cancelled) setAlgeriaCommunesRows(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) {
          setAlgeriaCommunesRows([]);
          setAlgeriaCommunesError("Could not load commune list.");
        }
      })
      .finally(() => {
        if (!cancelled) setAlgeriaCommunesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  /** Only when the selected delivery company row is ZR Express (name match). */
  const zrCompanyIdForTerritories = useMemo(() => {
    const dc = (values.delivery_company ?? "").trim();
    if (!dc) return null;
    const match = zrDeliveryCompanies.find((c) => c.name === dc);
    return match?.id ?? null;
  }, [zrDeliveryCompanies, values.delivery_company]);

  const locationInputMode = useMemo((): "zr" | "domestic" | "other" => {
    if (zrCompanyIdForTerritories) return "zr";
    if (!(values.delivery_company ?? "").trim()) return "domestic";
    return "other";
  }, [zrCompanyIdForTerritories, values.delivery_company]);

  const domesticWilayaCode = useMemo(
    () => parseWilayaCodeFromLabel(values.wilaya),
    [values.wilaya]
  );

  const domesticCommuneNames = useMemo(() => {
    const code = domesticWilayaCode;
    if (!code || !algeriaCommunesRows?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of algeriaCommunesRows) {
      if (r.wilaya_code !== code) continue;
      const n = (r.name ?? "").trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    out.sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    return out;
  }, [domesticWilayaCode, algeriaCommunesRows]);

  /** Canonical wilaya label for the domestic dropdown (accepts legacy "01 — X"). */
  const domesticWilayaValueForSelect = useMemo(() => {
    const code = parseWilayaCodeFromLabel(values.wilaya);
    if (!code) return "";
    const w = ALGERIA_WILAYAS_58.find((x) => x.code === code);
    return w ? formatWilayaLabel58(w) : "";
  }, [values.wilaya]);

  const domesticCommuneSelectValue = useMemo(
    () =>
      domesticCommuneNames.includes(values.commune.trim())
        ? values.commune.trim()
        : "",
    [values.commune, domesticCommuneNames]
  );

  useEffect(() => {
    if (!open || zrCompanyIdForTerritories) return;
    setValues((v) => {
      if (!(v.wilaya_territory_id ?? "").trim() && !(v.commune_territory_id ?? "").trim()) {
        return v;
      }
      return { ...v, wilaya_territory_id: "", commune_territory_id: "" };
    });
  }, [open, zrCompanyIdForTerritories]);

  useEffect(() => {
    if (!open) return;
    const z = zrCompanyIdForTerritories;
    const prev = prevZrCompanyIdForTerritories.current;
    if (prev && z && prev !== z) {
      setValues((v) => ({
        ...v,
        wilaya: "",
        wilaya_territory_id: "",
        commune: "",
        commune_territory_id: "",
      }));
      didMatchLegacyWilaya.current = false;
      didMatchLegacyCommune.current = false;
    }
    prevZrCompanyIdForTerritories.current = z;
  }, [open, zrCompanyIdForTerritories]);

  useEffect(() => {
    if (!open || !zrCompanyIdForTerritories) {
      setWilayaTerritoryOptions([]);
      setTerritoryListsError(null);
      return;
    }
    let cancelled = false;
    setTerritoryListsLoading(true);
    setTerritoryListsError(null);
    void fetch(appApiUrl("/api/zr-territories-search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryCompanyId: zrCompanyIdForTerritories,
        level: "wilaya",
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          error?: string;
          territories?: { id: string; name: string }[];
        };
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" && data.error.trim()
              ? data.error
              : `Wilayas request failed (${res.status})`
          );
        }
        setWilayaTerritoryOptions(Array.isArray(data.territories) ? data.territories : []);
      })
      .catch((e) => {
        if (!cancelled) {
          setWilayaTerritoryOptions([]);
          setTerritoryListsError(e instanceof Error ? e.message : "Could not load wilayas.");
        }
      })
      .finally(() => {
        if (!cancelled) setTerritoryListsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, zrCompanyIdForTerritories]);

  useEffect(() => {
    if (!open || !zrCompanyIdForTerritories || !values.wilaya_territory_id.trim()) {
      setCommuneTerritoryOptions([]);
      return;
    }
    let cancelled = false;
    setCommunesLoading(true);
    void fetch(appApiUrl("/api/zr-territories-search"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliveryCompanyId: zrCompanyIdForTerritories,
        level: "commune",
        parentId: values.wilaya_territory_id.trim(),
      }),
    })
      .then(async (res) => {
        const data = (await res.json()) as {
          error?: string;
          territories?: { id: string; name: string }[];
        };
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string" && data.error.trim()
              ? data.error
              : `Communes request failed (${res.status})`
          );
        }
        setCommuneTerritoryOptions(Array.isArray(data.territories) ? data.territories : []);
      })
      .catch(() => {
        if (!cancelled) setCommuneTerritoryOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCommunesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, zrCompanyIdForTerritories, values.wilaya_territory_id]);

  useEffect(() => {
    if (!open || mode !== "edit" || !initialOrder || !zrCompanyIdForTerritories) return;
    if ((initialOrder.wilaya_territory_id ?? "").trim()) {
      didMatchLegacyWilaya.current = true;
      return;
    }
    if (didMatchLegacyWilaya.current || wilayaTerritoryOptions.length === 0) return;
    const w = (initialOrder.wilaya ?? "").trim();
    if (!w) return;
    const m = wilayaTerritoryOptions.find(
      (o) => o.name.trim().toLowerCase() === w.toLowerCase()
    );
    if (m) {
      didMatchLegacyWilaya.current = true;
      setValues((v) => ({
        ...v,
        wilaya: m.name,
        wilaya_territory_id: m.id,
        commune: "",
        commune_territory_id: "",
      }));
    }
  }, [open, mode, initialOrder, wilayaTerritoryOptions, zrCompanyIdForTerritories]);

  useEffect(() => {
    if (!open || mode !== "edit" || !initialOrder || !zrCompanyIdForTerritories) return;
    if ((initialOrder.commune_territory_id ?? "").trim()) {
      didMatchLegacyCommune.current = true;
      return;
    }
    if (didMatchLegacyCommune.current || communeTerritoryOptions.length === 0) return;
    if (!(values.wilaya_territory_id ?? "").trim()) return;
    const c = (initialOrder.commune ?? "").trim();
    if (!c) return;
    const m = communeTerritoryOptions.find(
      (o) => o.name.trim().toLowerCase() === c.toLowerCase()
    );
    if (m) {
      didMatchLegacyCommune.current = true;
      setValues((v) => ({ ...v, commune: m.name, commune_territory_id: m.id }));
    }
  }, [
    open,
    mode,
    initialOrder,
    communeTerritoryOptions,
    values.wilaya_territory_id,
    zrCompanyIdForTerritories,
  ]);

  const productSelectOptions = useMemo(() => {
    const base = catalogProducts;
    if (mode === "edit" && initialOrder?.product?.trim()) {
      const name = initialOrder.product.trim();
      if (!base.some((p) => p.name === name)) {
        return [
          ...base,
          {
            id: "__legacy_product__",
            name,
            sku: initialOrder.sku ?? "",
            sale_price: Number(initialOrder.amount) || 0,
          },
        ];
      }
    }
    return base;
  }, [catalogProducts, mode, initialOrder]);

  const deliveryCompanySelectOptions = useMemo(() => {
    const base = formDeliveryCompanies;
    if (mode === "edit" && initialOrder?.delivery_company?.trim()) {
      const name = initialOrder.delivery_company.trim();
      if (!base.some((c) => c.name === name)) {
        return [...base, { id: "__legacy_dc__", name }];
      }
    }
    return base;
  }, [formDeliveryCompanies, mode, initialOrder]);

  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (mode === "edit" && initialOrder) {
      setValues({
        customer_name: initialOrder.customer_name,
        phone: initialOrder.phone ?? "",
        wilaya: initialOrder.wilaya ?? "",
        commune: initialOrder.commune ?? "",
        address: initialOrder.address ?? "",
        product: initialOrder.product,
        sku: initialOrder.sku ?? "",
        quantity: initialOrder.quantity ?? 1,
        amount: Number(initialOrder.amount),
        discount: Number(initialOrder.discount ?? 0),
        shipping_cost: Number(initialOrder.shipping_cost ?? 0),
        notes: initialOrder.notes ?? "",
        status: initialOrder.status,
        sub_status:
          initialOrder.status === "confirmed" || initialOrder.status === "follow"
            ? initialOrder.sub_status ?? "confirmed"
            : initialOrder.sub_status ?? null,
        delivery_company: initialOrder.delivery_company ?? "",
        delivery_type: initialOrder.delivery_type ?? "home",
        internal_tracking_id: initialOrder.internal_tracking_id ?? "",
        wilaya_territory_id: initialOrder.wilaya_territory_id ?? "",
        commune_territory_id: initialOrder.commune_territory_id ?? "",
      });
    } else {
      setValues({
        ...emptyForm,
        status: "new",
        sub_status: null,
        internal_tracking_id: "",
      });
    }
  }, [open, mode, initialOrder]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!values.customer_name.trim() || !values.product.trim()) {
      setLocalError("Customer name and product are required.");
      return;
    }
    if (locationInputMode === "zr") {
      if (!values.wilaya_territory_id.trim() || !values.wilaya.trim()) {
        setLocalError("Please select a wilaya from the ZR Express list.");
        return;
      }
      if (!values.commune_territory_id.trim() || !values.commune.trim()) {
        setLocalError("Please select a commune from the ZR Express list.");
        return;
      }
    } else if (locationInputMode === "domestic") {
      if (!domesticWilayaValueForSelect) {
        setLocalError("Please select a wilaya.");
        return;
      }
      const com = values.commune.trim();
      if (!com) {
        setLocalError("Please select a commune.");
        return;
      }
      if (!domesticCommuneNames.includes(com)) {
        setLocalError("Pick a commune from the list for the selected wilaya.");
        return;
      }
    } else {
      if (!values.wilaya.trim()) {
        setLocalError("Please enter a wilaya.");
        return;
      }
      if (!values.commune.trim()) {
        setLocalError("Please enter a commune.");
        return;
      }
    }
    if (!isValidOrderState(values.status, values.sub_status)) {
      setLocalError("Pick a valid sub-status for the selected main status.");
      return;
    }
    const prevSnap: OrderSnapshot | null =
      mode === "edit" && initialOrder
        ? {
            status: initialOrder.status,
            sub_status: initialOrder.sub_status ?? null,
          }
        : null;
    setSaving(true);
    try {
      const baseValues: OrderFormValues =
        locationInputMode === "domestic" && domesticWilayaValueForSelect
          ? { ...values, wilaya: domesticWilayaValueForSelect }
          : values;
      const valuesToSave: OrderFormValues =
        mode === "create"
          ? { ...baseValues, internal_tracking_id: generateInternalTrackingId() }
          : baseValues;
      await onSubmit(valuesToSave, prevSnap);
      onClose();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Could not save order."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-form-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-700/80 bg-slate-900 shadow-2xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-4 backdrop-blur">
          <h2 id="order-form-title" className="text-lg font-semibold text-white">
            {mode === "create" ? "Create order" : "Edit order"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Customer name
              </label>
              <input
                required
                value={values.customer_name}
                onChange={(e) =>
                  setValues((v) => ({ ...v, customer_name: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Phone
              </label>
              <input
                type="tel"
                value={values.phone}
                onChange={(e) =>
                  setValues((v) => ({ ...v, phone: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Delivery company
              </label>
              <select
                value={values.delivery_company}
                disabled={picklistsLoading}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    delivery_company: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {picklistsLoading ? "Loading…" : "— None —"}
                </option>
                {deliveryCompanySelectOptions.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                None: Algerian wilaya/commune lists. ZR Express: ZR API. Other carriers: free text.
              </p>
            </div>
            {locationInputMode === "zr" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Wilaya (ZR Express)
                  </label>
                  <select
                    required
                    value={values.wilaya_territory_id}
                    disabled={picklistsLoading || territoryListsLoading}
                    onChange={(e) => {
                      const id = e.target.value;
                      const opt = wilayaTerritoryOptions.find((o) => o.id === id);
                      setValues((v) => ({
                        ...v,
                        wilaya: opt?.name ?? "",
                        wilaya_territory_id: id,
                        commune: "",
                        commune_territory_id: "",
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">
                      {territoryListsLoading ? "Loading wilayas…" : "Select wilaya"}
                    </option>
                    {wilayaTerritoryOptions.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  {territoryListsError && (
                    <p className="mt-1 text-xs text-rose-300">{territoryListsError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Commune (ZR Express)
                  </label>
                  <select
                    required
                    value={values.commune_territory_id}
                    disabled={
                      picklistsLoading ||
                      !values.wilaya_territory_id.trim() ||
                      communesLoading
                    }
                    onChange={(e) => {
                      const id = e.target.value;
                      const opt = communeTerritoryOptions.find((o) => o.id === id);
                      setValues((v) => ({
                        ...v,
                        commune: opt?.name ?? "",
                        commune_territory_id: id,
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">
                      {!values.wilaya_territory_id.trim()
                        ? "Select a wilaya first"
                        : communesLoading
                          ? "Loading communes…"
                          : "Select commune"}
                    </option>
                    {communeTerritoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : locationInputMode === "domestic" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Wilaya
                  </label>
                  <select
                    required
                    value={domesticWilayaValueForSelect}
                    disabled={picklistsLoading}
                    onChange={(e) => {
                      const label = e.target.value;
                      setValues((v) => ({
                        ...v,
                        wilaya: label,
                        commune: "",
                      }));
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">Select wilaya</option>
                    {ALGERIA_WILAYAS_58.map((w) => {
                      const lab = formatWilayaLabel58(w);
                      return (
                        <option key={w.code} value={lab}>
                          {lab}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Commune
                  </label>
                  <select
                    required
                    value={domesticCommuneSelectValue}
                    disabled={
                      picklistsLoading ||
                      !domesticWilayaCode ||
                      algeriaCommunesLoading
                    }
                    onChange={(e) =>
                      setValues((v) => ({ ...v, commune: e.target.value }))
                    }
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">
                      {!domesticWilayaCode
                        ? "Select a wilaya first"
                        : algeriaCommunesLoading
                          ? "Loading communes…"
                          : domesticCommuneNames.length === 0
                            ? "No communes for this wilaya"
                            : "Select commune"}
                    </option>
                    {domesticCommuneNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {algeriaCommunesError && (
                    <p className="mt-1 text-xs text-rose-300">{algeriaCommunesError}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Wilaya
                  </label>
                  <input
                    required
                    value={values.wilaya}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, wilaya: e.target.value }))
                    }
                    placeholder="Wilaya"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300">
                    Commune
                  </label>
                  <input
                    required
                    value={values.commune}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, commune: e.target.value }))
                    }
                    placeholder="District / commune"
                    className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Delivery Type
              </label>
              <select
                value={values.delivery_type}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    delivery_type: e.target.value as OrderDeliveryType,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="home">À domicile</option>
                <option value="pickup-point">Stop desk</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Address
              </label>
              <textarea
                rows={2}
                value={values.address}
                onChange={(e) =>
                  setValues((v) => ({ ...v, address: e.target.value }))
                }
                className="mt-1 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Product
              </label>
              <select
                required
                value={values.product}
                disabled={picklistsLoading}
                onChange={(e) => {
                  const name = e.target.value;
                  if (!name) {
                    setValues((v) => ({
                      ...v,
                      product: "",
                      sku: "",
                      amount: 0,
                    }));
                    return;
                  }
                  const p = productSelectOptions.find((x) => x.name === name);
                  const price =
                    p != null ? Number(p.sale_price) : 0;
                  setValues((v) => ({
                    ...v,
                    product: name,
                    sku: p?.sku ?? "",
                    amount: Number.isFinite(price) && price >= 0 ? price : v.amount,
                  }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {picklistsLoading ? "Loading products…" : "Select product…"}
                </option>
                {productSelectOptions.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                SKU
              </label>
              <input
                value={values.sku}
                onChange={(e) =>
                  setValues((v) => ({ ...v, sku: e.target.value }))
                }
                placeholder="Product or variant SKU (optional)"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Quantity
              </label>
              <input
                type="number"
                min={1}
                step={1}
                required
                value={values.quantity}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Items (DZD, excl. shipping)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                required
                value={values.amount}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    amount: parseFloat(e.target.value) || 0,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">
                Discount (DZD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={values.discount}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    discount: Math.max(0, parseFloat(e.target.value) || 0),
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Shipping price (DZD)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={values.shipping_cost}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    shipping_cost: Math.max(
                      0,
                      parseFloat(e.target.value) || 0
                    ),
                  }))
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Notes
              </label>
              <textarea
                rows={3}
                value={values.notes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, notes: e.target.value }))
                }
                className="mt-1 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-300">
                Status
              </label>
              <select
                value={formStatusChoiceFromValues(values)}
                onChange={(e) => {
                  const choice = e.target.value as FormStatusChoice;
                  setValues((v) => ({
                    ...v,
                    ...snapshotFromFormStatusChoice(choice),
                  }));
                }}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value="new">New</option>
                <option value="confirmed">Confirmed</option>
                <option value="postponed">Postponed</option>
              </select>
            </div>
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
              {saving ? "Saving…" : mode === "create" ? "Create" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
