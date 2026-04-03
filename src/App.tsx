import { OrdersDashboard } from "./components/OrdersDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0f1419] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.18),transparent)]">
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-slate-800/80 bg-slate-950/40 px-4 py-5 sm:px-8">
          <p className="text-sm font-medium uppercase tracking-widest text-indigo-400/90">
            SaaS dashboard
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Order management
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400 sm:text-base">
            Collapsible sidebar, main status + sub-status workflow, delivery
            fields, history, filters, and CSV export.
          </p>
        </header>

        <OrdersDashboard />
      </div>
    </div>
  );
}
