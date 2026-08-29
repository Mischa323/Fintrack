export default function GlassCard({ children, className = "", style = {}, strong = false, onClick, ...rest }) {
  return (
    <div className={`${strong ? "glass-strong" : "glass"} ${className}`} style={{ padding: 24, ...style }} onClick={onClick} {...rest}>
      {children}
    </div>
  );
}
