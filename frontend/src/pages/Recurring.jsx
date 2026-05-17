import { useState, useEffect } from "react";
import { recurring as recurringApi, accounts as accountsApi, categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import { format } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
const FREQS = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];

const emptyForm = {
  accountId: "", categoryId: "", amount: "", description: "", type: "EXPENSE",
  frequency: "MONTHLY", startDate: format(new Date(), "yyyy-MM-dd"), endDate: "", active: true,
};

export default function Recurring() {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const load = () => recurringApi.list().then(setItems);

  useEffect(() => {
    load();
    accountsApi.list().then(setAccounts);
    catsApi.list().then((cats) => setCategories(cats.flatMap((c) => [c, ...(c.children || [])])));
  }, []);

  const open = (item = null) => {
    setEditing(item?.id || null);
    setForm(item ? {
      accountId: item.accountId,
      categoryId: item.categoryId || "",
      amount: item.amount,
      description: item.description,
      type: item.type,
      frequency: item.frequency,
      startDate: format(new Date(item.startDate), "yyyy-MM-dd"),
      endDate: item.endDate ? format(new Date(item.endDate), "yyyy-MM-dd") : "",
      active: item.active,
    } : { ...emptyForm, accountId: accounts[0]?.id || "" });
    setModal(true);
  };

  const save = async () => {
    const data = { ...form, amount: Number(form.amount), categoryId: form.categoryId || null, endDate: form.endDate || null };
    if (editing) await recurringApi.update(editing, data);
    else await recurringApi.create(data);
    setModal(false);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this recurring transaction?")) return;
    await recurringApi.remove(id);
    load();
  };

  const toggleActive = async (item) => {
    await recurringApi.update(item.id, { active: !item.active });
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Recurring</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Subscriptions, salaries, bills</p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>+ Add Recurring</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((r) => (
          <GlassCard key={r.id} style={{ opacity: r.active ? 1 : 0.5 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: r.type === "INCOME" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
                }}>
                  {r.type === "INCOME" ? "↑" : "↓"}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{r.description}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    {r.account?.name} · {r.frequency} · Next: {format(new Date(r.nextDate), "dd MMM yyyy")}
                    {r.category && ` · ${r.category.name}`}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }} className={r.type === "INCOME" ? "amount-income" : "amount-expense"}>
                  {r.type === "EXPENSE" ? "-" : "+"}{fmt(Number(r.amount))}
                </div>
                <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => toggleActive(r)}>
                  {r.active ? "Pause" : "Resume"}
                </button>
                <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => open(r)}>Edit</button>
                <button className="glass-btn glass-btn-danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => remove(r.id)}>Del</button>
              </div>
            </div>
          </GlassCard>
        ))}
        {items.length === 0 && (
          <div style={{ color: "rgba(255,255,255,0.3)", padding: "60px 0", textAlign: "center" }}>
            No recurring transactions. Add your subscriptions and bills.
          </div>
        )}
      </div>

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 480, padding: 32, maxWidth: "95vw" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>{editing ? "Edit" : "Add"} Recurring Transaction</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input className="glass-input" style={{ padding: "10px 14px" }} placeholder="Description (e.g. Netflix, Rent)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input className="glass-input" style={{ padding: "10px 14px" }} type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <select className="glass-input" style={{ padding: "10px 14px" }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="EXPENSE">Expense</option>
                  <option value="INCOME">Income</option>
                </select>
              </div>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>Start date</div>
                  <input className="glass-input" style={{ padding: "10px 14px", width: "100%", boxSizing: "border-box" }} type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>End date (optional)</div>
                  <input className="glass-input" style={{ padding: "10px 14px", width: "100%", boxSizing: "border-box" }} type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
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
