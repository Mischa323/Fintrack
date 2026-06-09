import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/dashboard", icon: "◈", label: "Dashboard" },
  { to: "/accounts", icon: "🏦", label: "Accounts" },
  { to: "/transactions", icon: "↕", label: "Transactions" },
  { to: "/goals", icon: "◎", label: "Goals" },
  { to: "/categories", icon: "⊞", label: "Categories" },
  { to: "/recurring", icon: "⟳", label: "Recurring" },
  { to: "/import", icon: "⇪", label: "Import" },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

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
        <div style={{ padding: "8px 8px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", marginBottom: 12 }}>
          <img src="/logo.svg" alt="FinTrack" style={{ width: 148, height: "auto", display: "block" }} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 6, paddingLeft: 2 }}>Personal Finance</div>
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

        {/* Bottom: Settings + Logout */}
        <div style={{ marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <NavLink
            to="/settings"
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
      <main style={{ marginLeft: 220, flex: 1, padding: "32px 28px", maxWidth: "calc(100vw - 220px)" }}>
        <Outlet />
      </main>
    </div>
  );
}
