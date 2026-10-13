import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only public marketing pages belong here; app and embed routes are noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/issuers`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
