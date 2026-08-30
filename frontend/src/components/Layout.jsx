import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/dashboard", icon: "◈", label: "Dashboard" },
  { to: "/accounts", icon: "🏦", label: "Accounts" },
  { to: "/transactions", icon: "↕", label: "Transactions" },
  { to: "/goals", icon: "◎", label: "Goals" },
  { to: "/loans", icon: "🤝", label: "Money Lent" },
  { to: "/categories", icon: "⊞", label: "Categories" },
  { to: "/recurring", icon: "⟳", label: "Recurring" },
  { to: "/receipts", icon: "🧾", label: "Receipts" },
  { to: "/import", icon: "⇪", label: "Import" },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  // On mobile the sidebar is an off-canvas drawer; tapping a link or the backdrop
  // closes it. On desktop the class does nothing and the sidebar is always shown.
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  function handleLogout() {
    close();
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      {/* Mobile top bar (hidden on desktop via CSS) */}
      <div className="mobile-topbar glass-strong">
        <button className="hamburger" onClick={() => setOpen((v) => !v)} aria-label="Menu">☰</button>
        <img src="/logo.svg" alt="FinTrack" style={{ height: 24, width: "auto" }} />
      </div>

      {/* Backdrop behind the open drawer (mobile only) */}
      <div className={`sidebar-backdrop${open ? " open" : ""}`} onClick={close} />

      {/* Sidebar / drawer */}
      <aside className={`sidebar glass-strong${open ? " open" : ""}`}>
        {/* Logo */}
        <div style={{ padding: "8px 8px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
          <img src="/logo.svg" alt="FinTrack" style={{ width: 148, height: "auto", display: "block" }} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 6, paddingLeft: 2 }}>Personal Finance</div>
        </div>

        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={close}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <span style={{ fontSize: 16 }}>{n.icon}</span>
            {n.label}
          </NavLink>
        ))}

        {/* Bottom: Settings + Logout */}
        <div style={{ marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <NavLink
            to="/settings"
            onClick={close}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <span style={{ fontSize: 16 }}>⚙</span>
            Settings
          </NavLink>
          <button
            onClick={handleLogout}
            className="nav-item"
            style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.5)", textAlign: "left", width: "100%" }}
          >
            <span style={{ fontSize: 16 }}>⏻</span>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
