import { useCallback, useEffect, useMemo, useState } from "react";
import { WILAYAS, WILAYA_FILTER_ALL } from "../constants/wilayas";
import { MANUAL_ORDER_SOURCE } from "../constants/source";
import { exportOrdersToCsv } from "../lib/csv";
import {
  CANCELLED_SUBS,
  COMPLETED_SUBS,
  UNDER_PROCESS_SUBS,
  isValidOrderState,
  isValidTransition,
  subStatusLabel,
} from "../lib/orderWorkflow";
import { navKeyLabel, orderMatchesNavKey } from "../lib/sidebarNav";
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
  return Number(o.amount) + Number(o.shipping_cost ?? 0);
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

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    // Keep "All" selected when switching between main sidebar items.
    setSubStatusFilter(null);
  }, [navKey]);

  useEffect(() => {
    if (navKey !== "confirmed") {
      setSelectedOrderIds(new Set());
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
      return true;
    });
  }, [orders, navKey, subStatusFilter, fromMs, toMs, wilayaFilter]);

  const loadChannelCount = useCallback(async () => {
    const { count } = await supabase
      .from("sales_channels")
      .select("*", { count: "exact", head: true });
    setChannelCount(count ?? 0);
  }, []);

  const onChannelsChanged = useCallback(() => {
    void loadChannelCount();
  }, [loadChannelCount]);

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
  }, [loadActiveProductCount]);

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
    previous: OrderSnapshot | null
  ) {
    if (!isValidOrderState(values.status, values.sub_status)) {
      throw new Error("Invalid status / sub-status combination.");
    }
    if (
      previous &&
      !isValidTransition(previous, {
        status: values.status,
        sub_status: values.sub_status,
      })
    ) {
      throw new Error("Invalid status / sub-status transition.");
    }

    const preservedShip =
      formMode === "edit" && editingOrder
        ? Number(editingOrder.shipping_cost ?? 0)
        : 0;

    const payload = {
      customer_name: values.customer_name.trim(),
      phone: values.phone.trim(),
      wilaya: values.wilaya,
      address: values.address.trim(),
      product: values.product.trim(),
      quantity: values.quantity,
      amount: values.amount,
      shipping_cost: preservedShip,
      total_amount: values.amount + preservedShip,
      notes: values.notes.trim(),
      status: values.status,
      sub_status: values.sub_status,
      source:
        formMode === "create"
          ? MANUAL_ORDER_SOURCE
          : editingOrder?.source ?? MANUAL_ORDER_SOURCE,
      delivery_company: values.delivery_company.trim(),
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

  function toggleSelectAllConfirmed(checked: boolean) {
    if (checked) {
      setSelectedOrderIds(new Set(filteredOrders.map((o) => o.id)));
    } else {
      setSelectedOrderIds(new Set());
    }
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
              onClick={() => void loadOrders()}
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
          </div>
        </section>

        <section className="mb-8 rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 ring-1 ring-white/5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Advanced filters
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          </div>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-4 text-sm text-indigo-400 hover:text-indigo-300"
          >
            Clear date & wilaya filters
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
              {selectedOrderIds.size > 0 && (
                <p className="text-xs text-slate-500">
                  {selectedOrderIds.size} order
                  {selectedOrderIds.size === 1 ? "" : "s"} selected
                </p>
              )}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs uppercase tracking-wider text-slate-500">
                  {navKey === "confirmed" && (
                    <th className="w-10 px-2 py-3 font-medium">
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={(e) =>
                          toggleSelectAllConfirmed(e.target.checked)
                        }
                        disabled={bulkWorking || filteredOrders.length === 0}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
                        title="Select all in this list"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Wilaya</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Items</th>
                  <th className="px-4 py-3 font-medium">Shipping</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Delivery</th>
                  <th className="px-4 py-3 font-medium">Tracking</th>
                  <th className="px-4 py-3 font-medium">Ship status</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!loading &&
                  filteredOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-800/20">
                      {navKey === "confirmed" && (
                        <td className="px-2 py-3">
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(o.id)}
                            onChange={(e) =>
                              toggleOrderSelected(o.id, e.target.checked)
                            }
                            disabled={bulkWorking}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-indigo-500"
                            aria-label={`Select order ${o.customer_name}`}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 font-medium text-slate-100">
                        {o.customer_name}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{o.phone || "—"}</td>
                      <td
                        className="max-w-[140px] truncate px-4 py-3 text-slate-400"
                        title={o.wilaya}
                      >
                        {o.wilaya || "—"}
                      </td>
                      <td
                        className="max-w-[160px] truncate px-4 py-3 text-slate-300"
                        title={o.product}
                      >
                        {o.product}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">
                        {o.quantity}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-200">
                        {formatMoneyDzd(Number(o.amount))}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-300">
                        {formatMoneyDzd(Number(o.shipping_cost ?? 0))}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-medium text-slate-100">
                        {formatMoneyDzd(orderGrandTotal(o))}
                      </td>
                      <td
                        className="max-w-[120px] truncate px-4 py-3 text-slate-400"
                        title={o.delivery_company}
                      >
                        {o.delivery_company || "—"}
                      </td>
                      <td
                        className="max-w-[140px] truncate px-4 py-3 font-mono text-xs text-slate-400"
                        title={o.tracking_number || undefined}
                      >
                        {o.tracking_number || "—"}
                      </td>
                      <td
                        className="max-w-[120px] truncate px-4 py-3 text-slate-400"
                        title={o.shipping_status || undefined}
                      >
                        {o.shipping_status || "—"}
                      </td>
                      <td
                        className="max-w-[120px] truncate px-4 py-3 text-slate-400"
                        title={o.source ?? "Manual"}
                      >
                        {o.source ?? "Manual"}
                      </td>
                      <td className="px-4 py-3">
                        <InlineOrderState
                          order={o}
                          disabled={savingStateId === o.id}
                          onApply={(next) => void applyInlineSnapshot(o, next)}
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {formatDate(o.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(o)}
                            className="rounded-lg border border-slate-600 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => openHistory(o)}
                            className="rounded-lg border border-indigo-600/40 px-2 py-1 text-xs font-medium text-indigo-200 hover:bg-indigo-950/50"
                          >
                            History
                          </button>
                        </div>
                      </td>
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

  function labelOf(s: OrderSnapshot): string {
    if (s.status === "new") return "New";
    return subStatusLabel(s.sub_status);
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

  const allowed = candidates.filter((c) => isValidTransition(current, c));
  const options = allowed
    .filter((s) => keyOf(s) !== currentKey)
    .map((s) => ({
    key: keyOf(s),
    label: labelOf(s),
  }));

  return (
    <select
      value={currentKey}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value;
        const [st, subRaw] = raw.split("__");
        const next: OrderSnapshot = {
          status: st as OrderStatus,
          sub_status: subRaw === "none" ? null : (subRaw as OrderSubStatus),
        };
        onApply(next);
      }}
      className="w-full cursor-pointer rounded-lg border-0 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-100 ring-1 ring-slate-600 outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
