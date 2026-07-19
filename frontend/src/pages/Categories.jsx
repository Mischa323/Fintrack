import { useState, useEffect } from "react";
import { categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#06b6d4"];
const ICONS = ["🏠", "🍔", "🚗", "💪", "🎬", "🛍️", "⚡", "💰", "🏦", "📦", "✈️", "🎓", "💊", "🎮", "🍕", "📱"];

const emptyForm = { name: "", color: "#6366f1", icon: "📦" };

// ── Merge categories ─────────────────────────────────────────────────────────
// Imports create a category per name they encounter, so duplicates like
// "Groceries" and "Boodschappen" pile up. Merging folds them into one.
function MergeModal({ onClose, onDone }) {
  const [all, setAll] = useState([]);
  const [sources, setSources] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => { catsApi.flat().then(setAll); }, []);

  const toggle = (id) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const target = all.find((c) => c.id === targetId);
  const chosen = all.filter((c) => sources.includes(c.id) && c.id !== targetId);
  const movingTx = chosen.reduce((n, c) => n + (c._count?.transactions || 0), 0);
  const movingSubs = chosen.reduce((n, c) => n + (c._count?.children || 0), 0);

  const visible = all.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const merge = async () => {
    if (!targetId || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await catsApi.merge(chosen.map((c) => c.id), targetId);
      onDone(res);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 560, padding: 32, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Merge categories</h2>
        <p style={{ margin: "0 0 18px", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          Pick the categories you want to get rid of, then the one they should become.
          Their transactions and sub-categories move over — nothing becomes uncategorised.
        </p>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Merge into</div>
          <select className="glass-input" style={{ padding: "10px 14px", width: "100%" }} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select the category to keep…</option>
            {all.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon || "📦"} {c.name}{c.parent ? ` (under ${c.parent.name})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
          Categories to merge away {chosen.length > 0 && `— ${chosen.length} selected`}
        </div>
        <input
          className="glass-input"
          style={{ padding: "8px 12px", marginBottom: 8, fontSize: 13 }}
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div style={{ flex: 1, overflowY: "auto", minHeight: 120, maxHeight: 260, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 6 }}>
          {visible.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: "rgba(255,255,255,0.3)" }}>No categories match.</div>
          )}
          {visible.map((c) => {
            const isTarget = c.id === targetId;
            const checked = sources.includes(c.id) && !isTarget;
            return (
              <label
                key={c.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8,
                  cursor: isTarget ? "not-allowed" : "pointer", fontSize: 13,
                  opacity: isTarget ? 0.35 : 1,
                  background: checked ? "rgba(99,102,241,0.15)" : "transparent",
                }}
              >
                <input type="checkbox" checked={checked} disabled={isTarget} onChange={() => toggle(c.id)} />
                <span>{c.icon || "📦"}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {c.name}
                  {c.parent && <span style={{ color: "rgba(255,255,255,0.3)" }}> · under {c.parent.name}</span>}
                  {isTarget && <span style={{ color: "#6ee7b7" }}> · keeping this one</span>}
                </span>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, whiteSpace: "nowrap" }}>
                  {c._count?.transactions ?? 0} tx
                </span>
              </label>
            );
          })}
        </div>

        {chosen.length > 0 && target && (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)", fontSize: 13, lineHeight: 1.6, color: "rgba(251,191,36,0.9)" }}>
            {chosen.length} categor{chosen.length === 1 ? "y" : "ies"} will be deleted.
            {movingTx > 0 && ` ${movingTx} transaction${movingTx === 1 ? "" : "s"} move to “${target.name}”.`}
            {movingSubs > 0 && ` ${movingSubs} sub-categor${movingSubs === 1 ? "y" : "ies"} move too.`}
            {" "}This cannot be undone.
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#f87171" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={onClose}>Cancel</button>
          <button
            className="glass-btn glass-btn-primary"
            style={{ padding: "10px 20px", opacity: (!targetId || chosen.length === 0 || busy) ? 0.5 : 1 }}
            onClick={merge}
            disabled={!targetId || chosen.length === 0 || busy}
          >
            {busy ? "Merging…" : `Merge ${chosen.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Categories() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [seeding, setSeeding] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);

  const load = () => catsApi.list().then(setItems);
  useEffect(() => { load(); }, []);

  const loadDefaults = async () => {
    setSeeding(true);
    try {
      const result = await catsApi.seed();
      await load();
      if (result.created === 0) alert("All standard categories are already loaded.");
      else alert(`${result.created} standard categories added.`);
    } finally {
      setSeeding(false);
    }
  };

  const open = (item = null) => {
    setEditing(item?.id || null);
    setForm(item ? { name: item.name, color: item.color, icon: item.icon || "📦" } : emptyForm);
    setModal(true);
  };

  const save = async () => {
    if (editing) await catsApi.update(editing, form);
    else await catsApi.create(form);
    setModal(false);
    load();
  };

  const remove = async (id) => {
    if (!confirm("Delete this category? Transactions will be uncategorized.")) return;
    await catsApi.remove(id);
    load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Categories</h1>
          <p style={{ color: "rgba(255,255,255,0.45)", margin: "4px 0 0", fontSize: 14 }}>Organize your spending</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={loadDefaults} disabled={seeding}>
            {seeding ? "Loading…" : "Load defaults"}
          </button>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={() => { setMergeResult(null); setMerging(true); }}>
            ⇥ Merge
          </button>
          <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>+ Add Category</button>
        </div>
      </div>

      {mergeResult && (
        <div style={{ borderRadius: 12, padding: "12px 16px", fontSize: 14, background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.3)", color: "#34d399", display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            ✓ Merged {mergeResult.merged} categor{mergeResult.merged === 1 ? "y" : "ies"} into “{mergeResult.target}”
            {mergeResult.movedTransactions > 0 && ` — ${mergeResult.movedTransactions} transaction${mergeResult.movedTransactions === 1 ? "" : "s"} moved`}
          </div>
          <button onClick={() => setMergeResult(null)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 0, fontSize: 16 }}>×</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
        {items.map((c) => (
          <GlassCard key={c.id} style={{ borderTop: `3px solid ${c.color}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: `${c.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                {c.icon || "📦"}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{c.name}</div>
                {c.children?.length > 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{c.children.length} sub-categories</div>}
              </div>
            </div>
            {c.children?.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                {c.children.map((ch) => (
                  <span key={ch.id} style={{ fontSize: 11, background: `${ch.color}22`, color: ch.color, padding: "2px 8px", borderRadius: 6 }}>{ch.name}</span>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="glass-btn glass-btn-ghost" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => open(c)}>Edit</button>
              <button className="glass-btn glass-btn-danger" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => remove(c.id)}>Delete</button>
            </div>
          </GlassCard>
        ))}
      </div>

      {merging && (
        <MergeModal
          onClose={() => setMerging(false)}
          onDone={(res) => { setMerging(false); setMergeResult(res); load(); }}
        />
      )}

      {modal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setModal(false)}>
          <div className="glass-strong" style={{ width: 420, padding: 32, maxWidth: "95vw" }}>
            <h2 style={{ margin: "0 0 20px", fontSize: 18 }}>{editing ? "Edit" : "Add"} Category</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <input className="glass-input" style={{ padding: "10px 14px" }} placeholder="Category name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Color</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {COLORS.map((c) => (
                    <div key={c} onClick={() => setForm({ ...form, color: c })} style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent" }} />
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 8 }}>Icon</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ICONS.map((ic) => (
                    <div key={ic} onClick={() => setForm({ ...form, icon: ic })} style={{ width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, cursor: "pointer", background: form.icon === ic ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)", border: form.icon === ic ? "1px solid rgba(99,102,241,0.6)" : "1px solid transparent" }}>
                      {ic}
                    </div>
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
