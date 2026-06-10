import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  transactions as txApi,
  accounts as accountsApi,
  categories as catsApi,
  attachments as attachmentsApi,
} from "../api/client";
import GlassCard from "../components/GlassCard";
import Dialog from "../components/Dialog";
import { format } from "date-fns";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

const GRID = "1.2fr 1fr 0.9fr 92px 96px 130px";

const TXN_TYPES = [
  { id: "INCOME", label: "Income", color: "#34d399" },
  { id: "EXPENSE", label: "Expense", color: "#f87171" },
  { id: "TRANSFER", label: "Transfer", color: "#94a3b8" },
];

const fieldStyle = { padding: "10px 14px", width: "100%", boxSizing: "border-box", display: "block", marginTop: 6 };
const labelStyle = { fontSize: 12, color: "rgba(255,255,255,0.5)", fontWeight: 500, display: "block" };

export default function Transactions() {
  const [data, setData] = useState({ transactions: [], total: 0 });
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [modal, setModal] = useState(null); // null | { mode: 'add' } | { mode: 'edit', txn }
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    search: "",
    accountId: searchParams.get("accountId") || "",
    categoryId: "",
    type: "",
    page: 1,
  });

  const load = useCallback(() => {
    txApi.list({ ...filters, limit: 50 }).then(setData);
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    accountsApi.list().then(setAccounts);
    catsApi.list().then(setCategories);
  }, []);

  const allCategories = categories.flatMap((c) => [c, ...(c.children || [])]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Transactions</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>{data.total} transactions</p>
        </div>
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => setModal({ mode: "add" })}>
          + Add transaction
        </button>
      </div>

      <GlassCard style={{ padding: 0, overflow: "hidden" }}>
        {/* Filter bar */}
        <div style={{ display: "flex", gap: 12, padding: 16, borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
          <input
            className="glass-input"
            style={{ padding: "8px 12px", flex: "1 1 220px" }}
            placeholder="Search…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
          />
          <select className="glass-input" style={{ padding: "8px 12px", width: 160 }} value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value, page: 1 })}>
            <option value="">All types</option>
            <option value="INCOME">Income</option>
            <option value="EXPENSE">Expense</option>
            <option value="TRANSFER">Transfer</option>
          </select>
          <select className="glass-input" style={{ padding: "8px 12px", width: 180 }} value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value, page: 1 })}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select className="glass-input" style={{ padding: "8px 12px", width: 180 }} value={filters.categoryId} onChange={(e) => setFilters({ ...filters, categoryId: e.target.value, page: 1 })}>
            <option value="">All categories</option>
            {allCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Table head */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "12px 18px", fontSize: 11, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <span>Description</span><span>Account</span><span>Category</span><span>Type</span><span>Receipt</span>
          <span style={{ textAlign: "right" }}>Amount</span>
        </div>

        {/* Rows */}
        {data.transactions.map((t, i) => {
          const sign = t.type === "INCOME" ? "+" : t.type === "EXPENSE" ? "−" : "";
          const color = t.type === "INCOME" ? "#34d399" : t.type === "EXPENSE" ? "#f87171" : "#94a3b8";
          const files = t.attachments || [];
          return (
            <div
              key={t.id}
              onClick={() => setModal({ mode: "edit", txn: t })}
              style={{ display: "grid", gridTemplateColumns: GRID, gap: 12, padding: "14px 18px", alignItems: "center", borderTop: i > 0 ? "1px solid rgba(255,255,255,0.08)" : "none", fontSize: 13, cursor: "pointer", transition: "background 0.15s ease" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{fmtDate(t.date)}</div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.type === "TRANSFER" && t.toAccount
                  ? <span>{t.account?.name} <span style={{ color: "rgba(255,255,255,0.3)" }}>→</span> {t.toAccount.name}</span>
                  : t.account?.name}
              </div>
              <div>
                {t.category
                  ? <span style={{ background: `${t.category.color}22`, color: t.category.color, border: `1px solid ${t.category.color}44`, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 500 }}>{t.category.name}</span>
                  : <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>}
              </div>
              <div><span className={`badge badge-${t.type.toLowerCase()}`}>{t.type}</span></div>
              <div>
                {files.length > 0
                  ? <span title={`${files.length} attachment${files.length > 1 ? "s" : ""}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: "#c4b5fd" }}>📎 {files.length}</span>
                  : <span style={{ color: "rgba(255,255,255,0.25)" }}>—</span>}
              </div>
              <div className="ft-tabular" style={{ textAlign: "right", fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>{sign}{fmt(Number(t.amount))}</div>
            </div>
          );
        })}

        {data.transactions.length === 0 && (
          <div style={{ padding: "48px 0", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>No transactions yet</div>
        )}
      </GlassCard>

      {/* Pagination */}
      {data.total > 50 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px" }} disabled={filters.page === 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>← Prev</button>
          <span style={{ padding: "8px 16px", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>Page {filters.page}</span>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px" }} disabled={filters.page * 50 >= data.total} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next →</button>
        </div>
      )}

      {modal && (
        <TransactionModal
          mode={modal.mode}
          txn={modal.txn}
          accounts={accounts}
          categories={allCategories}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function TransactionModal({ mode, txn, accounts, categories, onClose, onSaved }) {
  const isEdit = mode === "edit";
  const [type, setType] = useState(txn?.type || "EXPENSE");
  const [desc, setDesc] = useState(txn?.description || "");
  const [amount, setAmount] = useState(txn ? String(txn.amount) : "");
  const [date, setDate] = useState(txn ? format(new Date(txn.date), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"));
  const [accountId, setAccountId] = useState(txn?.accountId || accounts[0]?.id || "");
  const [toAccountId, setToAccountId] = useState(txn?.toAccountId || "");
  const [categoryId, setCategoryId] = useState(txn?.categoryId || "");
  const [notes, setNotes] = useState(txn?.notes || "");

  // Attachments: existing (have serverId) + newly picked local File objects.
  const [items, setItems] = useState(() =>
    (txn?.attachments || []).map((a) => ({ key: a.id, serverId: a.id, name: a.filename, type: a.mimeType, size: a.size }))
  );
  const [removedIds, setRemovedIds] = useState([]);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const isTransfer = type === "TRANSFER";

  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    setItems((cur) => [
      ...cur,
      ...picked.map((f) => ({ key: "f" + Date.now() + Math.random().toString(36).slice(2, 6), file: f, name: f.name, type: f.type, size: f.size })),
    ]);
    e.target.value = "";
  };

  const removeItem = (item) => {
    if (item.serverId) setRemovedIds((r) => [...r, item.serverId]);
    setItems((cur) => cur.filter((it) => it.key !== item.key));
  };

  const save = async () => {
    if (!desc.trim()) { setErr("Add a description"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    if (!accountId) { setErr("Select an account"); return; }
    if (isTransfer && !toAccountId) { setErr("Select a destination account"); return; }
    if (isTransfer && toAccountId === accountId) { setErr("From and To accounts must be different"); return; }

    setErr("");
    setSaving(true);
    try {
      const payload = {
        accountId,
        toAccountId: isTransfer ? toAccountId : "",
        categoryId: isTransfer ? null : (categoryId || null),
        amount: amt,
        description: desc.trim(),
        date,
        type,
        notes,
      };
      const saved = isEdit ? await txApi.update(txn.id, payload) : await txApi.create(payload);

      if (removedIds.length) await Promise.all(removedIds.map((id) => attachmentsApi.remove(id)));
      const newFiles = items.filter((it) => it.file).map((it) => it.file);
      if (newFiles.length) await attachmentsApi.upload(saved.id, newFiles);

      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm("Delete this transaction?")) return;
    setSaving(true);
    try {
      await txApi.remove(txn.id);
      onSaved();
    } catch (e) {
      setErr(e.response?.data?.error || e.message || "Failed to delete");
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={isEdit ? "Edit transaction" : "Add transaction"} width={460}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Type selector */}
        <div style={{ display: "flex", gap: 8 }}>
          {TXN_TYPES.map((ty) => {
            const active = type === ty.id;
            return (
              <button
                key={ty.id}
                type="button"
                onClick={() => { setType(ty.id); setErr(""); }}
                style={{
                  flex: 1, padding: 9, borderRadius: 12, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: active ? `${ty.color}22` : "rgba(255,255,255,0.05)",
                  color: active ? ty.color : "rgba(255,255,255,0.5)",
                  border: `1px solid ${active ? "currentColor" : "rgba(255,255,255,0.08)"}`,
                  transition: "all 0.15s ease",
                }}
              >
                {ty.label}
              </button>
            );
          })}
        </div>

        <label style={labelStyle}>
          Description
          <input className="glass-input" style={fieldStyle} placeholder="What was this for?" value={desc} onChange={(e) => { setDesc(e.target.value); setErr(""); }} autoFocus />
        </label>

        <div style={{ display: "flex", gap: 12 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Amount (€)
            <input className="glass-input" style={fieldStyle} type="number" min="0" step="0.01" placeholder="0,00" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(""); }} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Date
            <input className="glass-input" style={fieldStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        {isTransfer ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 8, alignItems: "end" }}>
            <label style={labelStyle}>
              From account
              <select className="glass-input" style={fieldStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select…</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <div style={{ paddingBottom: 12, color: "rgba(255,255,255,0.3)", fontSize: 18, textAlign: "center" }}>→</div>
            <label style={labelStyle}>
              To account
              <select className="glass-input" style={fieldStyle} value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                <option value="">Select…</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          </div>
        ) : (
          <label style={labelStyle}>
            Account
            <select className="glass-input" style={fieldStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}

        {!isTransfer && (
          <label style={labelStyle}>
            Category
            <select className="glass-input" style={fieldStyle} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}

        <label style={labelStyle}>
          Notes <span style={{ color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>(optional)</span>
          <textarea className="glass-input" style={{ ...fieldStyle, resize: "vertical", minHeight: 56 }} placeholder="Any extra details…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        {/* Attachments */}
        <div>
          <span style={{ display: "block", fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Receipts &amp; invoices</span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {items.map((it) => (
              <AttachmentChip key={it.key} item={it} onView={() => setPreview(it)} onRemove={() => removeItem(it)} />
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Attach a receipt or invoice"
              style={{ width: 64, height: 64, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.35)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, fontSize: 20 }}
            >
              <span>＋</span><span style={{ fontSize: 9 }}>Add file</span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple onChange={onPick} style={{ display: "none" }} />
          <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "8px 0 0" }}>Attach photos of receipts or PDF invoices — image, PDF.</p>
        </div>

        {err && <div style={{ fontSize: 12, color: "#fca5a5" }}>{err}</div>}

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          {isEdit && (
            <button className="glass-btn glass-btn-danger" style={{ padding: "10px 18px" }} onClick={del} disabled={saving}>Delete</button>
          )}
          <button className="glass-btn glass-btn-ghost" style={{ flex: 1, padding: "10px 18px" }} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="glass-btn glass-btn-primary" style={{ flex: 1, padding: "10px 18px", opacity: saving ? 0.7 : 1 }} onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save"}
          </button>
        </div>
      </div>

      {preview && <AttachmentViewer item={preview} onClose={() => setPreview(null)} />}
    </Dialog>
  );
}

// Resolves a displayable object URL for an attachment item (local File or server-stored).
function useAttachmentUrl(item) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let active = true;
    let objectUrl = null;
    const apply = (blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };
    if (item.file) apply(item.file);
    else if (item.serverId) attachmentsApi.blob(item.serverId).then(apply).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [item.file, item.serverId]);
  return url;
}

function AttachmentChip({ item, onView, onRemove }) {
  const url = useAttachmentUrl(item);
  const isImg = item.type?.startsWith("image/");
  return (
    <div style={{ position: "relative", width: 64, height: 64 }}>
      <button
        type="button"
        onClick={onView}
        title={item.name}
        style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        {isImg && url
          ? <img src={url} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ fontSize: 22 }}>📄</span>}
      </button>
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        aria-label="Remove attachment"
        style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(10,10,26,0.92)", color: "#f87171", fontSize: 13, lineHeight: 1, cursor: "pointer" }}
      >
        ×
      </button>
    </div>
  );
}

function AttachmentViewer({ item, onClose }) {
  const url = useAttachmentUrl(item);
  const isImg = item.type?.startsWith("image/");
  const isPdf = item.type === "application/pdf";
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-strong"
        style={{ padding: 16, maxWidth: "80vw", maxHeight: "84vh", display: "flex", flexDirection: "column", gap: 12 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        {!url
          ? <div style={{ padding: 48, textAlign: "center", color: "rgba(255,255,255,0.5)" }}>Loading…</div>
          : isImg
            ? <img src={url} alt={item.name} style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 12 }} />
            : isPdf
              ? <iframe title={item.name} src={url} style={{ width: "70vw", height: "72vh", border: "none", borderRadius: 12, background: "#fff" }} />
              : <div style={{ padding: 48, textAlign: "center", color: "rgba(255,255,255,0.5)" }}>📄 Preview not available</div>}
      </div>
    </div>
  );
}
