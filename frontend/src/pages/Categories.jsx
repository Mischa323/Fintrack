import { useState, useEffect } from "react";
import { categories as catsApi, ai as aiApi } from "../api/client";
import GlassCard from "../components/GlassCard";

// Category colours are also the slice colours of the dashboard's spending chart,
// so they have to stay apart from each other on a dark surface.
//
// The first eight were validated against that surface: every pair clears the
// colourblind and normal-vision separation floors (worst adjacent ΔE 8.4 CVD /
// 19.3 normal). The old set failed badly — indigo and violet measured ΔE 0.8 for
// red-green colourblindness and 6.3 for full colour vision, effectively the same
// colour. Past eight hues no ordering can clear the floors, so the extras below
// are exactly that: still usable, but the chart leans on its labels and tooltip
// for identity rather than hue alone.
const COLORS = [
  "#3987e5", "#008300", "#d55181", "#c98500",
  "#199e70", "#d95926", "#9085e9", "#e66767",
];
const EXTRA_COLORS = [
  "#1f9ab5", "#9a5fd0", "#6f9e1c", "#c2703a",
  "#e0679e", "#4aa3d6", "#b06a00", "#5b74d1",
];
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
  const [acceptDetach, setAcceptDetach] = useState(false);

  useEffect(() => { catsApi.flat().then(setAll); }, []);

  // Any change to the selection invalidates a previously given confirmation
  useEffect(() => { setAcceptDetach(false); }, [targetId, sources.join(",")]);

  const toggle = (id) => setSources((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const target = all.find((c) => c.id === targetId);
  const chosen = all.filter((c) => sources.includes(c.id) && c.id !== targetId);
  const movingTx = chosen.reduce((n, c) => n + (c._count?.transactions || 0), 0);
  const movingSubs = chosen.reduce((n, c) => n + (c._count?.children || 0), 0);

  const visible = all.filter((c) => c.name.toLowerCase().includes(filter.trim().toLowerCase()));

  // The category being kept sits under one that is about to disappear, so it
  // will be promoted to top-level. Worth an explicit yes rather than a surprise.
  const willDetachTarget = !!target?.parent && chosen.some((c) => c.id === target.parent.id);
  const blocked = willDetachTarget && !acceptDetach;

  const merge = async () => {
    if (!targetId || chosen.length === 0 || blocked) return;
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

        {willDetachTarget && (
          <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(248,113,113,0.35)", fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ color: "#f87171", fontWeight: 600, marginBottom: 4 }}>
              ⚠ “{target.name}” loses its parent category
            </div>
            <div style={{ color: "rgba(255,255,255,0.6)" }}>
              You are merging away “{target.parent.name}”, which “{target.name}” currently sits under.
              “{target.name}” will become a top-level category. Its transactions are not affected.
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, color: "#fca5a5", cursor: "pointer" }}>
              <input type="checkbox" checked={acceptDetach} onChange={(e) => setAcceptDetach(e.target.checked)} />
              Yes, make “{target.name}” a top-level category
            </label>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 12, fontSize: 13, color: "#f87171" }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={onClose}>Cancel</button>
          <button
            className="glass-btn glass-btn-primary"
            style={{ padding: "10px 20px", opacity: (!targetId || chosen.length === 0 || busy || blocked) ? 0.5 : 1 }}
            onClick={merge}
            disabled={!targetId || chosen.length === 0 || busy || blocked}
            title={blocked ? "Confirm the parent-category change first" : undefined}
          >
            {busy ? "Merging…" : `Merge ${chosen.length || ""}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI merge suggestions ─────────────────────────────────────────────────────
// The model spots categories that are really one specific thing sitting beside a
// broader heading. It is right often enough to be useful and wrong often enough
// that its reasoning is shown and nothing merges without being ticked.
function AiMergeModal({ onClose, onDone }) {
  const [state, setState] = useState({ phase: "loading" });
  const [groups, setGroups] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    aiApi.suggestCategories()
      .then((r) => {
        if (cancelled) return;
        setGroups(r.groups.map((g, i) => ({ ...g, key: i, accepted: false })));
        setState({ phase: "review" });
      })
      .catch((e) => {
        if (!cancelled) setState({ phase: "error", error: e.response?.data?.error || e.message });
      });
    return () => { cancelled = true; };
  }, []);

  const toggle = (key) =>
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, accepted: !g.accepted } : g)));

  const chosen = groups.filter((g) => g.accepted);

  const applyAll = async () => {
    setBusy(true);
    let merged = 0;
    let moved = 0;
    try {
      for (const g of chosen) {
        const res = await catsApi.merge(g.sources.map((s) => s.id), g.targetId);
        merged += res.merged;
        moved += res.movedTransactions;
      }
      onDone(`Merged ${merged} categor${merged === 1 ? "y" : "ies"}${moved ? `, ${moved} transactions moved` : ""}`);
    } catch (e) {
      setState({ phase: "error", error: e.response?.data?.error || e.message });
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="glass-strong" style={{ width: 620, maxWidth: "95vw", maxHeight: "90vh", padding: 28, display: "flex", flexDirection: "column" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Suggested merges</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          Your local model looked for categories that are one specific thing next to a broader
          one. Its reasoning is shown for each — it gets some of these plainly wrong, so tick only
          what you agree with.
        </p>

        {state.phase === "loading" && (
          <div style={{ padding: "36px 0", textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 14 }}>
            Thinking…
          </div>
        )}

        {state.phase === "error" && (
          <div style={{ marginTop: 18, padding: "14px 16px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(248,113,113,0.35)", fontSize: 13, color: "#f87171", lineHeight: 1.6 }}>
            {state.error}
          </div>
        )}

        {state.phase === "review" && groups.length === 0 && (
          <div style={{ padding: "36px 0", textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: 14 }}>
            Nothing suggested — your categories look distinct enough.
          </div>
        )}

        {state.phase === "review" && groups.length > 0 && (
          <>
            <div style={{ flex: 1, overflowY: "auto", marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {groups.map((g) => (
                <label
                  key={g.key}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px",
                    borderRadius: 10, cursor: "pointer", fontSize: 13, lineHeight: 1.6,
                    background: g.accepted ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${g.accepted ? "rgba(129,140,248,0.5)" : "transparent"}`,
                  }}
                >
                  <input type="checkbox" checked={g.accepted} onChange={() => toggle(g.key)} style={{ marginTop: 3 }} />
                  <div style={{ minWidth: 0 }}>
                    <div>
                      <strong>{g.sources.map((s) => s.name).join(", ")}</strong>
                      <span style={{ color: "rgba(255,255,255,0.4)" }}> → </span>
                      <strong style={{ color: "#c7d2fe" }}>{g.targetName}</strong>
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.4)" }}>
                      {g.movedTransactions} transaction{g.movedTransactions === 1 ? "" : "s"} would move
                    </div>
                    {g.why && (
                      <div style={{ color: "rgba(255,255,255,0.35)", fontStyle: "italic", marginTop: 2 }}>
                        “{g.why}”
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div style={{ marginTop: 14, padding: "10px 13px", borderRadius: 9, fontSize: 12, color: "rgba(251,191,36,0.85)", background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)", lineHeight: 1.6 }}>
              Merging deletes the categories on the left and moves their transactions. This cannot be undone.
            </div>
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
          <button className="glass-btn glass-btn-ghost" style={{ padding: "9px 18px" }} onClick={onClose}>
            {state.phase === "review" && groups.length > 0 ? "Cancel" : "Close"}
          </button>
          {state.phase === "review" && groups.length > 0 && (
            <button
              className="glass-btn glass-btn-primary"
              style={{ padding: "9px 20px", opacity: (!chosen.length || busy) ? 0.5 : 1 }}
              onClick={applyAll}
              disabled={!chosen.length || busy}
            >
              {busy ? "Merging…" : `Merge ${chosen.length}`}
            </button>
          )}
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
  const [aiMerge, setAiMerge] = useState(false);

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
          <button className="glass-btn glass-btn-ghost" style={{ padding: "10px 20px" }} onClick={() => { setMergeResult(null); setAiMerge(true); }} title="Let your local model look for categories that belong together">
            ✨ Suggest
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
            {mergeResult.text ? `✓ ${mergeResult.text}` : (
              <>
                ✓ Merged {mergeResult.merged} categor{mergeResult.merged === 1 ? "y" : "ies"} into “{mergeResult.target}”
                {mergeResult.movedTransactions > 0 && ` — ${mergeResult.movedTransactions} transaction${mergeResult.movedTransactions === 1 ? "" : "s"} moved`}
                {mergeResult.detachedTarget && ` · “${mergeResult.target}” is now a top-level category`}
              </>
            )}
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

      {aiMerge && (
        <AiMergeModal
          onClose={() => setAiMerge(false)}
          onDone={(text) => { setAiMerge(false); setMergeResult({ merged: 0, target: "", movedTransactions: 0, text }); load(); }}
        />
      )}

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
                    <div key={c} onClick={() => setForm({ ...form, color: c })} title="Stays distinct in the spending chart" style={{ width: 28, height: 28, borderRadius: 8, background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent" }} />
                  ))}
                </div>

                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: "10px 0 6px" }}>
                  More colors — harder to tell apart in the chart
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {EXTRA_COLORS.map((c) => (
                    <div key={c} onClick={() => setForm({ ...form, color: c })} style={{ width: 24, height: 24, borderRadius: 7, background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent" }} />
                  ))}
                  <label title="Pick any color" style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4, cursor: "pointer" }}>
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value })}
                      style={{ width: 28, height: 24, borderRadius: 7, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", cursor: "pointer", padding: 1 }}
                    />
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>custom</span>
                  </label>
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
