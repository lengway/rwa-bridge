"use client";

// Replaces the root layout when it fails, so it cannot rely on globals.css or fonts.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif", background: "#f5f5f5", color: "#141414" }}>
        <title>Something went wrong · Plain</title>
        <main role="alert" style={{ width: "100%", maxWidth: 420, boxSizing: "border-box", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 32, padding: 40, textAlign: "center" }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Plain</p>
          <h1 style={{ margin: "20px 0 12px", fontSize: 28, letterSpacing: -0.5 }}>Something went wrong</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#525252" }}>Plain couldn&apos;t load. Your wallet and positions are not affected.</p>
          {error.digest ? <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#737373" }}>Reference: {error.digest}</p> : null}
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
            <button type="button" onClick={() => retry()} style={{ height: 44, padding: "0 24px", borderRadius: 999, border: 0, background: "#1f1f1f", color: "#fff", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Try again</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is intended after a root-layout failure */}
            <a href="/" style={{ height: 44, padding: "0 24px", borderRadius: 999, border: "1px solid #d4d4d4", color: "#141414", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>Back to Plain</a>
          </div>
        </main>
      </body>
    </html>
  );
}
