import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { accounts as accountsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const TYPES = [
  { value: "CHECKING", label: "Checking" },
  { value: "SAVINGS", label: "Savings" },
  { value: "CREDIT_CARD", label: "Credit Card" },
  { value: "INVESTMENT", label: "Investment" },
  { value: "CASH", label: "Cash" },
  { value: "OTHER", label: "Other" },
];
const COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6"];
const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const emptyForm = { name: "", type: "CHECKING", currency: "EUR", balance: "", color: "#6366f1", institution: "", iban: "" };

const fieldStyle = { padding: "10px 14px", width: "100%", boxSizing: "border-box", display: "block", marginTop: 6 };
const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, display: "block" };

export default function Accounts() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => accountsApi.list().then(setItems);
  useEffect(() => { load(); }, []);

  const open = (item = null) => {
    setEditing(item?.id || null);
    setError("");
    setForm(item ? { name: item.name, type: item.type, currency: item.currency, balance: item.balance, color: item.color, institution: item.institution || "", iban: item.iban || "" } : emptyForm);
    setModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Account name is required"); return; }
    setError("");
    setSaving(true);
    try {
      const data = { ...form, balance: Number(form.balance) || 0 };
      if (editing) await accountsApi.update(editing, data);
      else await accountsApi.create(data);
      setModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || err.message || "Failed to save account");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this account and all its transactions?")) return;
    await accountsApi.remove(id);
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Accounts</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>{items.length} bank accounts tracked</p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>+ Add Account</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
        {items.map((a) => (
          <GlassCard key={a.id} style={{ borderLeft: `4px solid ${a.color}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{a.name}</div>
                {a.institution && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{a.institution}</div>}
                <span style={{ fontSize: 11, background: "rgba(255,255,255,0.08)", padding: "2px 8px", borderRadius: 6, marginTop: 6, display: "inline-block", color: "rgba(255,255,255,0.5)" }}>
                  {TYPES.find(t => t.value === a.type)?.label ?? a.type} · {a.currency}
                </span>
                {a.iban && (
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4, fontFamily: "monospace", letterSpacing: "0.05em" }}>
                    {a.iban.replace(/\s/g, "").slice(0, -4).replace(/./g, "•").replace(/(.{4})/g, "$1 ").trim() + " " + a.iban.replace(/\s/g, "").slice(-4)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: Number(a.balance) >= 0 ? "#34d399" : "#f87171" }}>
                  {fmt(Number(a.balance))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => navigate(`/transactions?accountId=${a.id}`)}>Transactions</button>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => open(a)}>Edit</button>
              <button className="glass-btn glass-btn-danger" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => remove(a.id)}>Delete</button>
            </div>
          </GlassCard>
        ))}
        {items.length === 0 && (
          <div style={{ color: "rgba(255,255,255,0.3)", gridColumn: "1/-1", padding: "60px 0", textAlign: "center" }}>
            No accounts yet. Add your first bank account to get started.
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 460, padding: "32px 36px", maxWidth: "95vw", borderRadius: 20 }}>
            <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>{editing ? "Edit" : "Add"} Account</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={labelStyle}>
                Account name
                <input className="glass-input" style={fieldStyle} placeholder="e.g. Main Checking" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </label>

              <label style={labelStyle}>
                Account type
                <select className="glass-input" style={fieldStyle} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Currency
                  <input className="glass-input" style={fieldStyle} placeholder="EUR" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
                </label>
                <label style={labelStyle}>
                  {editing ? "Balance" : "Initial balance"}
                  <input className="glass-input" style={fieldStyle} type="number" step="0.01" placeholder="0.00" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
                </label>
              </div>

              <label style={labelStyle}>
                Institution <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <input className="glass-input" style={fieldStyle} placeholder="e.g. ING Bank" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
              </label>

              <label style={labelStyle}>
                IBAN <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <input
                  className="glass-input"
                  style={{ ...fieldStyle, letterSpacing: "0.05em", fontFamily: "monospace" }}
                  placeholder="e.g. NL91 ABNA 0417 1643 00"
                  value={form.iban}
                  onChange={(e) => setForm({ ...form, iban: e.target.value.toUpperCase() })}
                  maxLength={34}
                />
              </label>

              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 10 }}>Card colour</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {COLORS.map((c) => (
                    <div key={c} onClick={() => setForm({ ...form, color: c })} style={{
                      width: 30, height: 30, borderRadius: 8, background: c, cursor: "pointer",
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
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 22px" }} onClick={() => setModal(false)}>Cancel</button>
              <button className="glass-btn glass-btn-primary" style={{ padding: "10px 22px", opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
