import { OrdersDashboard } from "./components/OrdersDashboard";

export default function App() {
  return (
    <div className="min-h-screen bg-[#0f1419] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(99,102,241,0.18),transparent)]">
      <div className="flex min-h-screen flex-col">
        <header className="flex min-h-[120px] items-center border-b border-slate-800/80 bg-slate-950/40 px-4 sm:px-8">
          <img
            src="/logo.png"
            alt="COD Manager"
            style={{ height: 120, width: "auto", display: "block" }}
          />
        </header>

        <OrdersDashboard />
      </div>
    </div>
  );
}
