# Plain sandbox widget

**Status:** mock-identity / Solana Devnet foundation, not a production bank,
identity-verification service or licensed payment integration. No real documents
are collected. `identityVerified` is always `false`.

## Surfaces

- `/widget-demo`: labeled mock organization, SDK mount/destroy example.
- `/widget`: embedded Earn surface, real app email authentication and existing
  user-signed Devnet transaction flow.
- `/plain-widget.js`: dependency-free browser SDK.

The product integration surface is **the widget only**. Its session endpoints
are internal sandbox bootstrap plumbing, not a production partner API. Only
`demo-bank` is supported today; real tenant registration, partner credentials,
production identity providers and real funding rails are not connected.

## Origin registration

The app origin is read from trusted `AUTH_JWT_ISSUER` configuration. Additional
sandbox embedding origins must be explicitly registered in
`WIDGET_ALLOWED_ORIGINS=https://partner.example,https://another.example` and
the app rebuilt/restarted. No wildcards, URL credentials or paths are accepted.
HTTP is accepted only for explicit loopback testing.

`/widget` has CSP `frame-ancestors` for the registered origins. If a reverse
proxy adds conflicting CSP/X-Frame-Options, review that configuration rather
than weakening frame protection globally.

## Sandbox initialization

Fetch `POST /api/widget/session` with JSON
`{ "partnerId": "demo-bank", "parentOrigin": "https://registered-origin.example" }`.
The short-lived token is signed, origin-bound and carries `widget:sandbox` only.
It **cannot authenticate a user, authorize spending, or verify identity**.
Sandbox session creation is public by design and accepts no real customer data.

Then load the script and mount:

```js
const widget = PlainWidget.mount({
  container: document.querySelector("#plain"),
  baseUrl: "https://plain.lengway.me",
  partnerId: "demo-bank",
  sessionToken: bootstrap.sessionToken,
  onEvent(event) {
    // UI notifications only; never credit real bank balances from postMessage.
  },
});
// On host unmount:
widget.destroy();
```

The token is sent through origin/source-checked `postMessage`, never in an iframe
URL, browser storage or console. The frame validates its session server-side.
Events include `ready`, `initialized`, `error` and verified **Devnet**
`action-confirmed` (action, actionId, signature). No email, documents or private
keys are sent to the host. `retry()` retries initialization, not transactions.

## Mock setup and custody boundaries

Direct users choose a demo country and acknowledge adult/developer-test/data
declarations after email authentication. In the bank example, signed sandbox
attributes substitute the repeated country/age form; the user still explicitly
acknowledges that these are fictional demo attributes. Stored status is
`MOCK_COMPLETED`, never `VERIFIED`.

The existing ledger stores only country, declarations, mock source and timestamp
under the authenticated user's existing hashed-email record. No passport,
photograph, birth date or full name is stored. `DELETE /api/me/onboarding` resets
these demo selections without deleting the wallet or positions.

New deposits require completed mock setup on the server. Existing withdrawals,
read-only portfolio/history and confirmations remain accessible. Real KYC,
sanctions checks, legal eligibility and Mainnet access are **not** granted.
The connected user's wallet remains the transaction signer.

## Browser limitation (do not hide it)

Same-origin `/widget-demo` is the supported sandbox reference. Cross-site cookies,
storage partitioning, embedded webviews and wallet-provider domain rules can
block authentication/signing on another origin even when CSP admits its frame.
The widget exposes a first-party app link as fallback. Production federation,
popup signing or a reviewed same-site hosting arrangement requires a separate
design and validation; this sandbox does not claim those integrations work.
