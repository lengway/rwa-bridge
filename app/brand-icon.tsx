export function BrandIcon({ size }: { size: number }) {
  const fontSize = Math.round(size * 0.54);
  return (
    <div style={{ background: "#1f1f1f", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize, fontWeight: 700, letterSpacing: -fontSize * 0.07 }}>
      P
    </div>
  );
}
