export default function GlassCard({ children, className = "", style = {}, strong = false }) {
  return (
    <div className={`${strong ? "glass-strong" : "glass"} ${className}`} style={{ padding: 24, ...style }}>
      {children}
    </div>
  );
}
