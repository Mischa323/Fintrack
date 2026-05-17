import { useState, useEffect, useCallback } from "react";
import { transactions as txApi, accounts as accountsApi, categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import { format } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const emptyForm = { accountId: "", categoryId: "", amount: "", description: "", date: format(new Date(), "yyyy-MM-dd"), type: "EXPENSE", notes: "" };

export default function Transactions() {
  const [data, setData] = useState({ transactions: [], total: 0 });
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [filters, setFilters] = useState({ search: "", accountId: "", categoryId: "", type: "", page: 1 });

  const load = useCallback(() => {
    txApi.list({ ...filters, limit: 50 }).then(setData);
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    accountsApi.list().then(setAccounts);
    catsApi.list().then(setCategories);
  }, []);

  const open = (item = null) => {
    setEditing(item?.id || null);
    setForm(item ? {
      accountId: item.accountId,
      categoryId: item.categoryId || "",
      amount: item.amount,
      description: item.description,
      date: format(new Date(item.date), "yyyy-MM-dd"),
      type: item.type,
      notes: item.notes || "",
    } : { ...emptyForm, accountId: accounts[0]?.id || "" });
    setModal(true);
  };

  const save = async () => {
    const data = { ...form, amount: Number(form.amount), categoryId: form.categoryId || null };
    if (editing) await txApi.update(editing, data);
    else await txApi.create(data);
    setModal(false);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this transaction?")) return;
    await txApi.remove(id);
    load();
  };

  const allCategories = categories.flatMap((c) => [c, ...(c.children || [])]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Transactions</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>{data.total} transactions</p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>+ Add</button>
      </div>

      {/* Filters */}
      <GlassCard style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input className="glass-input" style={{ padding: "8px 12px", flex: "1 1 180px" }} placeholder="Search…" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })} />
          <select className="glass-input" style={{ padding: "8px 12px" }} value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value, page: 1 })}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="glass-input" style={{ padding: "8px 12px" }} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
            <option value="TRANSFER">Transfer</option>
          </select>
          <select className="glass-input" style={{ padding: "8px 12px" }} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value, page: 1 })}>
            <option value="">All categories</option>
            {allCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </GlassCard>

      {/* Table */}
      <GlassCard style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["Date", "Description", "Account", "Category", "Type", "Amount", ""].map((h) => (
                <th key={h} style={{ padding: "14px 16px", textAlign: h === "Amount" ? "right" : "left", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.transactions.map((t) => (
              <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>{format(new Date(t.date), "dd MMM yyyy")}</td>
                <td style={{ padding: "12px 16px", fontSize: 14, fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</td>
                <td style={{ padding: "12px 16px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{t.account?.name}</td>
                <td style={{ padding: "12px 16px" }}>
                  {t.category && (
                    <span style={{ background: `${t.category.color}22`, color: t.category.color, border: `1px solid ${t.category.color}44`, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
                      {t.category.name}
                    </span>
                  )}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span className={`badge badge-${t.type.toLowerCase()}`}>{t.type}</span>
                </td>
                <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, fontSize: 15 }} className={t.type === "INCOME" ? "amount-income" : t.type === "EXPENSE" ? "amount-expense" : "amount-neutral"}>
                  {t.type === "EXPENSE" ? "-" : "+"}{fmt(Number(t.amount))}
                </td>
                <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                  <button className="glass-btn glass-btn-ghost" style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }} onClick={() => open(t)}>Edit</button>
                  <button className="glass-btn glass-btn-danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => remove(t.id)}>Del</button>
                </td>
              </tr>
            ))}
            {data.transactions.length === 0 && (
              <tr><td colSpan={7} style={{ padding: "60px 16px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>No transactions found</td></tr>
            )}
          </tbody>
        </table>
      </GlassCard>

      {/* Pagination */}
      {data.total > 50 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px" }} disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>← Prev</button>
          <span style={{ padding: "8px 16px", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Page {filters.page}</span>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px" }} disabled={filters.page * 50 >= data.total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next →</button>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 480, padding: 32, maxWidth: "95vw" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>{editing ? "Edit" : "Add"} Transaction</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input className="glass-input" style={{ padding: "10px 14px" }} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input className="glass-input" style={{ padding: "10px 14px" }} type="number" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <input className="glass-input" style={{ padding: "10px 14px" }} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="EXPENSE">Expense</option>
                <option value="INCOME">Income</option>
                <option value="TRANSFER">Transfer</option>
              </select>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">Select account…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select className="glass-input" style={{ padding: "10px 14px" }} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">No category</option>
                {allCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <textarea className="glass-input" style={{ padding: "10px 14px", resize: "vertical", minHeight: 60 }} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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
