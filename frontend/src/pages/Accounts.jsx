import { useState, useEffect } from "react";
import { accounts as accountsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const TYPES = ["CHECKING", "SAVINGS", "CREDIT_CARD", "INVESTMENT", "CASH", "OTHER"];
const COLORS = ["#6366f1", "#8b5cf6", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#ef4444", "#14b8a6"];
const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const emptyForm = { name: "", type: "CHECKING", currency: "EUR", balance: "", color: "#6366f1", institution: "" };

export default function Accounts() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const load = () => accountsApi.list().then(setItems);
  useEffect(() => { load(); }, []);

  const open = (item = null) => {
    setEditing(item?.id || null);
    setForm(item ? { name: item.name, type: item.type, currency: item.currency, balance: item.balance, color: item.color, institution: item.institution || "" } : emptyForm);
    setModal(true);
  };

  const save = async () => {
    const data = { ...form, balance: Number(form.balance) || 0 };
    if (editing) await accountsApi.update(editing, data);
    else await accountsApi.create(data);
    setModal(false);
    load();
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
                  {a.type} · {a.currency}
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: Number(a.balance) >= 0 ? "#34d399" : "#f87171" }}>
                  {fmt(Number(a.balance))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
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
          <div className="glass-strong" style={{ width: 440, padding: 32, maxWidth: "95vw" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>{editing ? "Edit" : "Add"} Account</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input className="glass-input" style={{ padding: "10px 14px", width: "100%", boxSizing: "border-box" }} placeholder="Account name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input className="glass-input" style={{ padding: "10px 14px" }} placeholder="Currency (EUR)" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
                <input className="glass-input" style={{ padding: "10px 14px" }} type="number" placeholder="Initial balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
              </div>
              <input className="glass-input" style={{ padding: "10px 14px" }} placeholder="Institution (optional)" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} />
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Card color</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {COLORS.map((c) => (
                    <div key={c} onClick={() => setForm({ ...form, color: c })} style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent", transition: "border 0.15s" }} />
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={() => setModal(false)}>Cancel</button>
              <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={save}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
