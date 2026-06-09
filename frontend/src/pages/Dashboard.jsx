import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { stats, transactions as txApi, goals as goalsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

// ── Widget catalog ────────────────────────────────────────────────────────────

const WIDGET_META = {
  "stat-balance":     { label: "Total Balance",        icon: "💰", defaultCols: 3 },
  "stat-income":      { label: "Income (all time)",    icon: "📈", defaultCols: 3 },
  "stat-expenses":    { label: "Expenses (all time)",  icon: "📉", defaultCols: 3 },
  "stat-netflow":     { label: "Net Flow",             icon: "⚡", defaultCols: 3 },
  "chart-monthly":    { label: "Income vs Expenses",   icon: "📊", defaultCols: 8 },
  "chart-categories": { label: "Spending by Category", icon: "🍩", defaultCols: 4 },
  "accounts":         { label: "Account Balances",     icon: "🏦", defaultCols: 12 },
  "recent-tx":        { label: "Recent Transactions",  icon: "📋", defaultCols: 6 },
  "goals":            { label: "Goals",                icon: "🎯", defaultCols: 6 },
  "account-group":   { label: "Account Group",        icon: "🗂", defaultCols: 3, multi: true },
};

const COLS_OPTIONS = [3, 4, 6, 8, 12];
const COLS_LABELS  = { 3: "¼", 4: "⅓", 6: "½", 8: "⅔", 12: "Full" };

const DEFAULT_WIDGETS = [
  { id: "d-stat-balance",     type: "stat-balance",     cols: 3 },
  { id: "d-stat-income",      type: "stat-income",      cols: 3 },
  { id: "d-stat-expenses",    type: "stat-expenses",    cols: 3 },
  { id: "d-stat-netflow",     type: "stat-netflow",     cols: 3 },
  { id: "d-chart-monthly",    type: "chart-monthly",    cols: 8 },
  { id: "d-chart-categories", type: "chart-categories", cols: 4 },
  { id: "d-accounts",         type: "accounts",         cols: 12 },
];

function makeDashboard(name = "Overview") {
  const ts = Date.now();
  return {
    id: `dash-${ts}`,
    name,
    widgets: DEFAULT_WIDGETS.map((w, i) => ({ ...w, id: `${w.id}-${ts}-${i}` })),
  };
}

// ── localStorage persistence ──────────────────────────────────────────────────

const LS_KEY = "fintrack_dashboards_v2";

function useDashboardConfig() {
  const [config, setConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    const initial = makeDashboard("Overview");
    return { dashboards: [initial], activeId: initial.id };
  });

  const commit = (fn) => setConfig(prev => {
    const next = fn(prev);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch {}
    return next;
  });

  const active = config.dashboards.find(d => d.id === config.activeId) || config.dashboards[0];

  return {
    config,
    active,
    setActive: (id) => commit(c => ({ ...c, activeId: id })),
    create: (name) => commit(c => {
      const d = makeDashboard(name);
      return { dashboards: [...c.dashboards, d], activeId: d.id };
    }),
    rename: (id, name) => commit(c => ({
      ...c,
      dashboards: c.dashboards.map(d => d.id === id ? { ...d, name } : d),
    })),
    remove: (id) => commit(c => {
      const rest = c.dashboards.filter(d => d.id !== id);
      if (rest.length === 0) {
        const fresh = makeDashboard("Overview");
        return { dashboards: [fresh], activeId: fresh.id };
      }
      return { dashboards: rest, activeId: c.activeId === id ? rest[0].id : c.activeId };
    }),
    updateWidgets: (dashId, widgets) => commit(c => ({
      ...c,
      dashboards: c.dashboards.map(d => d.id === dashId ? { ...d, widgets } : d),
    })),
  };
}

// ── Shared data fetcher ───────────────────────────────────────────────────────

function useStatsData() {
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly]   = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    Promise.all([stats.overview(), stats.monthly()])
      .then(([o, m]) => { setOverview(o); setMonthly(m); })
      .finally(() => setLoading(false));
  }, []);

  return { overview, monthly, loading };
}

// ── Widget content components ─────────────────────────────────────────────────

const STAT_CONFIG = {
  "stat-balance":  { key: d => d.totalBalance, label: "Total Balance",  color: "#818cf8", bg: "rgba(99,102,241,0.12)" },
  "stat-income":   { key: d => d.totalIncome,  label: "Income",         color: "#34d399", bg: "rgba(52,211,153,0.10)" },
  "stat-expenses": { key: d => d.totalExpenses,label: "Expenses",       color: "#f87171", bg: "rgba(248,113,113,0.10)" },
  "stat-netflow":  { key: d => (d.totalIncome || 0) - (d.totalExpenses || 0), label: "Net Flow", color: "#60a5fa", bg: "rgba(96,165,250,0.10)" },
};

function StatWidgetContent({ type, overview }) {
  const cfg = STAT_CONFIG[type];
  const val = overview ? cfg.key(overview) : null;
  return (
    <div style={{ background: cfg.bg, borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 500 }}>{cfg.label}</div>
      {val === null
        ? <div style={{ height: 36, background: "rgba(255,255,255,0.06)", borderRadius: 8, width: "70%" }} />
        : <div style={{ fontSize: 28, fontWeight: 700, color: cfg.color }}>{fmt(val)}</div>
      }
    </div>
  );
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass" style={{ padding: "10px 14px", fontSize: 13 }}>
      <div style={{ color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      {payload.map(p => <div key={p.name} style={{ color: p.color, fontWeight: 600 }}>{p.name}: {fmt(p.value)}</div>)}
    </div>
  );
};

function MonthlyChartContent({ monthly }) {
  return (
    <div style={{ height: "100%", minHeight: 200 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Income vs Expenses</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={monthly} barGap={4}>
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="income"   name="Income"   fill="#34d399" radius={[6,6,0,0]} opacity={0.85} />
          <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[6,6,0,0]} opacity={0.85} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryChartContent({ overview }) {
  const data = overview?.spendingByCategory || [];
  return (
    <div style={{ height: "100%", minHeight: 200 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Spending by Category</div>
      {data.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "40px 0", fontSize: 13 }}>No spending data yet</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data} dataKey="amount" nameKey="category.name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                {data.map((e, i) => <Cell key={i} fill={e.category?.color || "#6b7280"} opacity={0.85} />)}
              </Pie>
              <Tooltip formatter={v => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        )
      }
    </div>
  );
}

function AccountsWidgetContent({ overview }) {
  const navigate = useNavigate();
  const accounts = overview?.accounts || [];
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Account Balances</div>
      {accounts.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No accounts yet</div>
        : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {accounts.map(a => (
              <div key={a.id} onClick={() => navigate(`/transactions?accountId=${a.id}`)} style={{ padding: "12px 20px", borderRadius: 12, background: "rgba(255,255,255,0.04)", borderLeft: `3px solid ${a.color}`, minWidth: 150, cursor: "pointer" }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>{a.name}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: Number(a.balance) >= 0 ? "#34d399" : "#f87171" }}>{fmt(Number(a.balance))}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{a.type}</div>
              </div>
            ))}
          </div>
        )
      }
    </div>
  );
}

function RecentTxContent() {
  const navigate = useNavigate();
  const [txs, setTxs] = useState([]);
  useEffect(() => { txApi.list({ limit: 8 }).then(r => setTxs(r.transactions || [])); }, []);
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Recent Transactions</div>
      {txs.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No transactions yet</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {txs.map(t => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{t.description}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{t.category?.name || "—"} · {new Date(t.date).toLocaleDateString("nl-NL")}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: t.type === "INCOME" ? "#34d399" : "#f87171" }}>
                  {t.type === "INCOME" ? "+" : "-"}{fmt(Number(t.amount))}
                </div>
              </div>
            ))}
            <button onClick={() => navigate("/transactions")} style={{ background: "none", border: "none", color: "rgba(129,140,248,0.8)", fontSize: 13, cursor: "pointer", textAlign: "left", padding: "6px 0 0" }}>View all →</button>
          </div>
        )
      }
    </div>
  );
}

function GoalsWidgetContent() {
  const [goalList, setGoalList] = useState([]);
  useEffect(() => { goalsApi.list().then(setGoalList).catch(() => {}); }, []);
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Goals</div>
      {goalList.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No goals set</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {goalList.slice(0, 4).map(g => {
              const pct = Math.min(100, (Number(g.savedAmount) / Number(g.targetAmount)) * 100);
              return (
                <div key={g.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{g.name}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{fmt(Number(g.savedAmount))} / {fmt(Number(g.targetAmount))}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
                    <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: g.color || "#818cf8", transition: "width 0.4s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

function AccountGroupContent({ widget, overview }) {
  const { config = {} } = widget;
  const allAccounts = overview?.accounts || [];
  const selectedIds = config.accountIds;
  const filtered = selectedIds?.length ? allAccounts.filter(a => selectedIds.includes(a.id)) : allAccounts;
  const total = filtered.reduce((sum, a) => sum + Number(a.balance), 0);
  const color = config.color || "#818cf8";
  const label = config.label || "Account Group";
  const showIndividual = config.showIndividual !== false;

  return (
    <div style={{ background: `rgba(${hexToRgb(color)}, 0.12)`, borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{fmt(total)}</div>
      {showIndividual && filtered.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
          {filtered.map(a => (
            <div key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
              <span style={{ borderLeft: `2px solid ${a.color}`, paddingLeft: 7 }}>{a.name}</span>
              <span style={{ color: Number(a.balance) >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{fmt(Number(a.balance))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PRESET_COLORS = ["#818cf8", "#34d399", "#60a5fa", "#f87171", "#fbbf24", "#a78bfa", "#f472b6", "#22d3ee"];

function AccountGroupConfigModal({ initialConfig = {}, accounts = [], onSave, onCancel }) {
  const [label, setLabel] = useState(initialConfig.label || "Account Group");
  const [selectedIds, setSelectedIds] = useState(
    initialConfig.accountIds?.length ? initialConfig.accountIds : accounts.map(a => a.id)
  );
  const [color, setColor] = useState(initialConfig.color || "#818cf8");
  const [showIndividual, setShowIndividual] = useState(initialConfig.showIndividual !== false);

  const selected = accounts.filter(a => selectedIds.includes(a.id));
  const total = selected.reduce((sum, a) => sum + Number(a.balance), 0);

  const toggleAccount = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass-strong" style={{ width: 420, maxWidth: "90vw", padding: 28, borderRadius: 20 }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>Configure Account Group</h3>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, marginBottom: 6 }}>Widget Label</div>
          <input className="glass-input" value={label} onChange={e => setLabel(e.target.value)}
            style={{ width: "100%", padding: "9px 13px", boxSizing: "border-box" }} />
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, marginBottom: 8 }}>Color</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {PRESET_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: "50%", background: c, border: color === c ? "2px solid #fff" : "2px solid transparent", cursor: "pointer", outline: "none", padding: 0 }} />
            ))}
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              style={{ width: 28, height: 28, borderRadius: "50%", cursor: "pointer", padding: 0, border: "2px solid rgba(255,255,255,0.2)", background: color }} />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500 }}>
              Accounts ({selectedIds.length}/{accounts.length})
            </div>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => setSelectedIds(selectedIds.length === accounts.length ? [] : accounts.map(a => a.id))}>
              {selectedIds.length === accounts.length ? "Deselect all" : "Select all"}
            </button>
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
            {accounts.length === 0
              ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "12px 0" }}>No accounts found</div>
              : accounts.map(a => (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", cursor: "pointer" }}>
                  <input type="checkbox" checked={selectedIds.includes(a.id)} onChange={() => toggleAccount(a.id)} />
                  <div style={{ width: 3, height: 20, borderRadius: 2, background: a.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
                  <span style={{ fontSize: 12, color: Number(a.balance) >= 0 ? "#34d399" : "#f87171", fontWeight: 600 }}>{fmt(Number(a.balance))}</span>
                </label>
              ))
            }
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: "pointer" }}>
          <input type="checkbox" checked={showIndividual} onChange={e => setShowIndividual(e.target.checked)} />
          <span style={{ fontSize: 13 }}>Show individual account balances</span>
        </label>

        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "12px 16px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Combined total ({selectedIds.length} accounts)</span>
          <span style={{ fontSize: 20, fontWeight: 700, color }}>{fmt(total)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="glass-btn glass-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="glass-btn glass-btn-primary" onClick={() => onSave({ label, accountIds: selectedIds, color, showIndividual })}>
            Save widget
          </button>
        </div>
      </div>
    </div>
  );
}

function WidgetContent({ widget, overview, monthly }) {
  const { type } = widget;
  if (type.startsWith("stat-"))      return <StatWidgetContent type={type} overview={overview} />;
  if (type === "chart-monthly")      return <MonthlyChartContent monthly={monthly} />;
  if (type === "chart-categories")   return <CategoryChartContent overview={overview} />;
  if (type === "accounts")           return <AccountsWidgetContent overview={overview} />;
  if (type === "recent-tx")          return <RecentTxContent />;
  if (type === "goals")              return <GoalsWidgetContent />;
  if (type === "account-group")      return <AccountGroupContent widget={widget} overview={overview} />;
  return null;
}

// ── Add widget panel ──────────────────────────────────────────────────────────

function AddWidgetPanel({ existing, onAdd, onAddAccountGroup }) {
  const usedTypes = new Set(existing.map(w => w.type));
  const available = Object.entries(WIDGET_META).filter(([type, meta]) => meta.multi || !usedTypes.has(type));

  const singleTypes = available.filter(([, meta]) => !meta.multi);
  if (singleTypes.length === 0 && !WIDGET_META["account-group"]) return (
    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 13, padding: "20px 0" }}>All widgets are already on this dashboard</div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {available.map(([type, meta]) => (
        <button
          key={type}
          onClick={() => meta.multi ? onAddAccountGroup() : onAdd(type)}
          style={{
            background: "rgba(255,255,255,0.04)", border: `1px dashed ${meta.multi ? "rgba(129,140,248,0.3)" : "rgba(255,255,255,0.15)"}`,
            borderRadius: 12, padding: "14px 12px", cursor: "pointer", textAlign: "left",
            transition: "all 0.15s", color: "#fff",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.15)"; e.currentTarget.style.borderColor = "rgba(129,140,248,0.5)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor = meta.multi ? "rgba(129,140,248,0.3)" : "rgba(255,255,255,0.15)"; }}
        >
          <div style={{ fontSize: 22, marginBottom: 6 }}>{meta.icon}</div>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{meta.label}</div>
          {meta.multi && <div style={{ fontSize: 10, color: "rgba(199,210,254,0.5)", marginTop: 3 }}>Multiple allowed</div>}
        </button>
      ))}
    </div>
  );
}

// ── Dashboard grid with drag-and-drop ────────────────────────────────────────

function DashboardGrid({ widgets, editMode, overview, monthly, onWidgetsChange, onEditWidget }) {
  const [dragIdx, setDragIdx]   = useState(null);
  const [dropIdx, setDropIdx]   = useState(null);

  const reorder = (from, to) => {
    if (from === to) return;
    const next = [...widgets];
    const [item] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, item);
    onWidgetsChange(next);
  };

  const removeWidget = (id) => onWidgetsChange(widgets.filter(w => w.id !== id));
  const resizeWidget = (id, cols) => onWidgetsChange(widgets.map(w => w.id === id ? { ...w, cols } : w));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 20 }}>
      {widgets.map((widget, i) => {
        const isDragging   = dragIdx === i;
        const isDropTarget = dropIdx === i && dragIdx !== null && dragIdx !== i;
        const meta = WIDGET_META[widget.type];

        const dragHandlers = editMode ? {
          draggable: true,
          onDragStart: () => setDragIdx(i),
          onDragEnd:   () => { if (dropIdx !== null) reorder(dragIdx, dropIdx); setDragIdx(null); setDropIdx(null); },
          onDragOver:  (e) => { e.preventDefault(); setDropIdx(i); },
          onDragLeave: () => setDropIdx(null),
        } : {};

        return (
          <div
            key={widget.id}
            style={{
              gridColumn: `span ${widget.cols}`,
              position: "relative",
              opacity: isDragging ? 0.35 : 1,
              outline: isDropTarget ? "2px dashed rgba(129,140,248,0.7)" : "none",
              borderRadius: 20,
              transition: "opacity 0.15s",
            }}
            {...dragHandlers}
          >
            {editMode && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10, borderRadius: 20,
                background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
                border: "2px dashed rgba(129,140,248,0.4)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
                cursor: "grab",
              }}>
                <div style={{ fontSize: 22, color: "rgba(255,255,255,0.5)" }}>⠿</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>{meta.label}</div>

                <div style={{ display: "flex", gap: 4 }}>
                  {COLS_OPTIONS.map(c => (
                    <button key={c} onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); resizeWidget(widget.id, c); }}
                      style={{ padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", background: widget.cols === c ? "rgba(129,140,248,0.5)" : "rgba(255,255,255,0.1)", border: widget.cols === c ? "1px solid rgba(129,140,248,0.8)" : "1px solid rgba(255,255,255,0.15)", color: "#fff" }}>
                      {COLS_LABELS[c]}
                    </button>
                  ))}
                </div>

                {widget.type === "account-group" && (
                  <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onEditWidget(widget); }}
                    style={{ background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.4)", color: "#c7d2fe", borderRadius: 8, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                    ✏ Edit
                  </button>
                )}
                <button onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); removeWidget(widget.id); }}
                  style={{ background: "rgba(239,68,68,0.25)", border: "1px solid rgba(239,68,68,0.4)", color: "#f87171", borderRadius: 8, padding: "4px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                  Remove
                </button>
              </div>
            )}

            <GlassCard style={{ height: "100%", boxSizing: "border-box" }}>
              <WidgetContent widget={widget} overview={overview} monthly={monthly} />
            </GlassCard>
          </div>
        );
      })}
    </div>
  );
}

// ── Inline rename input ───────────────────────────────────────────────────────

function InlineRename({ value, onSave, onCancel }) {
  const [v, setV] = useState(value);
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const commit = () => { if (v.trim()) onSave(v.trim()); else onCancel(); };
  return (
    <input
      ref={ref}
      value={v}
      onChange={e => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") onCancel(); }}
      style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(129,140,248,0.6)", borderRadius: 8, padding: "3px 10px", color: "#fff", fontSize: 13, fontWeight: 600, width: 130, outline: "none" }}
    />
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { overview, monthly, loading } = useStatsData();
  const { config, active, setActive, create, rename, remove, updateWidgets } = useDashboardConfig();
  const [editMode, setEditMode]   = useState(false);
  const [showAdd, setShowAdd]     = useState(false);
  const [renaming, setRenaming]   = useState(null);
  const [newDashName, setNewDashName] = useState("");
  const [creating, setCreating]   = useState(false);
  const [configModal, setConfigModal] = useState(null); // { mode: "add" | "edit", widget? }

  const handleWidgetsChange = (widgets) => updateWidgets(active.id, widgets);

  const handleAddWidget = (type) => {
    const meta = WIDGET_META[type];
    const newWidget = { id: `w-${type}-${Date.now()}`, type, cols: meta.defaultCols };
    updateWidgets(active.id, [...active.widgets, newWidget]);
  };

  const handleSaveAccountGroup = (cfg) => {
    if (configModal.mode === "add") {
      const newWidget = { id: `w-account-group-${Date.now()}`, type: "account-group", cols: WIDGET_META["account-group"].defaultCols, config: cfg };
      updateWidgets(active.id, [...active.widgets, newWidget]);
    } else {
      updateWidgets(active.id, active.widgets.map(w => w.id === configModal.widget.id ? { ...w, config: cfg } : w));
    }
    setConfigModal(null);
    setShowAdd(false);
  };

  const handleCreateDashboard = () => {
    const name = newDashName.trim() || `Dashboard ${config.dashboards.length + 1}`;
    create(name);
    setCreating(false);
    setNewDashName("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {configModal && (
        <AccountGroupConfigModal
          initialConfig={configModal.widget?.config}
          accounts={overview?.accounts || []}
          onSave={handleSaveAccountGroup}
          onCancel={() => setConfigModal(null)}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Dashboard</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Your financial overview</p>
        </div>
        <button
          className={`glass-btn ${editMode ? "glass-btn-primary" : "glass-btn-ghost"}`}
          style={{ padding: "9px 18px" }}
          onClick={() => { setEditMode(e => !e); setShowAdd(false); }}
        >
          {editMode ? "✓ Done editing" : "✏ Customize"}
        </button>
      </div>

      {/* Dashboard tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {config.dashboards.map(d => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 0 }}>
            {renaming === d.id ? (
              <InlineRename value={d.name} onSave={name => { rename(d.id, name); setRenaming(null); }} onCancel={() => setRenaming(null)} />
            ) : (
              <button
                onClick={() => setActive(d.id)}
                onDoubleClick={() => setRenaming(d.id)}
                style={{
                  padding: "7px 16px", borderRadius: 10, fontSize: 13, fontWeight: active.id === d.id ? 600 : 400,
                  cursor: "pointer", transition: "all 0.15s",
                  border: active.id === d.id ? "1px solid rgba(129,140,248,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  background: active.id === d.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                  color: active.id === d.id ? "#c7d2fe" : "rgba(255,255,255,0.5)",
                  display: "flex", alignItems: "center", gap: 6,
                }}
                title="Double-click to rename"
              >
                {d.name}
                {editMode && config.dashboards.length > 1 && (
                  <span onClick={e => { e.stopPropagation(); remove(d.id); }} style={{ fontSize: 14, color: "rgba(248,113,113,0.6)", lineHeight: 1, marginLeft: 2 }}>×</span>
                )}
              </button>
            )}
          </div>
        ))}

        {/* New dashboard */}
        {creating ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              autoFocus
              value={newDashName}
              onChange={e => setNewDashName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateDashboard(); if (e.key === "Escape") { setCreating(false); setNewDashName(""); } }}
              placeholder="Dashboard name"
              className="glass-input"
              style={{ padding: "6px 12px", fontSize: 13, width: 150 }}
            />
            <button className="glass-btn glass-btn-primary" style={{ padding: "6px 14px", fontSize: 13 }} onClick={handleCreateDashboard}>Add</button>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => { setCreating(false); setNewDashName(""); }}>✕</button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            style={{ padding: "7px 12px", borderRadius: 10, fontSize: 13, cursor: "pointer", background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.4)", transition: "all 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.3)"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.4)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
          >
            + New dashboard
          </button>
        )}
      </div>

      {/* Edit mode hint */}
      {editMode && (
        <div style={{ padding: "10px 16px", borderRadius: 12, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(129,140,248,0.25)", fontSize: 13, color: "rgba(199,210,254,0.8)", display: "flex", alignItems: "center", gap: 8 }}>
          <span>⠿</span> Drag widgets to reorder · click size buttons to resize · click Remove to delete · double-click a tab to rename it
        </div>
      )}

      {loading ? (
        <div style={{ color: "rgba(255,255,255,0.4)", padding: 40, textAlign: "center" }}>Loading…</div>
      ) : (
        <DashboardGrid
          widgets={active.widgets}
          editMode={editMode}
          overview={overview}
          monthly={monthly}
          onWidgetsChange={handleWidgetsChange}
          onEditWidget={(widget) => setConfigModal({ mode: "edit", widget })}
        />
      )}

      {/* Add widget panel */}
      {editMode && (
        <div>
          <button
            className="glass-btn glass-btn-ghost"
            style={{ padding: "9px 18px", marginBottom: showAdd ? 14 : 0 }}
            onClick={() => setShowAdd(v => !v)}
          >
            {showAdd ? "▲ Hide widget picker" : "+ Add widget"}
          </button>
          {showAdd && (
            <GlassCard>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Add widget</div>
              <AddWidgetPanel
                existing={active.widgets}
                onAdd={type => { handleAddWidget(type); setShowAdd(false); }}
                onAddAccountGroup={() => setConfigModal({ mode: "add" })}
              />
            </GlassCard>
          )}
        </div>
      )}
    </div>
  );
}
