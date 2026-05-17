import { Outlet, NavLink } from "react-router-dom";

const NAV = [
  { to: "/dashboard", icon: "◈", label: "Dashboard" },
  { to: "/accounts", icon: "🏦", label: "Accounts" },
  { to: "/transactions", icon: "↕", label: "Transactions" },
  { to: "/categories", icon: "⊞", label: "Categories" },
  { to: "/recurring", icon: "⟳", label: "Recurring" },
  { to: "/import", icon: "⇪", label: "Import" },
];

export default function Layout() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside className="glass-strong" style={{
        width: 220,
        minHeight: "100vh",
        padding: "24px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        zIndex: 10,
        borderRadius: 0,
        borderRight: "1px solid rgba(255,255,255,0.1)",
      }}>
        {/* Logo */}
        <div style={{ padding: "8px 16px 24px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700, background: "linear-gradient(135deg,#818cf8,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            FinTrack
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>Personal Finance</div>
        </div>

        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <span style={{ fontSize: 16 }}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </aside>

      {/* Main content */}
      <main style={{ marginLeft: 220, flex: 1, padding: "32px 28px", maxWidth: "calc(100vw - 220px)" }}>
        <Outlet />
      </main>
    </div>
  );
}
