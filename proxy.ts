import { NextResponse, type NextRequest } from "next/server";
import { BRIDGE_ASSETS } from "@/lib/assets";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";

// App pages stream their client providers before the page runs, so notFound()/redirect()
// inside /earn/[id] and /assets/[id] can only produce a soft 200. Resolve those ids here,
// before rendering, so unknown ids return a real 404 and aliases a real 308.
const LEGACY_ASSET_ALIASES: Record<string, string> = { "aifc-mock-iconic-tower": "office-building" };

function resolve(section: string, id: string): string | null {
  if (section === "earn") {
    return ALL_YIELD_STRATEGIES.find((item) => item.id === id || item.slug === id)?.slug ?? null;
  }
  if (LEGACY_ASSET_ALIASES[id]) return LEGACY_ASSET_ALIASES[id];
  return BRIDGE_ASSETS.find((item) => item.id === id || item.slug === id)?.slug ?? null;
}

export function proxy(request: NextRequest) {
  const match = /^\/(earn|assets)\/([^/]+)$/.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();
  const [, section, rawId] = match;
  // /assets/rwa is a static sibling route, not an asset id.
  if (section === "assets" && rawId === "rwa") return NextResponse.next();
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  const slug = resolve(section, id);
  if (!slug) {
    // Any unmatched path renders app/not-found.tsx with a 404 status.
    return NextResponse.rewrite(new URL("/__not-found", request.url));
  }
  if (slug !== id) {
    const url = request.nextUrl.clone();
    url.pathname = `/${section}/${slug}`;
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/earn/:id", "/assets/:id"],
};
