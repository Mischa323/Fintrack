export default function GlassCard({ children, className = "", style = {}, strong = false, onClick }) {
  return (
    <div className={`${strong ? "glass-strong" : "glass"} ${className}`} style={{ padding: 24, ...style }} onClick={onClick}>
      {children}
    </div>
  );
}
