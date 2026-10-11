import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Plain",
    short_name: "Plain",
    description: "Plain · Kamino Lend on Solana Devnet. Test tokens have no monetary value.",
    lang: "en",
    start_url: "/home",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1f1f1f",
    icons: [
      { src: "/icon1", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon2", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
