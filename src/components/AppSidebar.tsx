import { useMemo, useState, type ReactNode } from "react";
import { countByNavKey } from "../lib/sidebarNav";
import { statusLabel } from "../lib/orderWorkflow";
import type { Order, SidebarNavKey } from "../types/order";

function Badge({ n }: { n: number }) {
  return (
    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md bg-slate-800 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-200 ring-1 ring-slate-700/80">
      {n}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export type AppView =
  | "dashboard"
  | "orders"
  | "tracking_orders"
  | "sales_channels"
  | "products"
  | "delivery_companies"
  | "inventory"
  | "wallet";

interface AppSidebarProps {
  orders: Order[];
  navKey: SidebarNavKey;
  onNavKey: (key: SidebarNavKey) => void;
  collapsed: boolean;
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  salesChannelCount: number;
  onAddSalesChannel: () => void;
  activeProductCount: number;
  onAddProduct: () => void;
  activeDeliveryCompanyCount: number;
  onAddDeliveryCompany: () => void;
  inventoryCount: number;
}

function NavRow({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm transition ${
        active
          ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
          : "text-slate-300 hover:bg-slate-800/80"
      }`}
    >
      <span className="truncate">{label}</span>
      <Badge n={count} />
    </button>
  );
}

function CollapsedSectionIcon({
  title,
  active,
  onClick,
  tintClass,
  children,
}: {
  title: string;
  active: boolean;
  onClick: () => void;
  tintClass: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition ${
        active
          ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
          : "text-slate-300 hover:bg-slate-800/90"
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-md ${tintClass}`}
      >
        {children}
      </span>
    </button>
  );
}

export function AppSidebar({
  orders,
  navKey,
  onNavKey,
  collapsed,
  activeView,
  onViewChange,
  salesChannelCount,
  onAddSalesChannel,
  activeProductCount,
  onAddProduct,
  activeDeliveryCompanyCount,
  onAddDeliveryCompany,
  inventoryCount,
}: AppSidebarProps) {
  const [ordersOpen, setOrdersOpen] = useState(true);

  const counts = useMemo(() => {
    const keys: SidebarNavKey[] = [
      "new",
      "under_process",
      "confirmed",
      "follow",
      "completed",
      "cancelled",
      "all",
    ];
    const m = {} as Record<SidebarNavKey, number>;
    for (const k of keys) m[k] = countByNavKey(orders, k);
    return m;
  }, [orders]);

  return (
    <aside
      id="app-sidebar"
      className={`fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-slate-800/80 bg-slate-950/90 backdrop-blur-sm transition-[width] duration-200 ease-out ${
        collapsed ? "w-[60px]" : "w-[272px]"
      }`}
    >
      <div
        className={`box-border flex h-14 shrink-0 items-center border-b border-slate-800/80 px-4 py-3 ${
          collapsed ? "justify-center" : "justify-start"
        }`}
      >
        {!collapsed ? (
          <img
            src="/logo.png"
            alt="COD Manager"
            className="block h-8 w-auto max-w-full object-contain object-left"
          />
        ) : (
          <img
            src="/logo-icon.png"
            alt="COD Manager"
            className="block h-8 w-auto max-w-full object-contain"
          />
        )}
      </div>

      {collapsed ? (
        <nav
          className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto py-2"
          aria-label="Main"
        >
          <CollapsedSectionIcon
            title="Dashboard"
            active={activeView === "dashboard"}
            onClick={() => onViewChange("dashboard")}
            tintClass="bg-cyan-600/30 text-cyan-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 13h7V3H3v10zm0 8h7v-6H3v6zm11 0h7V11h-7v10zm0-18v6h7V3h-7z"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Orders"
            active={activeView === "orders"}
            onClick={() => onViewChange("orders")}
            tintClass="bg-indigo-600/30 text-indigo-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Tracking Orders"
            active={activeView === "tracking_orders"}
            onClick={() => {
              onViewChange("tracking_orders");
              onNavKey("follow");
            }}
            tintClass="bg-emerald-600/30 text-emerald-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 7h11v8H3V7zm11 2h3l4 4v2h-7V9zM7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Sales Channels"
            active={activeView === "sales_channels"}
            onClick={() => onViewChange("sales_channels")}
            tintClass="bg-violet-600/30 text-violet-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Products"
            active={activeView === "products"}
            onClick={() => onViewChange("products")}
            tintClass="bg-amber-600/30 text-amber-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Delivery Companies"
            active={activeView === "delivery_companies"}
            onClick={() => onViewChange("delivery_companies")}
            tintClass="bg-sky-600/30 text-sky-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Inventory"
            active={activeView === "inventory"}
            onClick={() => onViewChange("inventory")}
            tintClass="bg-teal-600/30 text-teal-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
          </CollapsedSectionIcon>
          <CollapsedSectionIcon
            title="Wallet"
            active={activeView === "wallet"}
            onClick={() => onViewChange("wallet")}
            tintClass="bg-emerald-600/30 text-emerald-200"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 9V7a4 4 0 00-4-4H7a4 4 0 00-4 4v10a4 4 0 004 4h10a4 4 0 004-4V9h-4zM3 10h18M17 13h.01"
              />
            </svg>
          </CollapsedSectionIcon>
        </nav>
      ) : (
        <nav className="flex-1 overflow-y-auto p-2" aria-label="Main">
          <div className="mb-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => onViewChange("dashboard")}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                activeView === "dashboard"
                  ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                  : "text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-600/30 text-cyan-200">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 13h7V3H3v10zm0 8h7v-6H3v6zm11 0h7V11h-7v10zm0-18v6h7V3h-7z" />
                  </svg>
                </span>
                <span className="truncate">Dashboard</span>
              </span>
            </button>
          </div>

          <div className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => setOrdersOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-200 hover:bg-slate-800/60"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/30 text-indigo-200">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                    />
                  </svg>
                </span>
                <span className="truncate">Orders</span>
              </span>
              <Chevron open={ordersOpen} />
            </button>

            {ordersOpen && (
              <div className="mt-1 space-y-0.5 border-t border-slate-800/60 pt-1">
                <NavRow
                  active={navKey === "new"}
                  onClick={() => onNavKey("new")}
                  label="New"
                  count={counts.new}
                />
                <NavRow
                  active={navKey === "under_process"}
                  onClick={() => onNavKey("under_process")}
                  label={statusLabel("under_process")}
                  count={counts.under_process}
                />
                <NavRow
                  active={navKey === "confirmed"}
                  onClick={() => onNavKey("confirmed")}
                  label={statusLabel("confirmed")}
                  count={counts.confirmed}
                />
                <NavRow
                  active={navKey === "completed"}
                  onClick={() => onNavKey("completed")}
                  label={statusLabel("completed")}
                  count={counts.completed}
                />
                <NavRow
                  active={navKey === "cancelled"}
                  onClick={() => onNavKey("cancelled")}
                  label={statusLabel("cancelled")}
                  count={counts.cancelled}
                />
                <NavRow
                  active={navKey === "all"}
                  onClick={() => onNavKey("all")}
                  label="All"
                  count={counts.all}
                />
              </div>
            )}
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => {
                onViewChange("tracking_orders");
                onNavKey("follow");
              }}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                activeView === "tracking_orders" && navKey === "follow"
                  ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                  : "text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-200">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 7h11v8H3V7zm11 2h3l4 4v2h-7V9zM7 19a2 2 0 100-4 2 2 0 000 4zm10 0a2 2 0 100-4 2 2 0 000 4z"
                    />
                  </svg>
                </span>
                <span className="truncate">Tracking Orders</span>
              </span>
              <Badge n={counts.follow} />
            </button>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <div className="flex items-center gap-1 px-1 py-1">
              <button
                type="button"
                onClick={() => onViewChange("sales_channels")}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                  activeView === "sales_channels"
                    ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                    : "text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600/30 text-violet-200">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 10V3L4 14h7v7l9-11h-7z"
                      />
                    </svg>
                  </span>
                  <span className="truncate">Sales Channels</span>
                </span>
                <Badge n={salesChannelCount} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewChange("sales_channels");
                  onAddSalesChannel();
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-lg font-semibold leading-none text-indigo-200 hover:border-indigo-500/50 hover:bg-slate-800"
                title="Add sales channel"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <div className="flex items-center gap-1 px-1 py-1">
              <button
                type="button"
                onClick={() => onViewChange("products")}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                  activeView === "products"
                    ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                    : "text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-600/30 text-amber-200">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                      />
                    </svg>
                  </span>
                  <span className="truncate">Products</span>
                </span>
                <Badge n={activeProductCount} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewChange("products");
                  onAddProduct();
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-lg font-semibold leading-none text-indigo-200 hover:border-indigo-500/50 hover:bg-slate-800"
                title="Add product"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <div className="flex items-center gap-1 px-1 py-1">
              <button
                type="button"
                onClick={() => onViewChange("delivery_companies")}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                  activeView === "delivery_companies"
                    ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                    : "text-slate-200 hover:bg-slate-800/60"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-600/30 text-sky-200">
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
                      />
                    </svg>
                  </span>
                  <span className="truncate">Delivery companies</span>
                </span>
                <Badge n={activeDeliveryCompanyCount} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewChange("delivery_companies");
                  onAddDeliveryCompany();
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800/60 text-lg font-semibold leading-none text-indigo-200 hover:border-indigo-500/50 hover:bg-slate-800"
                title="Add delivery company"
              >
                +
              </button>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => onViewChange("inventory")}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                activeView === "inventory"
                  ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                  : "text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-600/30 text-teal-200">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                    />
                  </svg>
                </span>
                <span className="truncate">Inventory</span>
              </span>
              <Badge n={inventoryCount} />
            </button>
          </div>

          <div className="mt-2 rounded-xl border border-slate-800/60 bg-slate-900/40 p-1">
            <button
              type="button"
              onClick={() => onViewChange("wallet")}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium transition ${
                activeView === "wallet"
                  ? "bg-indigo-600/25 text-white ring-1 ring-indigo-500/40"
                  : "text-slate-200 hover:bg-slate-800/60"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/30 text-emerald-200">
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 9V7a4 4 0 00-4-4H7a4 4 0 00-4 4v10a4 4 0 004 4h10a4 4 0 004-4V9h-4zM3 10h18M17 13h.01"
                    />
                  </svg>
                </span>
                <span className="truncate">Wallet</span>
              </span>
            </button>
          </div>
        </nav>
      )}
    </aside>
  );
}
