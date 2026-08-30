import { useState, useEffect } from "react";
import { loans as loansApi, accounts as accountsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import { format, isPast } from "date-fns";

const COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6", "#f97316", "#06b6d4"];

const money = (n, cur) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: cur || "EUR" }).format(Number(n) || 0);

const emptyForm = {
  person: "", description: "", principal: "", currency: "EUR",
  date: format(new Date(), "yyyy-MM-dd"), dueDate: "", notes: "", color: "#6366f1",
  accountId: "",
};

const fieldStyle = { padding: "10px 14px", width: "100%", boxSizing: "border-box", display: "block", marginTop: 6 };
const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, display: "block" };

// ── Repayment history for one loan ───────────────────────────────────────────
function LoanPaymentsModal({ loan, onClose, onChanged }) {
  const [cur, setCur] = useState(loan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    amount: "", date: format(new Date(), "yyyy-MM-dd"), notes: "",
  });

  const payments = cur.payments || [];

  const add = async (e) => {
    e.preventDefault();
    if (!form.amount || Number(form.amount) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await loansApi.addPayment(loan.id, {
        amount: Number(form.amount),
        date: form.date,
        notes: form.notes || undefined,
      });
      setCur(updated);
      setForm((f) => ({ ...f, amount: "", notes: "" }));
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Remove this repayment of ${money(p.amount, cur.currency)}?`)) return;
    try {
      const updated = await loansApi.removePayment(loan.id, p.id);
      setCur(updated);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  // Suggest the remaining balance, so "paid it all back" is one tap.
  const fillRest = () => {
    if (cur.outstanding > 0) setForm((f) => ({ ...f, amount: String(cur.outstanding) }));
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 560, maxWidth: "95vw", maxHeight: "90vh", padding: 28, display: "flex", flexDirection: "column" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{cur.person} — repayments</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            {money(cur.repaid, cur.currency)} back of {money(cur.principal, cur.currency)}
            {cur.settled
              ? <span style={{ color: "#34d399" }}> · paid off{cur.overpaid ? " (overpaid)" : ""}</span>
              : <span> · <strong style={{ color: "#fbbf24" }}>{money(cur.outstanding, cur.currency)}</strong> still owed</span>}
          </p>
          {cur.account && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#818cf8" }}>
              🏦 Repayments are also added as income to {cur.account.name}.
            </p>
          )}
        </div>

        {/* Record a repayment */}
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "0 1 120px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Amount
            <input className="glass-input" type="number" step="any" min="0" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }}
              value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          </label>
          <label style={{ flex: "0 1 140px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Date
            <input className="glass-input" type="date" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }}
              value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </label>
          <label style={{ flex: "1 1 140px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Note <span style={{ color: "rgba(255,255,255,0.3)" }}>(optional)</span>
            <input className="glass-input" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }} placeholder="e.g. via Tikkie"
              value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </label>
          <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 16px", opacity: (busy || !form.amount) ? 0.5 : 1 }} disabled={busy || !form.amount}>
            Record
          </button>
        </form>
        {!cur.settled && (
          <button type="button" onClick={fillRest} style={{ marginTop: 8, alignSelf: "flex-start", background: "none", border: "none", color: "#818cf8", cursor: "pointer", fontSize: 12, padding: 0 }}>
            Fill in the remaining {money(cur.outstanding, cur.currency)}
          </button>
        )}
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#f87171" }}>{error}</div>}

        {/* History */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "auto", marginTop: 18, minHeight: 100 }}>
          {payments.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              No repayments yet. Record the first one above.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Date", "Amount", "Note", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: i === 1 ? "right" : "left", color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "9px 10px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                      {format(new Date(p.date), "dd MMM yyyy")}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 600, color: "#34d399" }}>
                      {money(p.amount, cur.currency)}
                    </td>
                    <td style={{ padding: "9px 10px", color: "rgba(255,255,255,0.5)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.notes || "—"}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      <button className="glass-btn glass-btn-danger" style={{ padding: "3px 9px", fontSize: 12 }} onClick={() => remove(p)}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 18px" }} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── One loan ─────────────────────────────────────────────────────────────────
function LoanCard({ loan, onEdit, onDelete, onArchive, onRecord }) {
  const principal = Number(loan.principal);
  const pct = loan.progress;
  const overdue = loan.dueDate && isPast(new Date(loan.dueDate)) && !loan.settled;

  return (
    <GlassCard style={{ borderLeft: `4px solid ${loan.color}`, display: "flex", flexDirection: "column", opacity: loan.archived ? 0.6 : 1 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loan.person}</div>
          {loan.description && (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loan.description}</div>
          )}
        </div>
        {loan.settled ? (
          <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 700, background: "rgba(52,211,153,0.2)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
            Paid off
          </span>
        ) : overdue ? (
          <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 700, background: "rgba(248,113,113,0.2)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)", padding: "2px 8px", borderRadius: 999, whiteSpace: "nowrap" }}>
            Overdue
          </span>
        ) : null}
      </div>

      {/* Progress bar */}
      <div style={{ margin: "14px 0 6px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          <span>{money(loan.repaid, loan.currency)} back</span>
          <span style={{ fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>{pct.toFixed(0)}%</span>
          <span>lent: {money(principal, loan.currency)}</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: 99,
            background: loan.settled
              ? `linear-gradient(90deg, ${loan.color}, #34d399)`
              : `linear-gradient(90deg, ${loan.color}cc, ${loan.color})`,
            transition: "width 0.6s ease",
          }} />
        </div>
      </div>

      {/* Outstanding / meta */}
      <div style={{
        marginTop: 12, padding: "11px 16px", borderRadius: 10,
        background: loan.settled ? "rgba(52,211,153,0.1)" : "rgba(251,191,36,0.1)",
        border: `1px solid ${loan.settled ? "rgba(52,211,153,0.2)" : "rgba(251,191,36,0.2)"}`,
        display: "flex", alignItems: "baseline", gap: 10,
      }}>
        {loan.settled ? (
          <span style={{ fontSize: 13, color: "#34d399", fontWeight: 600 }}>
            Fully repaid{loan.overpaid ? ` — ${money(-loan.outstanding, loan.currency)} over` : ""}.
          </span>
        ) : (
          <>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#fbbf24" }}>{money(loan.outstanding, loan.currency)}</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>still owed</span>
          </>
        )}
      </div>

      {/* Dates */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 10 }}>
        <span>📤 lent {format(new Date(loan.date), "dd MMM yyyy")}</span>
        {loan.dueDate && (
          <span style={{ color: overdue ? "#f87171" : "rgba(255,255,255,0.45)" }}>
            📅 due {format(new Date(loan.dueDate), "dd MMM yyyy")}
          </span>
        )}
        {loan.account && <span style={{ color: "#818cf8" }}>🏦 {loan.account.name}</span>}
      </div>

      {loan.notes && (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 8, fontStyle: "italic" }}>{loan.notes}</div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {!loan.archived && (
          <button className="glass-btn glass-btn-primary" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => onRecord(loan)}>
            Record repayment
          </button>
        )}
        <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => onEdit(loan)}>Edit</button>
        <button
          className="glass-btn glass-btn-ghost"
          style={{ padding: "6px 14px", fontSize: 13 }}
          onClick={() => onArchive(loan)}
          title={loan.archived ? "Bring this loan back to the active list" : "File this loan away (keeps its history)"}
        >
          {loan.archived ? "Unarchive" : "Archive"}
        </button>
        <button className="glass-btn glass-btn-danger" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => onDelete(loan.id)}>Delete</button>
      </div>
    </GlassCard>
  );
}

export default function Loans() {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [payingFor, setPayingFor] = useState(null);

  const load = () => {
    loansApi.list(showArchived).then(setItems);
    loansApi.summary().then(setSummary);
  };

  useEffect(() => { load(); }, [showArchived]);
  useEffect(() => { accountsApi.list().then(setAccounts); }, []);

  // An investment account's balance is derived from its holdings, so a loan
  // cannot be booked on it — the backend rejects it and the picker hides it.
  const linkableAccounts = accounts.filter((a) => a.type !== "INVESTMENT");

  const open = (item = null) => {
    setEditing(item?.id || null);
    setError("");
    setForm(item ? {
      person: item.person,
      description: item.description || "",
      principal: item.principal,
      currency: item.currency || "EUR",
      date: item.date ? format(new Date(item.date), "yyyy-MM-dd") : "",
      dueDate: item.dueDate ? format(new Date(item.dueDate), "yyyy-MM-dd") : "",
      notes: item.notes || "",
      color: item.color,
      accountId: item.accountId || "",
    } : emptyForm);
    setModal(true);
  };

  const save = async () => {
    if (!form.person.trim()) { setError("Who did you lend to?"); return; }
    if (!form.principal || Number(form.principal) <= 0) { setError("Enter the amount you lent"); return; }
    setError("");
    setSaving(true);
    try {
      const payload = {
        ...form,
        principal: Number(form.principal),
        dueDate: form.dueDate || null,
        accountId: form.accountId || null,
      };
      if (editing) await loansApi.update(editing, payload);
      else await loansApi.create(payload);
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this loan and its whole repayment history? This cannot be undone.")) return;
    await loansApi.remove(id);
    load();
  };

  const archive = async (loan) => {
    await loansApi.archive(loan.id, !loan.archived);
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Money Lent</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>
            Track what you lent to people and how much has come back
          </p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>
          + New loan
        </button>
      </div>

      {/* Summary cards */}
      {summary && summary.loanCount > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 16 }}>
          {[
            { label: "Total lent out", value: money(summary.totalLent), color: "#818cf8" },
            { label: "Paid back", value: money(summary.totalRepaid), color: "#34d399" },
            { label: "Still outstanding", value: money(summary.totalOutstanding), color: "#fbbf24" },
            { label: "People", value: String(summary.people), color: "#a78bfa" },
          ].map((s) => (
            <GlassCard key={s.label} style={{ padding: "16px 20px" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", fontWeight: 500, marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Show settled toggle */}
      {(items.length > 0 || showArchived) && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.5)", cursor: "pointer", alignSelf: "flex-start" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} style={{ cursor: "pointer" }} />
          Show archived loans
        </label>
      )}

      {/* Loan cards */}
      {items.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px,1fr))", gap: 16 }}>
          {items.map((l) => (
            <LoanCard key={l.id} loan={l} onEdit={open} onDelete={remove} onArchive={archive} onRecord={setPayingFor} />
          ))}
        </div>
      ) : (
        <GlassCard style={{ padding: "60px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🤝</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>No loans tracked yet</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.4)", marginBottom: 20 }}>
            Lent money to a friend or family member? Add it here and log repayments as they come in.
          </div>
          <button className="glass-btn glass-btn-primary" style={{ padding: "10px 24px" }} onClick={() => open()}>
            Add your first loan
          </button>
        </GlassCard>
      )}

      {/* Repayments modal */}
      {payingFor && (
        <LoanPaymentsModal loan={payingFor} onClose={() => setPayingFor(null)} onChanged={load} />
      )}

      {/* Add / edit modal */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 500, padding: "32px 36px", maxWidth: "95vw", borderRadius: 20, maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>{editing ? "Edit" : "New"} loan</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={labelStyle}>
                Person
                <input className="glass-input" style={fieldStyle} placeholder="e.g. Jan de Vries" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} autoFocus />
              </label>

              <label style={labelStyle}>
                What was it for? <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <input className="glass-input" style={fieldStyle} placeholder="e.g. car repair" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Amount lent
                  <input className="glass-input" style={fieldStyle} type="number" min="0" step="0.01" placeholder="0.00" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  Currency
                  <input className="glass-input" style={fieldStyle} maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Date lent
                  <input className="glass-input" style={fieldStyle} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  Due back <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                  <input className="glass-input" style={fieldStyle} type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                </label>
              </div>

              <label style={labelStyle}>
                Linked account <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <select className="glass-input" style={fieldStyle} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                  <option value="">Don't touch any balance — just track it</option>
                  {linkableAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 6, lineHeight: 1.5 }}>
                  Pick an account and the amount lent is booked as an expense on it and every
                  repayment as income, so its balance stays in step. A full repayment nets back
                  to zero. Leave empty to keep this purely for tracking.
                  {form.accountId && editing && (
                    <span style={{ display: "block", color: "#fbbf24", marginTop: 4 }}>
                      Changing this re-books the loan and its repayments on the chosen account.
                    </span>
                  )}
                </div>
              </label>

              <label style={labelStyle}>
                Notes <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <input className="glass-input" style={fieldStyle} placeholder="Any extra details…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>

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
                {saving ? "Saving…" : "Save loan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
