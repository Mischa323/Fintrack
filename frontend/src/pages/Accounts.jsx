import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { accounts as accountsApi , holdings as holdingsApi } from "../api/client";
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

// ── Buy / sell history for one holding ───────────────────────────────────────
function HoldingTradesModal({ holding, onClose, onChanged }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({
    kind: "BUY",
    quantity: "",
    price: "",
    date: new Date().toISOString().slice(0, 10),
  });

  const money = (n, cur) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: cur || "EUR" }).format(n);

  const load = () =>
    holdingsApi.trades(holding.id).then((t) => { setTrades(t); setLoading(false); });
  useEffect(() => { load(); }, [holding.id]);

  const add = async (e) => {
    e.preventDefault();
    if (!form.quantity || Number(form.quantity) <= 0) return;
    setBusy(true);
    setError(null);
    try {
      await holdingsApi.addTrade(holding.id, {
        kind: form.kind,
        quantity: Number(form.quantity),
        price: form.price === "" ? undefined : Number(form.price),
        date: form.date,
      });
      setForm((f) => ({ ...f, quantity: "", price: "" }));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t) => {
    if (t.opening) {
      alert("The opening position can't be removed on its own — delete the holding to start over.");
      return;
    }
    if (!confirm(`Remove this ${t.kind.toLowerCase()} of ${Number(t.quantity)} ${holding.symbol}?`)) return;
    await holdingsApi.removeTrade(holding.id, t.id);
    await load();
    onChanged?.();
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 560, maxWidth: "95vw", maxHeight: "90vh", padding: 28, display: "flex", flexDirection: "column" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{holding.symbol} — buys & sells</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            {Number(holding.quantity)} held
            {holding.avgCost != null && ` · avg cost ${money(Number(holding.avgCost), holding.currency)}`}
          </p>
        </div>

        {/* Record a trade */}
        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", borderRadius: 9, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
            {["BUY", "SELL"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm((f) => ({ ...f, kind: k }))}
                style={{
                  padding: "9px 14px", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer",
                  background: form.kind === k ? (k === "BUY" ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)") : "transparent",
                  color: form.kind === k ? (k === "BUY" ? "#6ee7b7" : "#fca5a5") : "rgba(255,255,255,0.5)",
                }}
              >
                {k === "BUY" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <label style={{ flex: "0 1 90px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Quantity
            <input className="glass-input" type="number" step="any" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }}
              value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
          </label>
          <label style={{ flex: "0 1 110px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Price / share
            <input className="glass-input" type="number" step="any" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }}
              placeholder="optional" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          </label>
          <label style={{ flex: "0 1 130px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Date
            <input className="glass-input" type="date" style={{ padding: "9px 11px", width: "100%", marginTop: 4 }}
              value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </label>
          <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 16px", opacity: (busy || !form.quantity) ? 0.5 : 1 }} disabled={busy || !form.quantity}>
            Record
          </button>
        </form>
        {error && <div style={{ marginTop: 10, fontSize: 13, color: "#f87171" }}>{error}</div>}

        {/* History */}
        <div style={{ flex: 1, overflowY: "auto", marginTop: 18, minHeight: 100 }}>
          {loading ? (
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>Loading…</div>
          ) : trades.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              No trades recorded yet. Record a buy or sell above.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Date", "", "Qty", "Price", ""].map((h, i) => (
                    <th key={i} style={{ padding: "8px 10px", textAlign: i >= 2 && i <= 3 ? "right" : "left", color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "9px 10px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap" }}>
                      {new Date(t.date).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "9px 10px" }}>
                      {t.opening ? (
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>Opening</span>
                      ) : (
                        <span style={{ color: t.kind === "BUY" ? "#34d399" : "#f87171", fontWeight: 600 }}>
                          {t.kind === "BUY" ? "Buy" : "Sell"}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>{Number(t.quantity)}</td>
                    <td style={{ padding: "9px 10px", textAlign: "right", color: "rgba(255,255,255,0.6)" }}>
                      {t.price == null ? "—" : money(Number(t.price), holding.currency)}
                    </td>
                    <td style={{ padding: "9px 10px", textAlign: "right" }}>
                      {!t.opening && (
                        <button className="glass-btn glass-btn-danger" style={{ padding: "3px 9px", fontSize: 12 }} onClick={() => remove(t)}>×</button>
                      )}
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

// ── Investment holdings ──────────────────────────────────────────────────────
// No broker offers an API for personal accounts, so quantities are entered or
// imported once. Only the prices refresh automatically.
function HoldingsModal({ account, onClose, onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState({ symbol: "", quantity: "", avgCost: "" });
  const fileRef = useRef();
  const tradesRef = useRef();
  const [tradesFor, setTradesFor] = useState(null);

  const money = (n, cur) =>
    new Intl.NumberFormat("nl-NL", { style: "currency", currency: cur || "EUR" }).format(n);

  const load = async () => {
    const data = await holdingsApi.list(account.id);
    setRows(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [account.id]);

  const done = (text) => { setMsg({ text }); load(); onChanged?.(); };

  const add = async (e) => {
    e.preventDefault();
    if (!form.symbol.trim() || !form.quantity) return;
    setBusy(true);
    setMsg(null);
    try {
      await holdingsApi.create({
        accountId: account.id,
        symbol: form.symbol.trim(),
        quantity: Number(form.quantity),
        avgCost: form.avgCost === "" ? undefined : Number(form.avgCost),
      });
      setForm({ symbol: "", quantity: "", avgCost: "" });
      done("Position added");
    } catch (err) {
      setMsg({ error: true, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await holdingsApi.refresh(account.id);
      done(`Prices updated for ${r.updated} position${r.updated === 1 ? "" : "s"}`
        + (r.failed ? ` — ${r.failed} failed: ${r.errors[0]}` : ""));
    } catch (err) {
      setMsg({ error: true, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await holdingsApi.importRevolut(account.id, file);
      done(`${r.imported} position${r.imported === 1 ? "" : "s"} imported from ${r.buys} buys and ${r.sells} sells`
        + (r.errors?.length ? ` — ${r.errors[0]}` : ""));
    } catch (err) {
      setMsg({ error: true, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const importTrades = async (file) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await holdingsApi.importTrades(file);
      done(
        `${r.imported} position${r.imported === 1 ? "" : "s"} imported across `
        + `${r.accounts} account${r.accounts === 1 ? "" : "s"}`
        + (r.note ? ` — ${r.note}` : "")
      );
    } catch (err) {
      setMsg({ error: true, text: err.response?.data?.error || err.message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (h) => {
    if (!confirm(`Remove ${h.symbol} from this account?`)) return;
    await holdingsApi.remove(h.id);
    done("Position removed");
  };

  const total = rows.reduce(
    (sum, h) => sum + (h.lastPrice ? Number(h.quantity) * Number(h.lastPrice) : 0), 0
  );
  const mixedCurrencies = new Set(rows.map((h) => h.currency)).size > 1;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 720, maxWidth: "95vw", maxHeight: "90vh", padding: 28, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{account.name} — holdings</h2>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
              Quantities are yours to set; prices refresh automatically each weekday morning.
            </p>
          </div>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "7px 14px", fontSize: 13 }} onClick={refresh} disabled={busy}>
            {busy ? "Working…" : "↻ Refresh prices"}
          </button>
        </div>

        {msg && (
          <div style={{ marginTop: 14, fontSize: 13, color: msg.error ? "#f87171" : "#34d399" }}>
            {msg.error ? "" : "✓ "}{msg.text}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", marginTop: 16, minHeight: 100 }}>
          {loading ? (
            <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, padding: "24px 0", textAlign: "center" }}>
              No positions yet. Add one below, or import a Revolut statement.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Symbol", "Qty", "Price", "Value", "Gain", ""].map((h) => (
                    <th key={h} style={{ padding: "8px 10px", textAlign: h === "Symbol" ? "left" : "right", color: "rgba(255,255,255,0.4)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => {
                  const price = h.lastPrice == null ? null : Number(h.lastPrice);
                  const value = price == null ? null : Number(h.quantity) * price;
                  const cost = h.avgCost == null ? null : Number(h.quantity) * Number(h.avgCost);
                  const gain = value != null && cost != null ? value - cost : null;
                  const pct = gain != null && cost > 0 ? (gain / cost) * 100 : null;
                  return (
                    <tr key={h.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "9px 10px" }}>
                        <div style={{ fontWeight: 600 }}>{h.symbol}</div>
                        {h.name && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{h.name}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>{Number(h.quantity)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right" }}>
                        {price == null
                          ? <span style={{ color: "#fbbf24" }}>no price</span>
                          : money(price, h.currency)}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 600 }}>
                        {value == null ? "—" : money(value, h.currency)}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", color: gain == null ? "rgba(255,255,255,0.3)" : gain >= 0 ? "#34d399" : "#f87171" }}>
                        {gain == null ? "—" : `${gain >= 0 ? "+" : ""}${money(gain, h.currency)}${pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}`}
                      </td>
                      <td style={{ padding: "9px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="glass-btn glass-btn-ghost" style={{ padding: "3px 9px", fontSize: 12, marginRight: 5 }} onClick={() => setTradesFor(h)} title="Buy, sell and history">⇄</button>
                        <button className="glass-btn glass-btn-danger" style={{ padding: "3px 9px", fontSize: 12 }} onClick={() => remove(h)}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
            {mixedCurrencies
              ? `Positions are held in different currencies; the account balance converts them all to ${account.currency}.`
              : `Total ${money(total, rows[0]?.currency)} — the account balance shows this in ${account.currency}.`}
          </div>
        )}

        <form onSubmit={add} style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ flex: "1 1 130px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Symbol
            <input className="glass-input" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} placeholder="AAPL or ASML.AS"
              value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          </label>
          <label style={{ flex: "0 1 100px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Quantity
            <input className="glass-input" type="number" step="any" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} placeholder="10"
              value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </label>
          <label style={{ flex: "0 1 130px", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            Avg cost / share
            <input className="glass-input" type="number" step="any" style={{ padding: "9px 12px", width: "100%", marginTop: 4 }} placeholder="optional"
              value={form.avgCost} onChange={(e) => setForm({ ...form, avgCost: e.target.value })} />
          </label>
          <button type="submit" className="glass-btn glass-btn-primary" style={{ padding: "9px 18px" }} disabled={busy || !form.symbol.trim() || !form.quantity}>
            Add
          </button>
        </form>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 6 }}>
          European tickers need their exchange suffix — ASML.AS, SHELL.AS, MC.PA.
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            Have many positions? Import the Stocks statement from the Revolut app.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => tradesRef.current.click()} disabled={busy}>
              Import trades.csv
            </button>
            <button className="glass-btn glass-btn-ghost" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => fileRef.current.click()} disabled={busy}>
              Revolut CSV
            </button>
            <button className="glass-btn" style={{ padding: "8px 16px", fontSize: 13 }} onClick={onClose}>Close</button>
          </div>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => importCsv(e.target.files[0])} />
          <input ref={tradesRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => importTrades(e.target.files[0])} />
        </div>
      </div>
    </div>
  );
}

export default function Accounts() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [holdingsFor, setHoldingsFor] = useState(null);
  const [recalculating, setRecalculating] = useState(null);
  const [recalcMsg, setRecalcMsg] = useState(null);

  const load = () => accountsApi.list().then(setItems);

  // Imported history never starts at zero, so summing transactions alone says
  // nothing about the real balance. Entering what the bank shows derives the
  // opening balance that makes the recorded movements add up to it.
  const reconcile = async (account) => {
    const entered = window.prompt(
      `What does the bank actually show for "${account.name}"?\n\n`
        + "FinTrack works out the starting balance from this, so future imports stay correct.",
      Number(account.balance).toFixed(2)
    );
    if (entered === null) return;
    const value = Number(String(entered).replace(",", "."));
    if (isNaN(value)) { setRecalcMsg(`"${entered}" is not a number`); return; }

    setRecalculating(account.id);
    setRecalcMsg(null);
    try {
      const r = await accountsApi.reconcile(account.id, value);
      setRecalcMsg(
        `${account.name}: set to ${r.balance.toFixed(2)} — `
          + `${r.movements.toFixed(2)} from recorded transactions, `
          + `${r.openingBalance.toFixed(2)} from before them`
      );
      load();
    } catch (e) {
      setRecalcMsg(`${account.name}: ${e.response?.data?.error || e.message}`);
    } finally {
      setRecalculating(null);
    }
  };

  // Re-derives the stored balance as openingBalance + recorded movements.
  const recalc = async (account) => {
    setRecalculating(account.id);
    setRecalcMsg(null);
    try {
      const before = Number(account.balance);
      const updated = await accountsApi.recalculate(account.id);
      const after = Number(updated.balance);
      setRecalcMsg(
        Math.abs(after - before) < 0.005
          ? `${account.name}: balance already matched its transactions`
          : `${account.name}: balance corrected from ${before.toFixed(2)} to ${after.toFixed(2)}`
      );
      load();
    } catch (e) {
      setRecalcMsg(`${account.name}: ${e.response?.data?.error || e.message}`);
    } finally {
      setRecalculating(null);
    }
  };
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

      {recalcMsg && (
        <div style={{
          borderRadius: 12, padding: "12px 16px", fontSize: 14,
          background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)",
          color: "#34d399", display: "flex", justifyContent: "space-between", gap: 12,
        }}>
          <div>{recalcMsg}</div>
          <button onClick={() => setRecalcMsg(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 0, fontSize: 16 }}>×</button>
        </div>
      )}

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
            {/* Wraps: investment accounts carry a fourth button that would
                otherwise push Delete off the card. */}
            <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => navigate(`/transactions?accountId=${a.id}`)}>Transactions</button>
              {a.type === "INVESTMENT" && (
                <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => setHoldingsFor(a)}>Holdings</button>
              )}
              <button
                className="glass-btn glass-btn-ghost"
                style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => reconcile(a)}
                disabled={recalculating === a.id}
                title="Enter the balance your bank shows; the starting balance is derived from it"
              >
                {recalculating === a.id ? "…" : "€ Set balance"}
              </button>
              <button
                className="glass-btn glass-btn-ghost"
                style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }}
                onClick={() => recalc(a)}
                disabled={recalculating === a.id}
                title="Re-derive the balance from the starting balance plus recorded transactions"
              >
                ↻
              </button>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => open(a)}>Edit</button>
              <button className="glass-btn glass-btn-danger" style={{ padding: "6px 12px", fontSize: 13, whiteSpace: "nowrap" }} onClick={() => remove(a.id)}>Delete</button>
            </div>
          </GlassCard>
        ))}
        {items.length === 0 && (
          <div style={{ color: "rgba(255,255,255,0.3)", gridColumn: "1/-1", padding: "60px 0", textAlign: "center" }}>
            No accounts yet. Add your first bank account to get started.
          </div>
        )}
      </div>

      {holdingsFor && (
        <HoldingsModal account={holdingsFor} onClose={() => setHoldingsFor(null)} onChanged={load} />
      )}

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
