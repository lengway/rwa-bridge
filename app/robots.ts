import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// App routes stay crawlable so search engines can read their noindex meta tag;
// API and embed endpoints are never useful to crawl.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/widget", "/bank", "/.well-known/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
