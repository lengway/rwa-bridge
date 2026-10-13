import type { NextConfig } from "next";
import { widgetAllowedOrigins } from "./lib/widget-origins";

const nextConfig: NextConfig = {
  // Kamino's SDK transitively loads a Node WASM package whose loader relies on
  // its on-disk sibling `.wasm` file. Keep this server-only integration on
  // native Node resolution rather than rebasing its `__dirname` in a bundle.
  serverExternalPackages: [
    "@kamino-finance/klend-sdk",
    "@orca-so/whirlpools-core",
  ],
  async redirects() {
    return [
      // Canonical host: serve everything from the apex domain.
      { source: "/:path*", has: [{ type: "host", value: "www.plain.lengway.me" }], destination: "https://plain.lengway.me/:path*", permanent: true },
      // Legacy and guessable paths.
      { source: "/demo-bank", destination: "/bank", permanent: true },
      { source: "/assets/rwa-demo", destination: "/assets/rwa", permanent: true },
      { source: "/index", destination: "/", permanent: true },
      { source: "/app", destination: "/home", permanent: false },
      { source: "/dashboard", destination: "/home", permanent: false },
      { source: "/wallet", destination: "/portfolio", permanent: false },
      { source: "/invest", destination: "/earn/kamino-lend", permanent: false },
      { source: "/kamino", destination: "/earn/kamino-lend", permanent: false },
      { source: "/login", destination: "/home", permanent: false },
      { source: "/signin", destination: "/home", permanent: false },
      // The issuer console moved to /issuers; keep old links working.
      { source: "/kase", destination: "/issuers", permanent: true },
      { source: "/faq", destination: "/#faq", permanent: true },
      { source: "/security", destination: "/#security", permanent: true },
      { source: "/how-it-works", destination: "/#how-it-works", permanent: true },
    ];
  },
  headers() {
    return [
      { source: "/widget", headers: [
        { key: "Content-Security-Policy", value: `frame-ancestors 'self' ${widgetAllowedOrigins().join(" ")}` },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ] },
      { source: "/plain-widget.js", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }] },
    ];
  },
};

export default nextConfig;
