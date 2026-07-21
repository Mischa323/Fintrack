import { useState, useEffect, useRef } from "react";
import { receipts as receiptsApi, accounts as accountsApi, categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const fmt = (n) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");

const STATUS = {
  PENDING: { label: "Needs review", color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  MATCHED: { label: "Linked", color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  CREATED: { label: "Transaction created", color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  UNMATCHED: { label: "No match", color: "rgba(255,255,255,0.4)", bg: "rgba(255,255,255,0.05)" },
};

// ── Review one receipt: link it, or record the transaction it proves ─────────
function ReviewModal({ receipt, matches: initialMatches, accounts, categories, onClose, onDone }) {
  const [matches, setMatches] = useState(initialMatches || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [imageUrl, setImageUrl] = useState(null);

  // The object URL is revoked on close so the blob is not held for the session
  useEffect(() => {
    let url = null;
    receiptsApi.image(receipt.id).then((u) => { url = u; setImageUrl(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [receipt.id]);
  const [form, setForm] = useState({
    accountId: accounts[0]?.id || "",
    categoryId: "",
    description: receipt.merchant || "",
    amount: receipt.amount != null ? String(receipt.amount) : "",
    date: receipt.date ? new Date(receipt.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    type: receipt.kind === "PAYSLIP" ? "INCOME" : "EXPENSE",
  });

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setBusy(false);
    }
  };

  const link = (m) => run(() => receiptsApi.link(receipt.id, m.id));
  const dismiss = () => run(() => receiptsApi.dismiss(receipt.id));
  const create = () => run(() => receiptsApi.createTransaction(receipt.id, {
    accountId: form.accountId,
    categoryId: form.categoryId || undefined,
    description: form.description,
    amount: Number(form.amount),
    date: form.date,
    type: form.type,
  }));

  const rematch = async () => {
    setBusy(true);
    try {
      const r = await receiptsApi.rematch(receipt.id);
      setMatches(r.matches);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 860, maxWidth: "96vw", maxHeight: "92vh", padding: 26, display: "flex", gap: 22 }}>
        {/* The image, so a misread value can be checked against the document */}
        <div style={{ flex: "0 0 300px", display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>{receipt.filename}</div>
          <div style={{ flex: 1, overflow: "auto", borderRadius: 10, background: "rgba(0,0,0,0.25)", padding: 8 }}>
            {imageUrl
              ? <img src={imageUrl} alt={receipt.filename} style={{ width: "100%", borderRadius: 6, display: "block" }} />
              : <div style={{ padding: "40px 0", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading image…</div>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{receipt.merchant || "Unrecognised document"}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            Read from the image: {receipt.amount != null ? fmt(Number(receipt.amount)) : "no amount"} · {fmtDate(receipt.date)}
            {receipt.kind && receipt.kind !== "UNKNOWN" && ` · ${receipt.kind.toLowerCase()}`}
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            Check these against the image before linking — a vision model can misread a smudged digit.
          </p>

          {error && <div style={{ marginTop: 12, fontSize: 13, color: "#f87171" }}>{error}</div>}

          <div style={{ flex: 1, overflowY: "auto", marginTop: 16 }}>
            {!creating && (
              <>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8 }}>
                  {matches.length > 0
                    ? `${matches.length} possible transaction${matches.length === 1 ? "" : "s"}`
                    : "No transaction found for this document"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {matches.map((m) => (
                    <div key={m.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      padding: "10px 13px", borderRadius: 10, fontSize: 13,
                      background: m.confident ? "rgba(52,211,153,0.1)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${m.confident ? "rgba(52,211,153,0.3)" : "transparent"}`,
                    }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {m.description}
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.45)" }}>
                          {fmt(m.amount)} · {fmtDate(m.date)} · {m.account?.name}
                          {m.confident && <span style={{ color: "#6ee7b7" }}> · strong match</span>}
                        </div>
                      </div>
                      <button className="glass-btn glass-btn-primary" style={{ padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap", opacity: busy ? 0.5 : 1 }} onClick={() => link(m)} disabled={busy}>
                        Link
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {creating && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
                  Record this document as a new transaction. Correct anything the model misread.
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Account
                    <select className="glass-input" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Category
                    <select className="glass-input" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                      <option value="">— none —</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", gridColumn: "1 / -1" }}>
                    Description
                    <input className="glass-input" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Amount
                    <input className="glass-input" type="number" step="0.01" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Date
                    <input className="glass-input" type="date" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                  </label>
                  <label style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                    Type
                    <select className="glass-input" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                      <option value="EXPENSE">Expense</option>
                      <option value="INCOME">Income</option>
                    </select>
                  </label>
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap" }}>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 16px" }} onClick={onClose}>Close</button>
            {!creating ? (
              <>
                <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 16px" }} onClick={rematch} disabled={busy}>
                  ↻ Look again
                </button>
                <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 16px", marginLeft: "auto" }} onClick={dismiss} disabled={busy}>
                  No match
                </button>
                <button className="glass-btn glass-btn-primary" style={{ padding: "9px 16px" }} onClick={() => setCreating(true)} disabled={busy}>
                  Create transaction
                </button>
              </>
            ) : (
              <>
                <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 16px", marginLeft: "auto" }} onClick={() => setCreating(false)}>Back</button>
                <button className="glass-btn glass-btn-primary" style={{ padding: "9px 16px", opacity: (busy || !form.accountId || !form.amount) ? 0.5 : 1 }} onClick={create} disabled={busy || !form.accountId || !form.amount}>
                  {busy ? "Saving…" : "Save transaction"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Receipts() {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [linking, setLinking] = useState(false);
  const [msg, setMsg] = useState(null);
  const [review, setReview] = useState(null);
  const fileRef = useRef();

  const load = () => receiptsApi.list().then(setItems);
  const pendingCount = items.filter((r) => r.status === "PENDING").length;
  useEffect(() => {
    load();
    accountsApi.list().then(setAccounts);
    catsApi.list().then((c) => setCategories(c.flatMap((x) => [x, ...(x.children || [])])));
  }, []);

  const upload = async (files) => {
    if (!files?.length) return;
    setUploading(true);
    setMsg(null);

    // One at a time: the model reads a single document per request. A failure on
    // one file must not lose the rest, so each is caught and reported at the end.
    let last = null;
    let done = 0;
    const failed = [];
    for (const [index, file] of files.entries()) {
      setProgress({ current: index + 1, total: files.length, name: file.name });
      try {
        last = await receiptsApi.upload(file);
        done++;
      } catch (e) {
        failed.push(`${file.name}: ${e.response?.data?.error || e.message}`);
      }
    }

    setProgress(null);
    setUploading(false);
    await load();

    if (done === 0) {
      setMsg({ error: true, text: failed[0] || "Nothing could be read" });
      return;
    }
    setMsg({
      text: `Read ${done} of ${files.length} document${files.length === 1 ? "" : "s"}`
        + (failed.length ? ` — ${failed.length} failed: ${failed[0]}` : ""),
      error: failed.length > 0 && done === 0,
    });
    // A single upload goes straight to review; a batch is reviewed from the list
    if (files.length === 1 && last) setReview({ receipt: last.receipt, matches: last.matches });
  };

  // Links everything whose best candidate is unambiguous and leaves the rest
  const autoLink = async () => {
    setLinking(true);
    setMsg(null);
    try {
      const r = await receiptsApi.autoLink();
      await load();
      setMsg({
        text: r.linked > 0
          ? `Linked ${r.linked} document${r.linked === 1 ? "" : "s"}`
            + (r.needsReview ? `, ${r.needsReview} still need${r.needsReview === 1 ? "s" : ""} review` : "")
          : `Nothing was linked — ${r.needsReview} document${r.needsReview === 1 ? "" : "s"} need review`,
      });
    } catch (e) {
      setMsg({ error: true, text: e.response?.data?.error || e.message });
    } finally {
      setLinking(false);
    }
  };

  const remove = async (r) => {
    if (!confirm(`Delete ${r.filename}? The linked transaction stays.`)) return;
    await receiptsApi.remove(r.id);
    load();
  };

  const openReview = async (r) => {
    const res = await receiptsApi.rematch(r.id);
    setReview({ receipt: r, matches: res.matches });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Receipts</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>
            Upload receipts, invoices or payslips and they are matched to the transactions they belong to
          </p>
        </div>
        {pendingCount > 0 && (
          <button
            className="glass-btn glass-btn-primary"
            style={{ padding: "10px 18px", opacity: linking ? 0.5 : 1 }}
            onClick={autoLink}
            disabled={linking}
            title="Link every document whose match is unambiguous; the rest stay for review"
          >
            {linking ? "Linking…" : `✓ Link ${pendingCount} strong match${pendingCount === 1 ? "" : "es"}`}
          </button>
        )}
      </div>

      {review && (
        <ReviewModal
          receipt={review.receipt}
          matches={review.matches}
          accounts={accounts}
          categories={categories}
          onClose={() => setReview(null)}
          onDone={() => { setReview(null); load(); }}
        />
      )}

      <GlassCard style={{ padding: 22 }}>
        <div
          onClick={() => fileRef.current.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); upload([...e.dataTransfer.files]); }}
          style={{
            border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 14,
            padding: "28px 20px", textAlign: "center", cursor: uploading ? "default" : "pointer",
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>🧾</div>
          <div style={{ fontWeight: 500 }}>
            {uploading
              ? (progress ? `Reading ${progress.current} of ${progress.total}: ${progress.name}` : "Reading…")
              : "Drop receipts, invoices or payslips here"}
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 4 }}>
            {uploading
              ? "PDFs take a second or two; photos up to a minute on a local model"
              : "or click to browse — images and PDFs, several at once"}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple style={{ display: "none" }} onChange={(e) => upload([...e.target.files])} />

        {msg && (
          <div style={{ marginTop: 14, fontSize: 13, color: msg.error ? "#f87171" : "#34d399" }}>
            {msg.error ? "" : "✓ "}{msg.text}
          </div>
        )}
      </GlassCard>

      <GlassCard style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              {["Document", "Date", "Amount", "Status", "Linked to", ""].map((h) => (
                <th key={h} style={{ padding: "14px 16px", textAlign: h === "Amount" ? "right" : "left", fontSize: 12, color: "rgba(255,255,255,0.4)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const status = STATUS[r.status] || STATUS.PENDING;
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <td style={{ padding: "12px 16px", fontSize: 14 }}>
                    <div style={{ fontWeight: 500 }}>{r.merchant || r.filename}</div>
                    {r.rawText && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{r.rawText.slice(0, 60)}</div>}
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "rgba(255,255,255,0.5)", whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 600, fontSize: 14 }}>
                    {r.amount != null ? fmt(Number(r.amount)) : "—"}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999, background: status.bg, color: status.color, whiteSpace: "nowrap" }}>
                      {status.label}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "rgba(255,255,255,0.5)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.transaction ? r.transaction.description : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="glass-btn glass-btn-ghost" style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }} onClick={() => openReview(r)}>
                      Review
                    </button>
                    <button className="glass-btn glass-btn-danger" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => remove(r)}>×</button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "60px 16px", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
                No receipts yet
              </td></tr>
            )}
          </tbody>
        </table>
      </GlassCard>
    </div>
  );
}
