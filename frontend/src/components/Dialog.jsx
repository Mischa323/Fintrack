import { useEffect } from "react";

/**
 * FinTrack dialog — a centered glass-strong panel over a dimmed, blurred
 * overlay. Click-outside and Esc close it.
 */
export default function Dialog({ open = true, onClose, title, children, width = 460, style = {} }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape" && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        className="glass-strong"
        style={{ width, maxWidth: "95vw", maxHeight: "88vh", overflowY: "auto", padding: 28, ...style }}
      >
        {title && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#fff" }}>{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", fontSize: 22, cursor: "pointer", lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
