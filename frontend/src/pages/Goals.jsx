import { useState, useEffect } from "react";
import { goals as goalsApi, accounts as accountsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import { format, differenceInMonths, isPast, isFuture } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6", "#f97316", "#06b6d4"];

const emptyForm = {
  name: "", description: "", targetAmount: "", savedAmount: "",
  accountId: "", targetDate: "", color: "#6366f1",
};

const fieldStyle = { padding: "10px 14px", width: "100%", boxSizing: "border-box", display: "block", marginTop: 6 };
const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, display: "block" };

function monthsRemaining(targetDate) {
  if (!targetDate) return null;
  const now = new Date();
  const target = new Date(targetDate);
  return differenceInMonths(target, now);
}

function monthlyNeeded(goal) {
  const months = monthsRemaining(goal.targetDate);
  if (months === null) return null;
  if (months <= 0) return null;
  const remaining = Math.max(0, Number(goal.targetAmount) - Number(goal.savedAmount));
  if (remaining === 0) return 0;
  return remaining / months;
}

function GoalCard({ goal, onEdit, onDelete }) {
  const target = Number(goal.targetAmount);
  const saved = Number(goal.savedAmount);
  const pct = target > 0 ? Math.min(100, (saved / target) * 100) : 0;
  const reached = saved >= target;
  const monthly = monthlyNeeded(goal);
  const months = monthsRemaining(goal.targetDate);
  const overdue = goal.targetDate && isPast(new Date(goal.targetDate)) && !reached;

  return (
    <GlassCard style={{ borderLeft: `4px solid ${goal.color}`, display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.name}</div>
          {goal.description && (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{goal.description}</div>
          )}
        </div>
        {reached && (
          <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 700, background: "rgba(52,211,153,0.2)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
            Reached!
          </span>
        )}
        {overdue && (
          <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 700, background: "rgba(248,113,113,0.2)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
            Overdue
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div style={{ margin: "14px 0 6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          <span>{fmt(saved)} saved</span>
          <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{pct.toFixed(0)}%</span>
          <span>goal: {fmt(target)}</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 99,
            background: reached
              ? `linear-gradient(90deg, ${goal.color}, #34d399)`
              : `linear-gradient(90deg, ${goal.color}cc, ${goal.color})`,
            transition: "width 0.6s ease",
          }} />
        </div>
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 8 }}>
        {goal.account && (
          <span>🏦 {goal.account.name}</span>
        )}
        {goal.targetDate && (
          <span style={{ color: overdue ? "#f87171" : "rgba(255,255,255,0.45)" }}>
            📅 {format(new Date(goal.targetDate), "MMM yyyy")}
            {months !== null && months > 0 && ` · ${months} month${months === 1 ? "" : "s"} left`}
          </span>
        )}
      </div>

      {/* Monthly savings needed */}
      {!reached && (
        <div style={{
          marginTop: 14,
          padding: "11px 16px",
          borderRadius: 10,
          background: monthly !== null
            ? `rgba(${goal.color === "#6366f1" ? "99,102,241" : goal.color === "#8b5cf6" ? "139,92,246" : "99,102,241"}, 0.12)`
            : "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          {monthly !== null && monthly > 0 ? (
            <>
              <span style={{ fontSize: 22, fontWeight: 800, color: goal.color }}>{fmt(monthly)}</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>per month to reach your goal</span>
            </>
          ) : monthly === 0 ? (
            <span style={{ fontSize: 13, color: "#34d399" }}>Goal reached! Nothing more needed.</span>
          ) : overdue ? (
            <span style={{ fontSize: 13, color: "#f87171" }}>Target date has passed — update your deadline.</span>
          ) : (
            <>
              <span style={{ fontSize: 22, fontWeight: 800, color: goal.color }}>{fmt(target - saved)}</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>remaining — set a target date to calculate monthly savings</span>
            </>
          )}
        </div>
      )}

      {reached && (
        <div style={{ marginTop: 14, padding: "11px 16px", borderRadius: 10, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", fontSize: 13, color: "#34d399", fontWeight: 600 }}>
          You've reached your savings goal!
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => onEdit(goal)}>Edit</button>
        <button className="glass-btn glass-btn-danger" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => onDelete(goal.id)}>Delete</button>
      </div>
    </GlassCard>
  );
}

export default function Goals() {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => goalsApi.list().then(setItems);

  useEffect(() => {
    load();
    accountsApi.list().then(setAccounts);
  }, []);

  const open = (item = null) => {
    setEditing(item?.id || null);
    setError("");
    setForm(item ? {
      name: item.name,
      description: item.description || "",
      targetAmount: item.targetAmount,
      savedAmount: item.savedAmount,
      accountId: item.accountId || "",
      targetDate: item.targetDate ? format(new Date(item.targetDate), "yyyy-MM-dd") : "",
      color: item.color,
    } : emptyForm);
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Goal name is required"); return; }
    if (!form.targetAmount || Number(form.targetAmount) <= 0) { setError("Enter a valid target amount"); return; }
    setError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        targetAmount: Number(form.targetAmount),
        savedAmount: Number(form.savedAmount) || 0,
        accountId: form.accountId || null,
        targetDate: form.targetDate || null,
      };
      if (editing) await goalsApi.update(editing, payload);
      else await goalsApi.create(payload);
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this savings goal?")) return;
    await goalsApi.remove(id);
    load();
  };

  // Summary numbers
  const totalTarget = items.reduce((s, g) => s + Number(g.targetAmount), 0);
  const totalSaved = items.reduce((s, g) => s + Number(g.savedAmount), 0);
  const totalMonthly = items.reduce((s, g) => {
    const m = monthlyNeeded(g);
    return s + (m || 0);
  }, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Savings Goals</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>
            {items.length} goal{items.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>
          + Add Goal
        </button>
      </div>

      {/* Summary cards */}
      {items.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 16 }}>
          {[
            { label: "Total target", value: fmt(totalTarget), color: "#818cf8" },
            { label: "Total saved", value: fmt(totalSaved), color: "#34d399" },
            { label: "Overall progress", value: `${totalTarget > 0 ? ((totalSaved / totalTarget) * 100).toFixed(0) : 0}%`, color: "#a78bfa" },
            { label: "Monthly needed", value: fmt(totalMonthly), color: "#f59e0b" },
          ].map((s) => (
            <GlassCard key={s.label} style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 500, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Goal cards */}
      {items.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))", gap: 16 }}>
          {items.map((g) => (
            <GoalCard key={g.id} goal={g} onEdit={open} onDelete={remove} />
          ))}
        </div>
      ) : (
        <GlassCard style={{ padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No savings goals yet</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>
            Set a goal — a holiday, new car, emergency fund — and track your progress.
          </div>
          <button className="glass-btn glass-btn-primary" style={{ padding: "10px 24px" }} onClick={() => open()}>
            Add your first goal
          </button>
        </GlassCard>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 500, padding: "32px 36px", maxWidth: "95vw", borderRadius: 20, maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>{editing ? "Edit" : "Add"} Savings Goal</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={labelStyle}>
                Goal name
                <input className="glass-input" style={fieldStyle} placeholder="e.g. Holiday in Japan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </label>

              <label style={labelStyle}>
                Description <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <input className="glass-input" style={fieldStyle} placeholder="What are you saving for?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Target amount
                  <input className="glass-input" style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={form.targetAmount} onChange={(e) => setForm({ ...form, targetAmount: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  Already saved
                  <input className="glass-input" style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={form.savedAmount} onChange={(e) => setForm({ ...form, savedAmount: e.target.value })} />
                </label>
              </div>

              <label style={labelStyle}>
                Target date <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional — enables monthly calculation)</span>
                <input className="glass-input" style={fieldStyle} type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} />
              </label>

              <label style={labelStyle}>
                Linked account <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <select className="glass-input" style={fieldStyle} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                  <option value="">No specific account</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>

              {/* Live monthly preview */}
              {form.targetAmount && form.targetDate && (() => {
                const preview = {
                  targetAmount: form.targetAmount,
                  savedAmount: form.savedAmount || 0,
                  targetDate: form.targetDate,
                };
                const m = monthlyNeeded(preview);
                const months = monthsRemaining(form.targetDate);
                if (m === null || months <= 0) return (
                  <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", fontSize: 13, color: "#f87171" }}>
                    Target date is in the past — choose a future date.
                  </div>
                );
                return (
                  <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>Monthly savings needed</div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 26, fontWeight: 800, color: form.color }}>{fmt(m)}</span>
                      <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>/ month for {months} month{months === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                );
              })()}

              <div>
                <div style={{ ...labelStyle, marginBottom: 10 }}>Colour</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {COLORS.map((c) => (
                    <div key={c} onClick={() => setForm({ ...form, color: c })} style={{
                      width: 28, height: 28, borderRadius: 8, background: c, cursor: "pointer",
                      outline: form.color === c ? "2px solid white" : "2px solid transparent",
                      outlineOffset: 2, transition: "outline 0.15s",
                    }} />
                  ))}
                </div>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 22px" }} onClick={() => setModal(false)}>Cancel</button>
              <button className="glass-btn glass-btn-primary" style={{ padding: "10px 22px", opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save goal"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
