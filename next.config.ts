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
