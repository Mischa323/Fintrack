import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { transactions as txApi, accounts as accountsApi, categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";
import { format } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

const emptyForm = {
  accountId: "", toAccountId: "", categoryId: "",
  amount: "", description: "",
  date: format(new Date(), "yyyy-MM-dd"),
  type: "EXPENSE", notes: "",
};

const fieldStyle = { padding: "10px 14px", width: "100%", boxSizing: "border-box", display: "block" };
const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, display: "block", marginBottom: 16 };

export default function Transactions() {
  const [data, setData] = useState({ transactions: [], total: 0 });
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({ search: "", accountId: searchParams.get("accountId") || "", categoryId: "", type: "", page: 1 });

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
    setSaveError("");
    setForm(item ? {
      accountId: item.accountId,
      toAccountId: item.toAccountId || "",
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
    if (!form.description.trim()) { setSaveError("Description is required"); return; }
    if (!form.amount || Number(form.amount) <= 0) { setSaveError("Enter a valid amount"); return; }
    if (!form.accountId) { setSaveError("Select an account"); return; }
    if (form.type === "TRANSFER" && !form.toAccountId) { setSaveError("Select a destination account"); return; }
    if (form.type === "TRANSFER" && form.toAccountId === form.accountId) { setSaveError("From and To accounts must be different"); return; }

    setSaveError("");
    setSaving(true);
    try {
      const payload = { ...form, amount: Number(form.amount), categoryId: form.categoryId || null };
      if (editing) await txApi.update(editing, payload);
      else await txApi.create(payload);
      setModal(false);
      load();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!confirm("Delete this transaction?")) return;
    await txApi.remove(id);
    load();
  };

  const allCategories = categories.flatMap((c) => [c, ...(c.children || [])]);
  const isTransfer = form.type === "TRANSFER";

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
                <td style={{ padding: "12px 16px", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
                  {t.type === "TRANSFER" && t.toAccount
                    ? <span>{t.account?.name} <span style={{ color: "rgba(255,255,255,0.3)" }}>→</span> {t.toAccount.name}</span>
                    : t.account?.name}
                </td>
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
                  {t.type === "EXPENSE" ? "-" : t.type === "INCOME" ? "+" : ""}{fmt(Number(t.amount))}
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
          <div className="glass-strong" style={{ width: 480, padding: "32px 36px", maxWidth: "95vw", borderRadius: 20 }}>
            <h2 style={{ margin: "0 0 24px", fontSize: 18, fontWeight: 700 }}>{editing ? "Edit" : "Add"} Transaction</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Type selector */}
              <div style={{ display: "flex", gap: 8 }}>
                {["EXPENSE", "INCOME", "TRANSFER"].map((t) => (
                  <button key={t} onClick={() => setForm({ ...form, type: t, toAccountId: "" })}
                    style={{
                      flex: 1, padding: "9px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
                      background: form.type === t
                        ? t === "INCOME" ? "rgba(52,211,153,0.25)" : t === "EXPENSE" ? "rgba(248,113,113,0.25)" : "rgba(148,163,184,0.25)"
                        : "rgba(255,255,255,0.05)",
                      color: form.type === t
                        ? t === "INCOME" ? "#34d399" : t === "EXPENSE" ? "#f87171" : "#94a3b8"
                        : "rgba(255,255,255,0.4)",
                      outline: form.type === t ? "1px solid currentColor" : "1px solid transparent",
                    }}>
                    {t === "EXPENSE" ? "Expense" : t === "INCOME" ? "Income" : "Transfer"}
                  </button>
                ))}
              </div>

              <label style={labelStyle}>
                Description
                <input className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} placeholder="What was this for?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoFocus />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={labelStyle}>
                  Amount
                  <input className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </label>
                <label style={labelStyle}>
                  Date
                  <input className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
              </div>

              {isTransfer ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "end" }}>
                  <label style={labelStyle}>
                    From account
                    <select className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                      <option value="">Select…</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <div style={{ paddingBottom: 12, color: "rgba(255,255,255,0.3)", fontSize: 18, textAlign: "center" }}>→</div>
                  <label style={labelStyle}>
                    To account
                    <select className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} value={form.toAccountId} onChange={(e) => setForm({ ...form, toAccountId: e.target.value })}>
                      <option value="">Select…</option>
                      {accounts.filter((a) => a.id !== form.accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                </div>
              ) : (
                <label style={labelStyle}>
                  Account
                  <select className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                    <option value="">Select account…</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
              )}

              {!isTransfer && (
                <label style={labelStyle}>
                  Category
                  <select className="glass-input" style={{ ...fieldStyle, marginTop: 6 }} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">No category</option>
                    {allCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              )}

              <label style={labelStyle}>
                Notes <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
                <textarea className="glass-input" style={{ ...fieldStyle, marginTop: 6, resize: "vertical", minHeight: 56 }} placeholder="Any extra details…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </label>
            </div>

            {saveError && (
              <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#fca5a5", fontSize: 13 }}>
                {saveError}
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
