import type { Metadata } from "next";

// App, wallet and partner-embed routes are personal or interactive; keep them out of search results.
export const noIndexMetadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};
