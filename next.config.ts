import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Kamino's SDK transitively loads a Node WASM package whose loader relies on
  // its on-disk sibling `.wasm` file. Keep this server-only integration on
  // native Node resolution rather than rebasing its `__dirname` in a bundle.
  serverExternalPackages: [
    "@kamino-finance/klend-sdk",
    "@orca-so/whirlpools-core",
  ],
};

export default nextConfig;
