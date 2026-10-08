import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RWA Bridge",
    short_name: "RWA Bridge",
    description: "Тестовое приложение RWA Bridge на Solana devnet",
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
