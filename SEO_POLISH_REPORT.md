# SEO, performance & polish report

Branch `claude/seo-ui-polish` (based on `039b363`; merges cleanly with `8d61f27`, the latest
`codex/universal-earn-gateway` commit). Not pushed, not deployed.

## Lighthouse — landing `/` (local `next start`, Lighthouse 12)

| | Perf | A11y | Best practices | SEO | LCP | TBT | CLS | Script transferred |
|---|---|---|---|---|---|---|---|---|
| Mobile, before | 86 | 100 | 96 | 100 | 4.3 s | 40 ms | 0 | 451 KB / 14 files |
| Mobile, after | **96** | 100 | **100** | 100 | **2.8 s** | 10 ms | 0 | **148 KB / 10 files** |
| Desktop, before | 99 | 100 | 96 | 100 | 0.9 s | 0 ms | 0 | |
| Desktop, after | **100** | 100 | **100** | 100 | 0.6 s | 0 ms | 0 | |

The main win: the root layout no longer mounts Crossmint/auth/market providers. The landing is now a
static (`○`) server-rendered page with no Crossmint code in its bundle; only a tiny copy-button island is client JS.

## Per item

1. **Indexing** — `/` is indexable with canonical `https://plain.lengway.me`. Every app route (`(app)` group:
   home, earn, portfolio, activity, funding, assets, profile) plus `/bank`, `/widget`, `/widget-demo` and the
   404 page send `noindex, nofollow` via the Metadata API (`lib/noindex.ts`).
2. **robots** — `app/robots.ts`: allow `/`, disallow `/api/`, `/widget`, `/bank`, `/.well-known/`; points to the sitemap.
   App routes are deliberately *not* disallowed so crawlers can read their `noindex` (a disallowed URL can still be
   indexed from links without content).
3. **sitemap** — `app/sitemap.ts` lists the public landing only.
4. **Desktop** — landing uses a `max-w-6xl` grid (two-column hero, 3-column steps, 2-column trust, FAQ side-by-side).
   *Skipped:* the signed-in app shell stays a centered phone-width column (`max-w-md`) — intentional mobile-first
   framing, and redesigning it risked the invest flow being edited in parallel.
5. **Landing** — hero, how it works (3 steps), security & transparency (4 facts + pinned Kamino/USDC addresses with
   copy + Explorer links), for partners (bank embed), FAQ (7 Q&A), final CTA, footer. Facts only: devnet USDC, Kamino
   Lend, Crossmint smart wallet, fees paid by Plain, variable rate, no returns promised. Global positioning; Kazakhstan
   mentioned as first market. **Copy is English, not Russian:** the existing product voice (landing, app shell, sign-in,
   which even translates Russian server errors to English) is English. Flag if Russian is still wanted.
6. **Polish** — consistent pill CTAs with hover/active/focus-visible rings, card hover lift, skip-to-content link,
   smooth anchor scroll, `motion-safe:` entrance animation on the hero preview; everything honours
   `prefers-reduced-motion`. The hero text is not animated (it was delaying LCP).
7. **Errors** — branded `app/not-found.tsx`, `app/error.tsx` (retry + back home) and `app/global-error.tsx`
   (self-contained styles, since it replaces the root layout).
8. **Redirects** (`next.config.ts`) — `www.` → apex (308), `/demo-bank` → `/bank` and `/assets/rwa-demo` →
   `/assets/rwa` as 308 (replacing the old page-level 307 `redirect()` pages), `/faq` `/security` `/how-it-works` →
   landing anchors, temporary `/app` `/dashboard` `/login` `/signin` → `/home`, `/wallet` → `/portfolio`,
   `/invest` `/kamino` → `/earn/kamino-lend`. Trailing slashes are already 308'd by Next (verified `/home/` → `/home`).
9. **Status codes** — unknown URLs return 404. `/earn/<unknown>` and `/assets/<unknown>` used to return a streamed soft
   200 (client providers flush before the page's `notFound()` runs); `proxy.ts` now resolves those ids first: unknown → 404,
   legacy alias → 308. Anonymous visits to app pages return 200 with the sign-in screen (no 500s).
10. **Metadata** — title template `%s · Plain`, unique landing title/description, OpenGraph + Twitter
   `summary_large_image`, generated `opengraph-image`/`twitter-image` (1200×630), light/dark `theme-color`.
   Existing favicon, `icon.svg`, PNG icons, apple icon and manifest verified (all 200).
11. **Headings** — landing: one `h1`, `h2` per section, `h3` per card/FAQ item. 404/error pages: one `h1`.
12. **URLs** — no routes renamed; legacy and guessable paths redirect (item 8).
13. **Internal links** — sticky header nav (How it works / Security / For partners / FAQ + Open app), footer
   Product / Get started columns, in-page anchors with `scroll-mt` offset under the sticky header.
14. **Broken links** — crawled the built site (landing, 404, app, widget-demo, robots, sitemap, manifest and every
   same-origin `href`/`src` found): **48 URLs, 0 broken**.
15. **schema.org** — JSON-LD `@graph` on `/`: Organization, WebSite, WebApplication (FinanceApplication, free) and
   FAQPage mirroring the visible FAQ. FinancialProduct skipped: not accurate for a devnet-only product.
16. **Images/alt** — the landing has no raster images; all icons are `aria-hidden`, the hero product preview is a
   `figure` with an `sr-only` caption and its visual content hidden from AT.
17–18. **Speed / CWV** — see table. Static landing, no wallet SDK, `Geist Mono` no longer preloaded, zero CLS,
   no client fetch on the landing (pinned addresses are rendered server-side instead of fetched from `/api/kamino/market`).
19. **Responsive** — checked 360, 390, 768, 1024, 1440: `scrollWidth === innerWidth` at every width.
20. **SSR** — all landing copy, FAQ answers and JSON-LD are in the `curl` HTML; FAQ uses native `<details>` so it works
   without JS. Client boundary on the landing = `CopyAddressButton` only.

Also: removed the user-visible "sandbox demo" error string on `/widget-demo`; the landing link reads "See the bank embed".

## Needs follow-up in excluded / other files

- None required in `kamino-*`, `crossmint-*`, `useAuth.tsx` or `app/api/**`.
- `components/app/mock-capture.tsx` and the app shell header can both render an `h1` during onboarding (noindex
  routes, low priority).
- The bank sample (`components/bank-embed/bank-embed-screen.tsx`) still shows a Russian toast "Недоступно".
- Production nginx/Cloudflare: if `www.plain.lengway.me` has no DNS record the www redirect is simply inert.

## Verification

`npm run lint`, `npm run typecheck`, `npm test` (127/127) and `npm run build` pass on the final commit.
