import { useState, useEffect } from "react";
import { categories as catsApi } from "../api/client";
import GlassCard from "../components/GlassCard";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#06b6d4"];
const ICONS = ["🏠", "🍔", "🚗", "💪", "🎬", "🛍️", "⚡", "💰", "🏦", "📦", "✈️", "🎓", "💊", "🎮", "🍕", "📱"];

const emptyForm = { name: "", color: "#6366f1", icon: "📦" };

export default function Categories() {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);

  const load = () => catsApi.list().then(setItems);
  useEffect(() => { load(); }, []);

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
        <button className="glass-btn glass-btn-primary" style={{ padding: "10px 20px" }} onClick={() => open()}>+ Add Category</button>
      </div>

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
