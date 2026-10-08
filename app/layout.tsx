import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geist = Geist({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "RWA Bridge",
  description: "Тестовый слой доходности на Solana devnet для банков и финтех-приложений.",
  appleWebApp: {
    capable: true,
    title: "RWA Bridge",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#1f1f1f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ru"
      className={`${geist.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
