import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { stats, transactions as txApi, goals as goalsApi, holdings as holdingsApi, loans as loansApi, recurring as recurringApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
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
  "stat-income":      { label: "Income",               icon: "📈", defaultCols: 3 },
  "stat-expenses":    { label: "Expenses",             icon: "📉", defaultCols: 3 },
  "stat-netflow":     { label: "Net Flow",             icon: "⚡", defaultCols: 3 },
  "chart-monthly":    { label: "Income vs Expenses",   icon: "📊", defaultCols: 8 },
  "chart-categories": { label: "Spending by Category", icon: "🍩", defaultCols: 4 },
  "accounts":         { label: "Account Balances",     icon: "🏦", defaultCols: 12 },
  "recent-tx":        { label: "Recent Transactions",  icon: "📋", defaultCols: 6 },
  "goals":            { label: "Goals",                icon: "🎯", defaultCols: 6 },
  "investments":      { label: "Investments",          icon: "📈", defaultCols: 6 },
  "loans":            { label: "Money Lent",           icon: "🤝", defaultCols: 3 },
  "recurring-upcoming": { label: "Upcoming Subscriptions", icon: "🔁", defaultCols: 6 },
  "savings-rate":     { label: "Savings Rate",         icon: "🐖", defaultCols: 3 },
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

// ── Time range ────────────────────────────────────────────────────────────────

const RANGES = [
  { id: "ytd", label: "This year" },
  { id: "1y",  label: "1 year"    },
  { id: "2y",  label: "2 years"   },
  { id: "5y",  label: "5 years"   },
  { id: "all", label: "All time"  },
];

const RANGE_LS_KEY = "fintrack_dashboard_range";

// Translates a range id into query params for the stats endpoints.
// Boundaries are anchored to UTC midnight: transaction dates are stored as
// date-only (UTC), so a local-midnight boundary would bleed into the prior year.
function rangeParams(id) {
  const now = new Date();
  if (id === "all") return {};
  if (id === "ytd") {
    return { from: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString() };
  }
  const years = { "1y": 1, "2y": 2, "5y": 5 }[id] || 1;
  const from = new Date(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()));
  return { from: from.toISOString() };
}

function useRange() {
  const [range, setRange] = useState(() => {
    try {
      const saved = localStorage.getItem(RANGE_LS_KEY);
      if (saved && RANGES.some(r => r.id === saved)) return saved;
    } catch {}
    return "ytd";
  });

  const update = (id) => {
    setRange(id);
    try { localStorage.setItem(RANGE_LS_KEY, id); } catch {}
  };

  return [range, update];
}

function RangeSelector({ value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: "rgba(255,255,255,0.05)" }}>
      {RANGES.map(r => {
        const active = r.id === value;
        return (
          <button
            key={r.id}
            onClick={() => onChange(r.id)}
            style={{
              padding: "6px 12px", borderRadius: 7, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: active ? 600 : 500,
              background: active ? "rgba(129,140,248,0.9)" : "transparent",
              color: active ? "#0f172a" : "rgba(255,255,255,0.55)",
              transition: "all 0.15s",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Shared data fetcher ───────────────────────────────────────────────────────

function useStatsData(range) {
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly]   = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = rangeParams(range);
    Promise.all([stats.overview(params), stats.monthly(params)])
      .then(([o, m]) => { if (!cancelled) { setOverview(o); setMonthly(m); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range]);

  return { overview, monthly, loading };
}

// ── Widget content components ─────────────────────────────────────────────────

const STAT_CONFIG = {
  "stat-balance":  { key: d => d.totalBalance, label: "Total Balance",  color: "#818cf8", bg: "rgba(99,102,241,0.12)" },
  "stat-income":   { key: d => d.totalIncome,  label: "Income",         color: "#34d399", bg: "rgba(52,211,153,0.10)" },
  "stat-expenses": { key: d => d.totalExpenses,label: "Expenses",       color: "#f87171", bg: "rgba(248,113,113,0.10)" },
  "stat-netflow":  { key: d => (d.totalIncome || 0) - (d.totalExpenses || 0), label: "Net Flow", color: "#60a5fa", bg: "rgba(96,165,250,0.10)" },
};

// Where each stat tile drills down to when clicked.
const STAT_LINKS = {
  "stat-balance": "/accounts",
  "stat-income": "/transactions?type=INCOME",
  "stat-expenses": "/transactions?type=EXPENSE",
  "stat-netflow": "/transactions",
};

function StatWidgetContent({ type, overview }) {
  const navigate = useNavigate();
  const cfg = STAT_CONFIG[type];
  const val = overview ? cfg.key(overview) : null;
  return (
    <div onClick={() => navigate(STAT_LINKS[type])} style={{ background: cfg.bg, borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box", cursor: "pointer" }}>
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

// The monthly buckets are keyed "YYYY-MM" (or "YYYY" for long ranges); turn one
// into a from/to pair so a bar click deep-links to that period's transactions.
function bucketRange(key) {
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 0, 23, 59, 59)).toISOString() };
  }
  if (/^\d{4}$/.test(key)) {
    const y = Number(key);
    return { from: new Date(Date.UTC(y, 0, 1)).toISOString(), to: new Date(Date.UTC(y, 11, 31, 23, 59, 59)).toISOString() };
  }
  return null;
}

function MonthlyChartContent({ monthly }) {
  const navigate = useNavigate();
  const openBucket = (entry, type) => {
    const key = entry?.month || entry?.payload?.month;
    const range = bucketRange(key);
    if (!range) return;
    navigate(`/transactions?type=${type}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
  };
  return (
    <div style={{ height: "100%", minHeight: 200 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Income vs Expenses</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={monthly} barGap={4}>
          <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
          <Bar dataKey="income"   name="Income"   fill="#34d399" radius={[6,6,0,0]} opacity={0.85} cursor="pointer" onClick={(e) => openBucket(e, "INCOME")} />
          <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[6,6,0,0]} opacity={0.85} cursor="pointer" onClick={(e) => openBucket(e, "EXPENSE")} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 2 }}>
        Tip: tap a bar to see that month's transactions
      </div>
    </div>
  );
}

function CategoryChartContent({ overview }) {
  const navigate = useNavigate();
  const data = overview?.spendingByCategory || [];

  // Click a slice to see every transaction in that category (uncategorized has no
  // id, so it uses the "none" filter the Transactions page understands).
  const openCategory = (entry) => {
    const cat = entry?.category || entry?.payload?.category;
    if (!cat) return;
    navigate(`/transactions?type=EXPENSE&categoryId=${cat.id || "none"}`);
  };

  return (
    <div style={{ height: "100%", minHeight: 200 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Spending by Category</div>
      {data.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "40px 0", fontSize: 13 }}>No spending data yet</div>
        : (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={data} dataKey="amount" nameKey="category.name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}
                onClick={openCategory} style={{ cursor: "pointer", outline: "none" }}>
                {data.map((e, i) => <Cell key={i} fill={e.category?.color || "#6b7280"} opacity={0.85} style={{ cursor: "pointer", outline: "none" }} />)}
              </Pie>
              <Tooltip formatter={v => fmt(v)} />
            </PieChart>
          </ResponsiveContainer>
        )
      }
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", textAlign: "center", marginTop: 4 }}>
        Tip: tap a slice to see its transactions
      </div>
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
              <div key={t.id} onClick={() => navigate(`/transactions?accountId=${t.accountId}`)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}>
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
  const navigate = useNavigate();
  const [goalList, setGoalList] = useState([]);
  useEffect(() => { goalsApi.list().then(setGoalList).catch(() => {}); }, []);
  return (
    <div onClick={() => navigate("/goals")} style={{ cursor: "pointer" }}>
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

// Resolve which accounts a group widget covers. Selecting groups is dynamic — a
// new account added to a chosen group shows up automatically — while selecting
// individual accounts is fixed. Nothing selected means every account.
function resolveGroupAccounts(accounts, config = {}) {
  if (config.groupNames?.length) {
    return accounts.filter((a) => config.groupNames.includes(a.groupName || ""));
  }
  if (config.accountIds?.length) {
    return accounts.filter((a) => config.accountIds.includes(a.id));
  }
  return accounts;
}

function AccountGroupContent({ widget, overview }) {
  const navigate = useNavigate();
  const { config = {} } = widget;
  const allAccounts = overview?.accounts || [];
  const filtered = resolveGroupAccounts(allAccounts, config);
  const total = filtered.reduce((sum, a) => sum + Number(a.balance), 0);
  const color = config.color || "#818cf8";
  const label = config.label || "Account Group";
  const showIndividual = config.showIndividual !== false;

  return (
    <div style={{ background: `rgba(${hexToRgb(color)}, 0.12)`, borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box" }}>
      <div onClick={() => navigate("/accounts")} style={{ cursor: "pointer" }}>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color }}>{fmt(total)}</div>
      </div>
      {showIndividual && filtered.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
          {filtered.map(a => (
            <div key={a.id} onClick={() => navigate(`/transactions?accountId=${a.id}`)} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.5)", cursor: "pointer" }}>
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
  const groupNames = [...new Set(accounts.map(a => a.groupName).filter(Boolean))];
  const [mode, setMode] = useState(initialConfig.groupNames?.length || (initialConfig.accountIds == null && groupNames.length) ? "group" : "account");
  const [label, setLabel] = useState(initialConfig.label || "Account Group");
  const [labelTouched, setLabelTouched] = useState(!!initialConfig.label);
  const [selectedGroups, setSelectedGroups] = useState(initialConfig.groupNames || []);
  const [selectedIds, setSelectedIds] = useState(
    initialConfig.accountIds?.length ? initialConfig.accountIds : accounts.map(a => a.id)
  );
  const [color, setColor] = useState(initialConfig.color || "#818cf8");
  const [showIndividual, setShowIndividual] = useState(initialConfig.showIndividual !== false);

  const toggleGroup = (g) =>
    setSelectedGroups(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  const toggleAccount = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  // Which accounts the current selection covers, for the live total preview.
  const selected = mode === "group"
    ? accounts.filter(a => selectedGroups.includes(a.groupName || ""))
    : accounts.filter(a => selectedIds.includes(a.id));
  const total = selected.reduce((sum, a) => sum + Number(a.balance), 0);

  // Auto-name the widget after the chosen groups until the user edits the label.
  const effectiveLabel = labelTouched ? label : (mode === "group" && selectedGroups.length ? selectedGroups.join(" + ") : label);

  const save = () => onSave(
    mode === "group"
      ? { label: effectiveLabel, groupNames: selectedGroups, color, showIndividual }
      : { label: effectiveLabel, accountIds: selectedIds, color, showIndividual }
  );

  const tab = (id, text) => (
    <button onClick={() => setMode(id)} style={{
      flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
      background: mode === id ? "rgba(129,140,248,0.3)" : "transparent",
      color: mode === id ? "#c7d2fe" : "rgba(255,255,255,0.5)",
    }}>{text}</button>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass-strong" style={{ width: 420, maxWidth: "90vw", padding: 28, borderRadius: 20, maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ margin: "0 0 20px", fontSize: 17, fontWeight: 700 }}>Configure Account Group</h3>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, marginBottom: 6 }}>Widget Label</div>
          <input className="glass-input" value={effectiveLabel} onChange={e => { setLabel(e.target.value); setLabelTouched(true); }}
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

        {/* Choose accounts by group (dynamic) or one by one */}
        <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 10, background: "rgba(255,255,255,0.05)", marginBottom: 14 }}>
          {tab("group", "By group")}
          {tab("account", "By account")}
        </div>

        {mode === "group" ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, marginBottom: 8 }}>
              Groups ({selectedGroups.length} selected — pick one or more)
            </div>
            {groupNames.length === 0 ? (
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "10px 0", lineHeight: 1.5 }}>
                No groups yet. Give your accounts a group on the Accounts page (in Edit), then pick them here.
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {groupNames.map(g => {
                  const active = selectedGroups.includes(g);
                  const groupTotal = accounts.filter(a => (a.groupName || "") === g).reduce((s, a) => s + Number(a.balance), 0);
                  return (
                    <button key={g} onClick={() => toggleGroup(g)} style={{
                      padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13,
                      border: `1px solid ${active ? "rgba(129,140,248,0.6)" : "rgba(255,255,255,0.12)"}`,
                      background: active ? "rgba(129,140,248,0.25)" : "rgba(255,255,255,0.04)",
                      color: active ? "#c7d2fe" : "rgba(255,255,255,0.6)",
                    }}>
                      {g} <span style={{ opacity: 0.6, marginLeft: 4 }}>{fmt(groupTotal)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
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
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, cursor: "pointer" }}>
          <input type="checkbox" checked={showIndividual} onChange={e => setShowIndividual(e.target.checked)} />
          <span style={{ fontSize: 13 }}>Show individual account balances</span>
        </label>

        <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "12px 16px", marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>Combined total ({selected.length} accounts)</span>
          <span style={{ fontSize: 20, fontWeight: 700, color }}>{fmt(total)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="glass-btn glass-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="glass-btn glass-btn-primary" onClick={save}>Save widget</button>
        </div>
      </div>
    </div>
  );
}

// Investment value over time, right on the dashboard — pick an account and range.
// Uses the same /holdings/history endpoint as the Holdings modal, so it works for
// ticker-priced accounts and manually-valued (fund/pension) ones alike.
function InvestmentsWidgetContent({ overview }) {
  const navigate = useNavigate();
  const invAccounts = (overview?.accounts || []).filter(a => a.type === "INVESTMENT");
  const [sel, setSel] = useState("");
  const [range, setRange] = useState("6mo");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!sel && invAccounts.length) setSel(invAccounts[0].id); }, [invAccounts, sel]);
  useEffect(() => {
    if (!sel) return;
    let live = true; setLoading(true);
    holdingsApi.history(sel, range)
      .then(r => { if (live) { setData(r); setLoading(false); } })
      .catch(() => { if (live) { setData(null); setLoading(false); } });
    return () => { live = false; };
  }, [sel, range]);

  const totalValue = invAccounts.reduce((s, a) => s + Number(a.balance), 0);
  const series = data?.series || [];
  const cur = data?.currency || invAccounts.find(a => a.id === sel)?.currency || "EUR";
  const money = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

  if (invAccounts.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Investments</div>
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No investment accounts yet.</div>
      </div>
    );
  }

  return (
    <div>
      <div onClick={() => navigate("/accounts")} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 12, cursor: "pointer" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Investments</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#34d399" }}>{fmt(totalValue)}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <select className="glass-input" style={{ padding: "5px 10px", fontSize: 12, flex: "1 1 140px" }} value={sel} onChange={e => setSel(e.target.value)}>
          {invAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, overflow: "hidden" }}>
          {[["1mo", "1M"], ["6mo", "6M"], ["1y", "1Y"], ["max", "Max"]].map(([v, l]) => (
            <button key={v} onClick={() => setRange(v)} style={{ padding: "5px 10px", fontSize: 12, border: "none", cursor: "pointer", background: range === v ? "rgba(99,102,241,0.3)" : "transparent", color: range === v ? "#c7d2fe" : "rgba(255,255,255,0.45)" }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{ height: 160 }}>
        {loading ? <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, textAlign: "center", padding: "50px 0" }}>Loading…</div>
          : series.length < 2 ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center", padding: "50px 0" }}>Not enough history yet — it fills in over time.</div>
          : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs><linearGradient id="invFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.35} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="date" tickFormatter={d => new Date(d).toLocaleDateString("nl-NL", { month: "short" })} tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} width={46} tickFormatter={v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} domain={["auto", "auto"]} />
                <Tooltip formatter={v => money(v)} labelFormatter={l => new Date(l).toLocaleDateString("nl-NL")} contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} fill="url(#invFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
      </div>
    </div>
  );
}

function LoansWidgetContent() {
  const navigate = useNavigate();
  const [sum, setSum] = useState(null);
  useEffect(() => { loansApi.summary().then(setSum).catch(() => {}); }, []);
  return (
    <div onClick={() => navigate("/loans")} style={{ background: "rgba(251,191,36,0.1)", borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box", cursor: "pointer" }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 500 }}>Still owed to you</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: "#fbbf24" }}>{sum ? fmt(sum.totalOutstanding) : "—"}</div>
      {sum && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>{fmt(sum.totalRepaid)} back of {fmt(sum.totalLent)} · {sum.people} {sum.people === 1 ? "person" : "people"}</div>}
    </div>
  );
}

function UpcomingRecurringContent() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  useEffect(() => { recurringApi.list().then(r => setItems(r.filter(x => x.active))).catch(() => {}); }, []);
  const upcoming = [...items].sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate)).slice(0, 5);
  const perMonth = { DAILY: 30, WEEKLY: 4.33, BIWEEKLY: 2.17, MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12 };
  const monthlyTotal = items.reduce((s, r) => s + (r.type === "EXPENSE" ? Number(r.amount) * (perMonth[r.frequency] || 1) : 0), 0);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Upcoming Subscriptions</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>~{fmt(monthlyTotal)}/mo</div>
      </div>
      {upcoming.length === 0
        ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>No active subscriptions</div>
        : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {upcoming.map(r => (
              <div key={r.id} onClick={() => navigate("/recurring")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.description}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{r.frequency.toLowerCase()} · next {new Date(r.nextDate).toLocaleDateString("nl-NL")}</div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: r.type === "INCOME" ? "#34d399" : "#f87171" }}>{r.type === "INCOME" ? "+" : "-"}{fmt(Number(r.amount))}</div>
              </div>
            ))}
            <button onClick={() => navigate("/recurring")} style={{ background: "none", border: "none", color: "rgba(129,140,248,0.8)", fontSize: 13, cursor: "pointer", textAlign: "left", padding: "6px 0 0" }}>Manage →</button>
          </div>
        )}
    </div>
  );
}

function SavingsRateContent({ overview }) {
  const navigate = useNavigate();
  const income = overview?.totalIncome || 0;
  const expenses = overview?.totalExpenses || 0;
  const rate = income > 0 ? ((income - expenses) / income) * 100 : null;
  const good = rate != null && rate >= 0;
  return (
    <div onClick={() => navigate("/transactions")} style={{ background: "rgba(52,211,153,0.10)", borderRadius: 16, padding: "20px 22px", height: "100%", boxSizing: "border-box", cursor: "pointer" }}>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 500 }}>Savings Rate</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: rate == null ? "rgba(255,255,255,0.4)" : good ? "#34d399" : "#f87171" }}>
        {rate == null ? "—" : `${rate.toFixed(0)}%`}
      </div>
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8 }}>
        {rate == null ? "No income in range" : `${fmt(income - expenses)} kept of ${fmt(income)}`}
      </div>
    </div>
  );
}

function WidgetContent({ widget, overview, monthly }) {
  const { type } = widget;
  if (type === "savings-rate")       return <SavingsRateContent overview={overview} />;
  if (type.startsWith("stat-"))      return <StatWidgetContent type={type} overview={overview} />;
  if (type === "chart-monthly")      return <MonthlyChartContent monthly={monthly} />;
  if (type === "chart-categories")   return <CategoryChartContent overview={overview} />;
  if (type === "accounts")           return <AccountsWidgetContent overview={overview} />;
  if (type === "recent-tx")          return <RecentTxContent />;
  if (type === "goals")              return <GoalsWidgetContent />;
  if (type === "investments")        return <InvestmentsWidgetContent overview={overview} />;
  if (type === "loans")              return <LoansWidgetContent />;
  if (type === "recurring-upcoming") return <UpcomingRecurringContent />;
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
    <div className="dashboard-grid">
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
  const [range, setRange] = useRange();
  const { overview, monthly, loading } = useStatsData(range);
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
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>
            Your financial overview — {RANGES.find(r => r.id === range)?.label.toLowerCase()}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <RangeSelector value={range} onChange={setRange} />
          <button
            className={`glass-btn ${editMode ? "glass-btn-primary" : "glass-btn-ghost"}`}
            style={{ padding: "9px 18px" }}
            onClick={() => { setEditMode(e => !e); setShowAdd(false); }}
          >
            {editMode ? "✓ Done editing" : "✏ Customize"}
          </button>
        </div>
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
