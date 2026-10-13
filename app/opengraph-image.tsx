import { ImageResponse } from "next/og";

export const alt = "Plain — on-chain yield, as simple as your banking app";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: "linear-gradient(135deg, #ffffff 0%, #f1f5f4 55%, #e3f4ec 100%)", color: "#141414" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 72, height: 72, borderRadius: 20, background: "#1f1f1f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 700 }}>P</div>
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Plain</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: -3, lineHeight: 1.05, maxWidth: 980 }}>On-chain yield, as simple as your banking app.</div>
          <div style={{ fontSize: 32, color: "#525252" }}>Email sign-in · Crossmint smart wallet · Kamino Lend on Solana</div>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 24, color: "#404040" }}>
          <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid #d4d4d4" }}>No seed phrase</div>
          <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid #d4d4d4" }}>Network fees paid by Plain</div>
          <div style={{ display: "flex", padding: "10px 22px", borderRadius: 999, border: "2px solid #d4d4d4" }}>Live on Solana devnet</div>
        </div>
      </div>
    ),
    size,
  );
}
