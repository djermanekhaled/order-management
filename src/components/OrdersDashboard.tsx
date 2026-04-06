import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Building2, Home } from "lucide-react";
import { WILAYAS, WILAYA_FILTER_ALL } from "../constants/wilayas";
import { MANUAL_ORDER_SOURCE } from "../constants/source";
import { exportOrdersToCsv } from "../lib/csv";
import {
  CANCELLED_SUBS,
  COMPLETED_SUBS,
  UNDER_PROCESS_SUBS,
  isValidOrderState,
  isValidTransition,
  statusLabel,
  subStatusLabel,
} from "../lib/orderWorkflow";
import { navKeyLabel, orderMatchesNavKey } from "../lib/sidebarNav";
import {
  defaultColumnVisibility,
  ORDER_COLUMN_IDS,
  ORDER_COLUMN_LABELS,
  type OrderColumnId,
} from "../lib/orderTableColumns";
import { supabase } from "../lib/supabase";
import type {
  Order,
  OrderFormValues,
  OrderSnapshot,
  OrderStatus,
  OrderSubStatus,
  SidebarNavKey,
} from "../types/order";
import type { DeliveryCompany } from "../types/deliveryCompany";
import { AppSidebar } from "./AppSidebar";
import { DeliveryCompaniesPage } from "./DeliveryCompaniesPage";
import { OrderFormModal } from "./OrderFormModal";
import { OrderHistoryPanel } from "./OrderHistoryPanel";
import { InventoryPage } from "./InventoryPage";
import { ProductsPage } from "./ProductsPage";
import { SalesChannelsPage } from "./SalesChannelsPage";

function formatMoneyDzd(n: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "DZD",
    maximumFractionDigits: 2,
  }).format(n);
}

function orderGrandTotal(o: Order): number {
  const t = o.total_amount;
  if (t != null && Number.isFinite(Number(t))) return Number(t);
  const disc = Number(o.discount ?? 0);
  return (
    Number(o.amount) + Number(o.shipping_cost ?? 0) - disc
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

function localDayBounds(fromStr: string | "", toStr: string | "") {
  let fromMs: number | null = null;
  let toMs: number | null = null;
  if (fromStr) {
    const d = new Date(`${fromStr}T00:00:00`);
    fromMs = d.getTime();
  }
  if (toStr) {
    const d = new Date(`${toStr}T23:59:59.999`);
    toMs = d.getTime();
  }
  return { fromMs, toMs };
}

function validateShipmentApiUrl(): string {
  const o = import.meta.env.VITE_API_ORIGIN;
  if (typeof o === "string" && o.trim()) {
    return `${o.replace(/\/$/, "")}/api/validate-shipment`;
  }
  return "/api/validate-shipment";
}

export function OrdersDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sidebarView, setSidebarView] = useState<
    | "orders"
    | "sales_channels"
    | "products"
    | "delivery_companies"
    | "inventory"
  >("orders");
  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productFreshKey, setProductFreshKey] = useState(0);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [channelCount, setChannelCount] = useState(0);
  const [activeProductCount, setActiveProductCount] = useState(0);
  const [activeDeliveryCompanyCount, setActiveDeliveryCompanyCount] =
    useState(0);
  const [deliveryCompanies, setDeliveryCompanies] = useState<
    DeliveryCompany[]
  >([]);
  const [navKey, setNavKey] = useState<SidebarNavKey>("all");
  const [subStatusFilter, setSubStatusFilter] = useState<OrderSubStatus | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [wilayaFilter, setWilayaFilter] = useState<string>(WILAYA_FILTER_ALL);
  const [filterProduct, setFilterProduct] = useState("");
  const [filterDeliveryCompany, setFilterDeliveryCompany] = useState("");
  const [filterDeliveryType, setFilterDeliveryType] = useState<
    "" | "home" | "pickup-point"
  >("");
  const [filterSource, setFilterSource] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<
    Record<OrderColumnId, boolean>
  >(() => defaultColumnVisibility());
  const [bulkRowsWorking, setBulkRowsWorking] = useState(false);
  const [filterProductOptions, setFilterProductOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [filterSalesChannels, setFilterSalesChannels] = useState<
    { id: string; name: string }[]
  >([]);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOrderId, setHistoryOrderId] = useState<string | null>(null);
  const [historyLabel, setHistoryLabel] = useState("");

  const [savingStateId, setSavingStateId] = useState<string | null>(null);

  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [bulkDeliveryCompanyId, setBulkDeliveryCompanyId] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);

  const loadOrders = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { data, error: qErr } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setOrders((data ?? []) as Order[]);
  }, []);

  const loadFilterPicklists = useCallback(async () => {
    const [proRes, chRes] = await Promise.all([
      supabase
        .from("products")
        .select("id, name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("sales_channels")
        .select("id, name")
        .eq("status", "active")
        .order("name"),
    ]);
    if (!proRes.error && proRes.data) {
      setFilterProductOptions(proRes.data as { id: string; name: string }[]);
    }
    if (!chRes.error && chRes.data) {
      setFilterSalesChannels(chRes.data as { id: string; name: string }[]);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    void loadFilterPicklists();
  }, [loadFilterPicklists]);

  useEffect(() => {
    // Keep "All" selected when switching between main sidebar items.
    setSubStatusFilter(null);
  }, [navKey]);

  useEffect(() => {
    setSelectedOrderIds(new Set());
    if (navKey !== "confirmed") {
      setBulkDeliveryCompanyId("");
    }
  }, [navKey]);

  const { fromMs, toMs } = useMemo(
    () => localDayBounds(dateFrom, dateTo),
    [dateFrom, dateTo]
  );

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!orderMatchesNavKey(o, navKey)) return false;
      const t = new Date(o.created_at).getTime();
      if (fromMs !== null && t < fromMs) return false;
      if (toMs !== null && t > toMs) return false;
      if (
        wilayaFilter !== WILAYA_FILTER_ALL &&
        o.wilaya !== wilayaFilter
      ) {
        return false;
      }
      if (
        (navKey === "under_process" ||
          navKey === "completed" ||
          navKey === "cancelled") &&
        subStatusFilter !== null &&
        o.sub_status !== subStatusFilter
      ) {
        return false;
      }
      if (filterProduct) {
        const line = o.product.trim();
        const want = filterProduct.trim();
        const lineL = line.toLowerCase();
        const wantL = want.toLowerCase();
        if (lineL !== wantL && !lineL.includes(wantL)) return false;
      }
      if (filterDeliveryCompany) {
        const dc = (o.delivery_company || "").trim();
        if (dc !== filterDeliveryCompany.trim()) return false;
      }
      if (filterDeliveryType) {
        const dt = o.delivery_type ?? "home";
        if (dt !== filterDeliveryType) return false;
      }
      if (filterSource) {
        const src = o.source ?? MANUAL_ORDER_SOURCE;
        if (src !== filterSource) return false;
      }
      return true;
    });
  }, [
    orders,
    navKey,
    subStatusFilter,
    fromMs,
    toMs,
    wilayaFilter,
    filterProduct,
    filterDeliveryCompany,
    filterDeliveryType,
    filterSource,
  ]);

  const loadChannelCount = useCallback(async () => {
    const { count } = await supabase
      .from("sales_channels")
      .select("*", { count: "exact", head: true });
    setChannelCount(count ?? 0);
  }, []);

  const onChannelsChanged = useCallback(() => {
    void loadChannelCount();
    void loadFilterPicklists();
  }, [loadChannelCount, loadFilterPicklists]);

  useEffect(() => {
    void loadChannelCount();
  }, [loadChannelCount]);

  const loadActiveProductCount = useCallback(async () => {
    const { count } = await supabase
      .from("products")
      .select("*", { count: "exact", head: true })
      .eq("active", true);
    setActiveProductCount(count ?? 0);
  }, []);

  const onProductsChanged = useCallback(() => {
    void loadActiveProductCount();
    void loadFilterPicklists();
  }, [loadActiveProductCount, loadFilterPicklists]);

  useEffect(() => {
    void loadActiveProductCount();
  }, [loadActiveProductCount]);

  const loadActiveDeliveryCompanyCount = useCallback(async () => {
    const { count } = await supabase
      .from("delivery_companies")
      .select("*", { count: "exact", head: true })
      .eq("active", true);
    setActiveDeliveryCompanyCount(count ?? 0);
  }, []);

  const loadDeliveryCompanies = useCallback(async () => {
    const { data } = await supabase
      .from("delivery_companies")
      .select("*")
      .eq("active", true)
      .order("name");
    setDeliveryCompanies((data ?? []) as DeliveryCompany[]);
  }, []);

  const onDeliveryCompaniesChanged = useCallback(() => {
    void loadActiveDeliveryCompanyCount();
    void loadDeliveryCompanies();
  }, [loadActiveDeliveryCompanyCount, loadDeliveryCompanies]);

  useEffect(() => {
    void loadActiveDeliveryCompanyCount();
    void loadDeliveryCompanies();
  }, [loadActiveDeliveryCompanyCount, loadDeliveryCompanies]);

  async function handleSaveOrder(
    values: OrderFormValues,
    _previous: OrderSnapshot | null
  ) {
    if (!isValidOrderState(values.status, values.sub_status)) {
      throw new Error("Invalid status / sub-status combination.");
    }

    const shippingCost = Math.max(0, Number(values.shipping_cost) || 0);
    const discount = Math.max(0, Number(values.discount) || 0);

    const payload = {
      customer_name: values.customer_name.trim(),
      phone: values.phone.trim(),
      wilaya: values.wilaya,
      commune: values.commune.trim(),
      address: values.address.trim(),
      product: values.product.trim(),
      sku: values.sku.trim(),
      quantity: values.quantity,
      amount: values.amount,
      discount,
      shipping_cost: shippingCost,
      total_amount: values.amount + shippingCost - discount,
      notes: values.notes.trim(),
      status: values.status,
      sub_status: values.sub_status,
      source:
        formMode === "create"
          ? MANUAL_ORDER_SOURCE
          : editingOrder?.source ?? MANUAL_ORDER_SOURCE,
      delivery_company: values.delivery_company.trim(),
      delivery_type: values.delivery_type,
      internal_tracking_id:
        formMode === "create"
          ? values.internal_tracking_id
          : (editingOrder?.internal_tracking_id ?? values.internal_tracking_id),
      tracking_number:
        formMode === "edit" && editingOrder
          ? editingOrder.tracking_number ?? ""
          : "",
      shipping_status:
        formMode === "edit" && editingOrder
          ? editingOrder.shipping_status ?? null
          : null,
    };

    if (formMode === "create") {
      const { error: insErr } = await supabase.from("orders").insert(payload);
      if (insErr) throw new Error(insErr.message);
    } else if (editingOrder) {
      const { error: upErr } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", editingOrder.id);
      if (upErr) throw new Error(upErr.message);
    }
    await loadOrders();
  }

  async function applyInlineSnapshot(order: Order, next: OrderSnapshot) {
    const prev: OrderSnapshot = {
      status: order.status,
      sub_status: order.sub_status ?? null,
    };
    if (!isValidTransition(prev, next)) {
      setError("Invalid status / sub-status change.");
      return;
    }
    setSavingStateId(order.id);
    setError(null);
    const { error: upErr } = await supabase
      .from("orders")
      .update({ status: next.status, sub_status: next.sub_status })
      .eq("id", order.id);
    setSavingStateId(null);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setOrders((prev) =>
      prev.map((o) =>
        o.id === order.id
          ? { ...o, status: next.status, sub_status: next.sub_status }
          : o
      )
    );
  }

  function openCreate() {
    setFormMode("create");
    setEditingOrder(null);
    setFormOpen(true);
  }

  function openEdit(o: Order) {
    setFormMode("edit");
    setEditingOrder(o);
    setFormOpen(true);
  }

  function openHistory(o: Order) {
    setHistoryOrderId(o.id);
    setHistoryLabel(o.customer_name);
    setHistoryOpen(true);
  }

  function clearFilters() {
    setDateFrom("");
    setDateTo("");
    setWilayaFilter(WILAYA_FILTER_ALL);
    setFilterProduct("");
    setFilterDeliveryCompany("");
    setFilterDeliveryType("");
    setFilterSource("");
  }

  const activeDeliveryCompanies = useMemo(
    () => deliveryCompanies.filter((c) => c.active),
    [deliveryCompanies]
  );

  function toggleOrderSelected(id: string, checked: boolean) {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAllFiltered(checked: boolean) {
    if (checked) {
      setSelectedOrderIds(new Set(filteredOrders.map((o) => o.id)));
    } else {
      setSelectedOrderIds(new Set());
    }
  }

  async function bulkDeleteOrders() {
    if (selectedOrderIds.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedOrderIds.size} order(s)? This cannot be undone.`
      )
    ) {
      return;
    }
    setBulkRowsWorking(true);
    setError(null);
    const ids = [...selectedOrderIds];
    const { error: delErr } = await supabase.from("orders").delete().in("id", ids);
    setBulkRowsWorking(false);
    if (delErr) {
      setError(delErr.message);
      return;
    }
    setSelectedOrderIds(new Set());
    await loadOrders();
  }

  async function bulkConfirmOrders() {
    const ids = [...selectedOrderIds];
    const targets = orders.filter(
      (o) =>
        ids.includes(o.id) &&
        (o.status === "new" || o.status === "under_process")
    );
    if (targets.length === 0) {
      setError(
        "No selected orders can be confirmed (only New or Under Process)."
      );
      return;
    }
    setBulkRowsWorking(true);
    setError(null);
    const { error: upErr } = await supabase
      .from("orders")
      .update({ status: "confirmed", sub_status: "confirmed" })
      .in(
        "id",
        targets.map((t) => t.id)
      );
    setBulkRowsWorking(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSelectedOrderIds(new Set());
    await loadOrders();
  }

  async function bulkCancelOrders() {
    const ids = [...selectedOrderIds];
    const targets = orders.filter(
      (o) => ids.includes(o.id) && o.status !== "cancelled"
    );
    if (targets.length === 0) {
      setError("No selected orders to cancel.");
      return;
    }
    setBulkRowsWorking(true);
    setError(null);
    const { error: upErr } = await supabase
      .from("orders")
      .update({ status: "cancelled", sub_status: "cancelled" })
      .in(
        "id",
        targets.map((t) => t.id)
      );
    setBulkRowsWorking(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSelectedOrderIds(new Set());
    await loadOrders();
  }

  async function assignShippingCompanyBulk() {
    if (!bulkDeliveryCompanyId || selectedOrderIds.size === 0) return;
    const company = activeDeliveryCompanies.find(
      (c) => c.id === bulkDeliveryCompanyId
    );
    if (!company) return;
    setBulkWorking(true);
    setError(null);
    const ids = [...selectedOrderIds];
    const { error: upErr } = await supabase
      .from("orders")
      .update({ delivery_company: company.name })
      .in("id", ids);
    setBulkWorking(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSelectedOrderIds(new Set());
    await loadOrders();
  }

  async function validateShipmentBulk() {
    if (!bulkDeliveryCompanyId || selectedOrderIds.size === 0) return;
    setBulkWorking(true);
    setError(null);
    try {
      const res = await fetch(validateShipmentApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderIds: [...selectedOrderIds],
          deliveryCompanyId: bulkDeliveryCompanyId,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        details?: unknown;
        updated?: number;
        zrStep?: string;
        zrStatus?: number;
        zrBody?: unknown;
        zrErrorDetails?: string[];
        territoryFailures?: unknown;
        zrWilayaNamesSample?: string[];
        zrHubCityNamesSample?: string[];
      };
      if (!res.ok) {
        const detail =
          typeof data.details === "string"
            ? data.details
            : data.details != null
              ? JSON.stringify(data.details)
              : "";
        const zrParts: string[] = [];
        if (data.zrStep) zrParts.push(`step: ${data.zrStep}`);
        if (data.zrStatus != null) zrParts.push(`ZR HTTP ${data.zrStatus}`);
        if (Array.isArray(data.zrErrorDetails) && data.zrErrorDetails.length) {
          zrParts.push(data.zrErrorDetails.join("; "));
        }
        const hubCities =
          Array.isArray(data.zrHubCityNamesSample) &&
          data.zrHubCityNamesSample.length
            ? data.zrHubCityNamesSample
            : Array.isArray(data.zrWilayaNamesSample) &&
                data.zrWilayaNamesSample.length
              ? data.zrWilayaNamesSample
              : null;
        if (hubCities) {
          zrParts.push(`ZR hub cities (sample): ${hubCities.join(", ")}`);
        }
        if (data.zrBody != null && typeof data.zrBody === "object") {
          zrParts.push(JSON.stringify(data.zrBody));
        } else if (typeof data.zrBody === "string" && data.zrBody.trim()) {
          zrParts.push(data.zrBody.trim());
        }
        throw new Error(
          [
            data.error ?? `HTTP ${res.status}`,
            detail,
            zrParts.length ? zrParts.join(" — ") : "",
          ]
            .filter(Boolean)
            .join(" — ")
        );
      }
      setSelectedOrderIds(new Set());
      await loadOrders();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validate shipment failed.");
    } finally {
      setBulkWorking(false);
    }
  }

  const allFilteredSelected =
    filteredOrders.length > 0 &&
    filteredOrders.every((o) => selectedOrderIds.has(o.id));

  const tableBusy = bulkWorking || bulkRowsWorking;

  return (
    <div className="flex min-h-screen w-full flex-1">
      <AppSidebar
        orders={orders}
        navKey={navKey}
        onNavKey={(k) => {
          setSidebarView("orders");
          setNavKey(k);
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((c) => !c)}
        activeView={
          sidebarView === "sales_channels"
            ? "sales_channels"
            : sidebarView === "products"
              ? "products"
              : sidebarView === "delivery_companies"
                ? "delivery_companies"
                : sidebarView === "inventory"
                  ? "inventory"
                  : "orders"
        }
        onViewChange={(v) => {
          if (v === "sales_channels") setSidebarView("sales_channels");
          else if (v === "products") setSidebarView("products");
          else if (v === "delivery_companies")
            setSidebarView("delivery_companies");
          else if (v === "inventory") setSidebarView("inventory");
          else setSidebarView("orders");
        }}
        salesChannelCount={channelCount}
        onAddSalesChannel={() => {
          setSidebarView("sales_channels");
          setChannelModalOpen(true);
        }}
        activeProductCount={activeProductCount}
        onAddProduct={() => {
          setSidebarView("products");
          setProductFreshKey((k) => k + 1);
          setProductModalOpen(true);
        }}
        activeDeliveryCompanyCount={activeDeliveryCompanyCount}
        onAddDeliveryCompany={() => {
          setSidebarView("delivery_companies");
          setCompanyModalOpen(true);
        }}
        inventoryCount={activeProductCount}
      />

      <div className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10">
        {sidebarView === "sales_channels" ? (
          <SalesChannelsPage
            channelModalOpen={channelModalOpen}
            onChannelModalOpen={() => setChannelModalOpen(true)}
            onChannelModalClose={() => setChannelModalOpen(false)}
            onChannelsChanged={onChannelsChanged}
          />
        ) : sidebarView === "products" ? (
          <ProductsPage
            productModalOpen={productModalOpen}
            onProductModalOpen={() => setProductModalOpen(true)}
            onProductModalClose={() => setProductModalOpen(false)}
            onProductsChanged={onProductsChanged}
            productFreshKey={productFreshKey}
          />
        ) : sidebarView === "delivery_companies" ? (
          <DeliveryCompaniesPage
            companyModalOpen={companyModalOpen}
            onCompanyModalOpen={() => setCompanyModalOpen(true)}
            onCompanyModalClose={() => setCompanyModalOpen(false)}
            onCompaniesChanged={onDeliveryCompaniesChanged}
          />
        ) : sidebarView === "inventory" ? (
          <InventoryPage />
        ) : (
          <>
        {error && (
          <div
            className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
            role="alert"
          >
            {error}
          </div>
        )}

        <section className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
              View
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              {navKeyLabel(navKey)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Filtered by sidebar. Refine with dates and wilaya below.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void loadOrders();
                void loadFilterPicklists();
              }}
              disabled={loading}
              className="rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 hover:bg-indigo-500"
            >
              New order
            </button>
            <button
              type="button"
              onClick={() => exportOrdersToCsv(filteredOrders)}
              disabled={filteredOrders.length === 0}
              className="rounded-xl border border-emerald-600/50 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-40"
            >
              Export CSV
            </button>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 [&::-webkit-details-marker]:hidden">
                Columns
              </summary>
              <div className="absolute right-0 z-40 mt-2 max-h-[min(70vh,28rem)] w-64 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 py-2 shadow-2xl ring-1 ring-white/10">
                <div className="border-b border-slate-800 px-3 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Visible columns
                </div>
                {ORDER_COLUMN_IDS.map((id) => (
                  <label
                    key={id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800/80"
                  >
                    <input
                      type="checkbox"
                      checked={columnVisibility[id]}
                      onChange={() =>
                        setColumnVisibility((prev) => ({
                          ...prev,
                          [id]: !prev[id],
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-indigo-500"
                    />
                    {ORDER_COLUMN_LABELS[id]}
                  </label>
                ))}
                <div className="border-t border-slate-800 px-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setColumnVisibility(defaultColumnVisibility())}
                    className="text-xs font-medium text-indigo-400 hover:text-indigo-300"
                  >
                    Show all columns
                  </button>
                </div>
              </div>
            </details>
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 ring-1 ring-white/5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Advanced filters
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-slate-500">
                From date
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                To date
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                Wilaya
              </label>
              <select
                value={wilayaFilter}
                onChange={(e) => setWilayaFilter(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              >
                <option value={WILAYA_FILTER_ALL}>All wilayas</option>
                {WILAYAS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-1 xl:col-span-1">
              <label className="block text-xs font-medium text-slate-500">
                Product
              </label>
              <select
                value={filterProduct}
                onChange={(e) => setFilterProduct(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              >
                <option value="">All products</option>
                {filterProductOptions.map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                Delivery company
              </label>
              <select
                value={filterDeliveryCompany}
                onChange={(e) => setFilterDeliveryCompany(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              >
                <option value="">All companies</option>
                {deliveryCompanies.map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                Delivery type
              </label>
              <select
                value={filterDeliveryType}
                onChange={(e) =>
                  setFilterDeliveryType(
                    e.target.value as "" | "home" | "pickup-point"
                  )
                }
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              >
                <option value="">All</option>
                <option value="home">À domicile</option>
                <option value="pickup-point">Stop desk</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500">
                Source
              </label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60"
              >
                <option value="">All sources</option>
                <option value={MANUAL_ORDER_SOURCE}>Manual</option>
                {filterSalesChannels.map((ch) => (
                  <option key={ch.id} value={ch.name}>
                    {ch.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 text-sm text-indigo-400 hover:text-indigo-300"
          >
            Clear filters
          </button>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl ring-1 ring-white/5">
          <div className="border-b border-slate-800/80 px-5 py-4">
            <p className="text-sm text-slate-400">
              {loading
                ? "Loading orders…"
                : `${filteredOrders.length} order${filteredOrders.length === 1 ? "" : "s"} match filters`}
            </p>
          </div>
          {selectedOrderIds.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-800/80 bg-slate-900/50 px-5 py-3">
              <span className="text-sm font-medium text-slate-200">
                {selectedOrderIds.size} order
                {selectedOrderIds.size === 1 ? "" : "s"} selected
              </span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={tableBusy}
                  onClick={() => void bulkConfirmOrders()}
                  className="rounded-xl border border-emerald-600/50 bg-emerald-950/50 px-3 py-1.5 text-sm font-medium text-emerald-200 hover:bg-emerald-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={tableBusy}
                  onClick={() => void bulkCancelOrders()}
                  className="rounded-xl border border-amber-600/50 bg-amber-950/40 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-900/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={tableBusy}
                  onClick={() => void bulkDeleteOrders()}
                  className="rounded-xl border border-rose-600/50 bg-rose-950/40 px-3 py-1.5 text-sm font-medium text-rose-200 hover:bg-rose-900/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {navKey === "under_process" && (
            <div className="border-b border-slate-800/80 bg-slate-900/20 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSubStatusFilter(null)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === null
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("call_1")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "call_1"
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Call 1
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("call_2")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "call_2"
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Call 2
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("call_3")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "call_3"
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Call 3
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("postponed")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "postponed"
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Postponed
                </button>
              </div>
            </div>
          )}
          {navKey === "completed" && (
            <div className="border-b border-slate-800/80 bg-slate-900/20 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSubStatusFilter(null)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === null
                      ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("delivered")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "delivered"
                      ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Delivered
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("returned")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "returned"
                      ? "border-emerald-500/70 bg-emerald-500/15 text-emerald-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Returned
                </button>
              </div>
            </div>
          )}
          {navKey === "cancelled" && (
            <div className="border-b border-slate-800/80 bg-slate-900/20 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSubStatusFilter(null)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === null
                      ? "border-rose-500/70 bg-rose-500/15 text-rose-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("cancelled")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "cancelled"
                      ? "border-rose-500/70 bg-rose-500/15 text-rose-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Cancelled
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("fake_order")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "fake_order"
                      ? "border-rose-500/70 bg-rose-500/15 text-rose-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Fake Order
                </button>
                <button
                  type="button"
                  onClick={() => setSubStatusFilter("duplicated")}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                    subStatusFilter === "duplicated"
                      ? "border-rose-500/70 bg-rose-500/15 text-rose-200"
                      : "border-slate-700/80 bg-slate-900/40 text-slate-300 hover:bg-slate-800/60"
                  }`}
                >
                  Duplicated
                </button>
              </div>
            </div>
          )}
          {navKey === "confirmed" && filteredOrders.length > 0 && (
            <div className="flex flex-col gap-3 border-b border-slate-800/80 bg-slate-900/30 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex min-w-[200px] flex-1 flex-col text-xs font-medium text-slate-500 sm:max-w-xs">
                Delivery company
                <select
                  value={bulkDeliveryCompanyId}
                  onChange={(e) => setBulkDeliveryCompanyId(e.target.value)}
                  disabled={bulkWorking}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/60 disabled:opacity-50"
                >
                  <option value="">Select company…</option>
                  {activeDeliveryCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  disabled={
                    bulkWorking ||
                    !bulkDeliveryCompanyId ||
                    selectedOrderIds.size === 0
                  }
                  onClick={() => void assignShippingCompanyBulk()}
                  className="rounded-xl border border-slate-600 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Assign shipping company
                </button>
                <button
                  type="button"
                  disabled={
                    bulkWorking ||
                    !bulkDeliveryCompanyId ||
                    selectedOrderIds.size === 0
                  }
                  onClick={() => void validateShipmentBulk()}
                  className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sky-900/30 hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bulkWorking ? "Working…" : "Validate shipment"}
                </button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1780px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                  <th className="sticky left-0 z-30 w-10 bg-slate-900/98 px-2 py-3 font-medium backdrop-blur-sm">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) =>
                        toggleSelectAllFiltered(e.target.checked)
                      }
                      disabled={tableBusy || filteredOrders.length === 0}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
                      title="Select all in this list"
                    />
                  </th>
                  {ORDER_COLUMN_IDS.filter((id) => columnVisibility[id]).map(
                    (id) => orderTableHeaderCell(id)
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!loading &&
                  filteredOrders.map((o) => (
                    <tr key={o.id} className="group hover:bg-slate-800/20">
                      <td className="sticky left-0 z-30 bg-slate-900/95 px-2 py-3 backdrop-blur-sm group-hover:bg-slate-800/25">
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.has(o.id)}
                          onChange={(e) =>
                            toggleOrderSelected(o.id, e.target.checked)
                          }
                          disabled={tableBusy}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
                          aria-label={`Select order ${o.customer_name}`}
                        />
                      </td>
                      {ORDER_COLUMN_IDS.filter((id) => columnVisibility[id]).map(
                        (id) =>
                          orderTableDataCell(id, o, {
                            savingStateId,
                            onApplySnapshot: applyInlineSnapshot,
                            onEdit: openEdit,
                            onHistory: openHistory,
                          })
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        <OrderFormModal
          open={formOpen}
          mode={formMode}
          initialOrder={editingOrder}
          onClose={() => {
            setFormOpen(false);
            setEditingOrder(null);
          }}
          onSubmit={handleSaveOrder}
        />

        <OrderHistoryPanel
          open={historyOpen}
          orderId={historyOrderId}
          customerLabel={historyLabel}
          onClose={() => {
            setHistoryOpen(false);
            setHistoryOrderId(null);
          }}
        />
          </>
        )}
      </div>
    </div>
  );
}

/** Right sticky cluster: actions 7rem + status ~9rem → created offset 16rem. */
const STICKY_RIGHT_ACTIONS = "sticky right-0 z-30 w-[7rem] min-w-[7rem]";
const STICKY_RIGHT_STATUS =
  "sticky right-[7rem] z-25 w-max min-w-0 max-w-[9rem] shrink-0";
const STICKY_RIGHT_CREATED =
  "sticky right-[16rem] z-20 min-w-[10rem] max-w-[11rem]";

function orderTableHeaderCell(id: OrderColumnId): ReactElement {
  const stickyActions = id === "actions";
  const stickyStatus = id === "status";
  const stickyCreated = id === "created";
  const idCol = id === "internalTracking";
  const stickyRight =
    stickyActions || stickyStatus || stickyCreated
      ? "border-l border-slate-800/80 bg-slate-900/98 backdrop-blur-sm"
      : "";
  return (
    <th
      key={id}
      className={[
        stickyActions ? `${STICKY_RIGHT_ACTIONS} px-3 py-3 font-medium ${stickyRight}` : "",
        stickyStatus ? `${STICKY_RIGHT_STATUS} px-2 py-3 font-medium ${stickyRight}` : "",
        stickyCreated ? `${STICKY_RIGHT_CREATED} px-4 py-3 font-medium ${stickyRight}` : "",
        !stickyActions && !stickyStatus && !stickyCreated
          ? "px-4 py-3 font-medium"
          : "",
        idCol ? "min-w-[11rem] max-w-[14rem]" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {ORDER_COLUMN_LABELS[id]}
    </th>
  );
}

function orderTableDataCell(
  id: OrderColumnId,
  o: Order,
  ctx: {
    savingStateId: string | null;
    onApplySnapshot: (order: Order, next: OrderSnapshot) => void | Promise<void>;
    onEdit: (order: Order) => void;
    onHistory: (order: Order) => void;
  }
): ReactElement {
  switch (id) {
    case "customer":
      return (
        <td key={id} className="px-4 py-3 font-medium text-slate-100">
          {o.customer_name}
        </td>
      );
    case "phone":
      return (
        <td key={id} className="px-4 py-3 text-slate-400">
          {o.phone || "—"}
        </td>
      );
    case "wilaya":
      return (
        <td
          key={id}
          className="max-w-[140px] truncate px-4 py-3 text-slate-400"
          title={o.wilaya}
        >
          {o.wilaya || "—"}
        </td>
      );
    case "commune":
      return (
        <td
          key={id}
          className="max-w-[120px] truncate px-4 py-3 text-slate-400"
          title={o.commune || undefined}
        >
          {o.commune?.trim() ? o.commune : "—"}
        </td>
      );
    case "product":
      return (
        <td
          key={id}
          className="max-w-[160px] truncate px-4 py-3 text-slate-300"
          title={o.product}
        >
          {o.product}
        </td>
      );
    case "sku":
      return (
        <td
          key={id}
          className="max-w-[100px] truncate px-4 py-3 font-mono text-xs text-slate-400"
          title={o.sku || undefined}
        >
          {o.sku?.trim() ? o.sku : "—"}
        </td>
      );
    case "qty":
      return (
        <td key={id} className="px-4 py-3 tabular-nums text-slate-300">
          {o.quantity}
        </td>
      );
    case "items":
      return (
        <td key={id} className="px-4 py-3 tabular-nums text-slate-200">
          {formatMoneyDzd(Number(o.amount))}
        </td>
      );
    case "shipping":
      return (
        <td key={id} className="px-4 py-3 tabular-nums text-slate-300">
          {formatMoneyDzd(Number(o.shipping_cost ?? 0))}
        </td>
      );
    case "total":
      return (
        <td key={id} className="px-4 py-3 tabular-nums font-medium text-slate-100">
          {formatMoneyDzd(orderGrandTotal(o))}
        </td>
      );
    case "deliveryType": {
      const isPickup = o.delivery_type === "pickup-point";
      const label = isPickup ? "Stop desk" : "À domicile";
      const Icon = isPickup ? Building2 : Home;
      return (
        <td key={id} className="px-4 py-3 text-slate-100">
          <span
            className="inline-flex cursor-default items-center justify-center"
            title={label}
            aria-label={label}
            role="img"
          >
            <Icon
              className="h-5 w-5 text-slate-100"
              strokeWidth={1.75}
              aria-hidden
            />
          </span>
        </td>
      );
    }
    case "delivery":
      return (
        <td
          key={id}
          className="max-w-[120px] truncate px-4 py-3 text-slate-400"
          title={o.delivery_company}
        >
          {o.delivery_company || "—"}
        </td>
      );
    case "internalTracking":
      return (
        <td
          key={id}
          className="min-w-[11rem] max-w-[14rem] truncate px-4 py-3 font-mono text-xs text-slate-400"
          title={o.internal_tracking_id || undefined}
        >
          {o.internal_tracking_id?.trim() ? o.internal_tracking_id : "—"}
        </td>
      );
    case "tracking":
      return (
        <td
          key={id}
          className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-slate-400"
          title={o.tracking_number || undefined}
        >
          {o.tracking_number || "—"}
        </td>
      );
    case "shipStatus":
      return (
        <td
          key={id}
          className="max-w-[120px] truncate px-4 py-3 text-slate-400"
          title={o.shipping_status || undefined}
        >
          {o.shipping_status || "—"}
        </td>
      );
    case "source":
      return (
        <td
          key={id}
          className="max-w-[120px] truncate px-4 py-3 text-slate-400"
          title={o.source ?? "Manual"}
        >
          {o.source ?? "Manual"}
        </td>
      );
    case "created":
      return (
        <td
          key={id}
          className={`${STICKY_RIGHT_CREATED} border-l border-slate-800/80 bg-slate-900/95 px-4 py-3 text-slate-500 backdrop-blur-sm group-hover:bg-slate-800/25`}
        >
          {formatDate(o.created_at)}
        </td>
      );
    case "status":
      return (
        <td
          key={id}
          className={`${STICKY_RIGHT_STATUS} border-l border-slate-800/80 bg-slate-900/95 py-3 align-top backdrop-blur-sm group-hover:bg-slate-800/25 ${
            o.status === "confirmed"
              ? "overflow-hidden pl-2 pr-3"
              : "px-2"
          }`}
        >
          <InlineOrderState
            order={o}
            disabled={ctx.savingStateId === o.id}
            onApply={(next) => void ctx.onApplySnapshot(o, next)}
          />
        </td>
      );
    case "actions":
      return (
        <td
          key={id}
          className={`${STICKY_RIGHT_ACTIONS} border-l border-slate-800/80 bg-slate-900/95 px-3 py-3 backdrop-blur-sm group-hover:bg-slate-800/25`}
        >
          <div className="flex justify-start gap-1.5">
            <button
              type="button"
              onClick={() => ctx.onEdit(o)}
              className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
              title="Edit"
              aria-label="Edit order"
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={() => ctx.onHistory(o)}
              className="rounded-lg border border-indigo-600/40 px-2 py-1 text-sm leading-none text-indigo-200 hover:bg-indigo-950/50"
              title="History"
              aria-label="Order history"
            >
              🕐
            </button>
          </div>
        </td>
      );
    default:
      return <td key={id} />;
  }
}

function fullStatusLine(o: Pick<Order, "status" | "sub_status">): string {
  if (o.status === "new") return "New";
  const main = statusLabel(o.status);
  if (o.sub_status == null) return main;
  if (o.status === "confirmed" || o.status === "follow") {
    return main;
  }
  return `${main} · ${subStatusLabel(o.sub_status)}`;
}

function statusBadgeClass(status: OrderStatus): string {
  switch (status) {
    case "new":
      return "bg-blue-600 text-white";
    case "under_process":
      return "bg-orange-500 text-white";
    case "confirmed":
      return "bg-emerald-600 text-white";
    case "follow":
      return "bg-yellow-400 text-slate-900";
    case "completed":
      return "bg-teal-600 text-white";
    case "cancelled":
      return "bg-red-600 text-white";
    default:
      return "bg-slate-700 text-slate-100";
  }
}

/** Inline status choices when the row is main status Confirmed (sidebar “Confirmed”). */
const CONFIRMED_ROW_STATUS_OPTIONS: {
  snap: OrderSnapshot;
  label: string;
}[] = [
  { snap: { status: "new", sub_status: null }, label: "New" },
  {
    snap: { status: "under_process", sub_status: "postponed" },
    label: "Postponed",
  },
  {
    snap: { status: "cancelled", sub_status: "cancelled" },
    label: "Cancelled",
  },
  {
    snap: { status: "confirmed", sub_status: "confirmed" },
    label: "Confirmed",
  },
];

function InlineOrderState({
  order,
  disabled,
  onApply,
}: {
  order: Order;
  disabled: boolean;
  onApply: (next: OrderSnapshot) => void;
}) {
  function normalizeSnap(o: Order): OrderSnapshot {
    if (o.status === "new") return { status: "new", sub_status: null };
    if (o.status === "confirmed" || o.status === "follow") {
      return { status: o.status, sub_status: o.sub_status ?? "confirmed" };
    }
    if (o.sub_status == null) {
      // Defensive fallback for older rows.
      const fallback = o.status === "under_process"
        ? UNDER_PROCESS_SUBS[0]
        : o.status === "completed"
          ? COMPLETED_SUBS[0]
          : CANCELLED_SUBS[0];
      return { status: o.status, sub_status: fallback };
    }
    return { status: o.status, sub_status: o.sub_status };
  }

  function keyOf(s: OrderSnapshot): string {
    return `${s.status}__${s.sub_status ?? "none"}`;
  }

  const current = normalizeSnap(order);

  const candidates: OrderSnapshot[] = [
    { status: "new", sub_status: null },
    ...UNDER_PROCESS_SUBS.map((sub) => ({
      status: "under_process" as const,
      sub_status: sub,
    })),
    { status: "confirmed" as const, sub_status: "confirmed" },
    { status: "follow" as const, sub_status: "confirmed" },
    ...COMPLETED_SUBS.map((sub) => ({
      status: "completed" as const,
      sub_status: sub,
    })),
    ...CANCELLED_SUBS.map((sub) => ({
      status: "cancelled" as const,
      sub_status: sub,
    })),
  ];

  const currentKey = keyOf(current);

  const isConfirmedMainRow = order.status === "confirmed";

  const transitions = isConfirmedMainRow
    ? []
    : candidates
        .filter((c) => isValidTransition(current, c))
        .filter((s) => keyOf(s) !== currentKey)
        .filter(
          (s) => s.status !== "under_process" && s.status !== "cancelled"
        )
        .map((s) => ({ key: keyOf(s), snap: s }));

  const chevronStroke =
    order.status === "follow" ? "%231e293b" : "%23ffffff";

  const selectClassConfirmed =
    "box-border w-full min-w-0 max-w-full cursor-pointer appearance-none rounded-lg border-0 px-2 py-1.5 pr-6 text-left text-[11px] font-semibold leading-tight outline-none shadow-sm focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50";
  const selectClassDefault =
    "box-border w-max min-w-0 max-w-[9rem] cursor-pointer appearance-none rounded-lg border-0 px-2 py-1.5 pr-6 text-left text-xs font-semibold leading-snug outline-none shadow-sm focus:ring-2 focus:ring-white/40 disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <select
      value={currentKey}
      disabled={disabled}
      title="Change status"
      aria-label="Change order status"
      onChange={(e) => {
        const raw = e.target.value;
        const [st, subRaw] = raw.split("__");
        const next: OrderSnapshot = {
          status: st as OrderStatus,
          sub_status: subRaw === "none" ? null : (subRaw as OrderSubStatus),
        };
        onApply(next);
      }}
      className={`${isConfirmedMainRow ? selectClassConfirmed : selectClassDefault} ${statusBadgeClass(order.status)}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='${chevronStroke}'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 0.45rem center",
        backgroundSize: "0.65rem",
      }}
    >
      {isConfirmedMainRow
        ? CONFIRMED_ROW_STATUS_OPTIONS.map(({ snap, label }) => (
            <option key={keyOf(snap)} value={keyOf(snap)}>
              {label}
            </option>
          ))
        : (
            <>
              <option value={currentKey}>{fullStatusLine(order)}</option>
              {transitions.map((t) => (
                <option key={t.key} value={t.key}>
                  {fullStatusLine(t.snap)}
                </option>
              ))}
            </>
          )}
    </select>
  );
}
