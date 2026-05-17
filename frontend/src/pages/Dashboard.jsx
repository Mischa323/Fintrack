import { useState, useEffect } from "react";
import { stats } from "../api/client";
import GlassCard from "../components/GlassCard";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass" style={{ padding: "10px 14px", fontSize: 13 }}>
      <div style={{ color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {fmt(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([stats.overview(), stats.monthly()])
      .then(([o, m]) => { setOverview(o); setMonthly(m); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: "rgba(255,255,255,0.4)", padding: 40 }}>Loading…</div>;

  const statCards = [
    { label: "Total Balance", value: fmt(overview?.totalBalance || 0), color: "#818cf8", bg: "rgba(99,102,241,0.15)" },
    { label: "Income (all time)", value: fmt(overview?.totalIncome || 0), color: "#34d399", bg: "rgba(52,211,153,0.1)" },
    { label: "Expenses (all time)", value: fmt(overview?.totalExpenses || 0), color: "#f87171", bg: "rgba(248,113,113,0.1)" },
    { label: "Net Flow", value: fmt((overview?.totalIncome || 0) - (overview?.totalExpenses || 0)), color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Dashboard</h1>
        <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Your financial overview</p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
        {statCards.map((s) => (
          <GlassCard key={s.label} style={{ background: s.bg }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8, fontWeight: 500 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
          </GlassCard>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Monthly income vs expenses */}
        <GlassCard>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Income vs Expenses</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly} barGap={4}>
              <XAxis dataKey="month" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${(v/1000).toFixed(0)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="income" name="Income" fill="#34d399" radius={[6, 6, 0, 0]} opacity={0.85} />
              <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[6, 6, 0, 0]} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </GlassCard>

        {/* Spending by category */}
        <GlassCard>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Spending by Category</div>
          {overview?.spendingByCategory?.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={overview.spendingByCategory}
                  dataKey="amount"
                  nameKey="category.name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={3}
                >
                  {overview.spendingByCategory.map((entry, i) => (
                    <Cell key={i} fill={entry.category?.color || "#6b7280"} opacity={0.85} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
                <Legend formatter={(v, { payload }) => payload?.payload?.category?.name || v} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "60px 0", fontSize: 13 }}>
              No spending data yet
            </div>
          )}
        </GlassCard>
      </div>

      {/* Account balances */}
      {overview?.accounts?.length > 0 && (
        <GlassCard>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Account Balances</div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {overview.accounts.map((a) => (
              <div key={a.id} className="glass" style={{
                padding: "12px 20px",
                borderLeft: `3px solid ${a.color}`,
                minWidth: 160,
              }}>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>{a.name}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: Number(a.balance) >= 0 ? "#34d399" : "#f87171" }}>
                  {fmt(Number(a.balance))}
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>{a.type}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
