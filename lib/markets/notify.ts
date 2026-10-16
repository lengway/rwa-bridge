import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { formatDateTime, formatSettlement, formatUnits } from "./format";
import { holderEntitlement } from "./math";
import type { Address, ClaimReceipt, CorporateAction, Instrument, MarketsLedger } from "./service";

/**
 * Corporate-action emails for Plain investors (MARKETS_NOTIFY_EMAILS=on).
 *
 * After a confirmed issuer `announce`, every Plain investor holding the bond gets the record date,
 * payment date, amount per unit and their expected entitlement; after `pay` the holder gets the
 * amount received with explorer and /verify links. Only wallets with a known contact (stored when a
 * signed-in user links their smart wallet) get mail; others are skipped silently. Each
 * (action, holder, kind) is sent at most once, recorded in a small JSON store, and sends are
 * rate-limited. Nothing here can fail or delay the issuer operation.
 *
 * This module is transport-agnostic (tests inject `send`); `notify-server.ts` wires the mailer.
 */

export type NotifyKind = "announce" | "payment";

export type NotifyEmail = { to: string; subject: string; text: string; html: string };

export function notifyEnabled(env: Record<string, string | undefined> = process.env) {
  return env.MARKETS_NOTIFY_EMAILS?.trim().toLowerCase() === "on";
}

// ---- store -------------------------------------------------------------------------------------

type StoreFile = { contacts: Record<Address, string>; sent: Record<string, number> };

/**
 * wallet → email contacts and the sent-log. The demo ledger keeps emails only as hashes, so the
 * reverse lookup needs its own (opt-in, flag-gated) record.
 */
export class NotifyStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  private async read(): Promise<StoreFile> {
    try {
      const parsed = JSON.parse(await readFile(/* turbopackIgnore: true */ this.file, "utf8")) as Partial<StoreFile>;
      return { contacts: parsed.contacts ?? {}, sent: parsed.sent ?? {} };
    } catch {
      return { contacts: {}, sent: {} };
    }
  }

  private async write(data: StoreFile) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  setContact(wallet: Address, email: string) {
    return this.exclusive(async () => {
      const data = await this.read();
      if (data.contacts[wallet] === email) return;
      data.contacts[wallet] = email;
      await this.write(data);
    });
  }

  /** Read-only reverse lookup: the email of a Plain investor's wallet, or null. */
  emailFor(wallet: Address) {
    return this.exclusive(async () => (await this.read()).contacts[wallet] ?? null);
  }

  /** Reserves (action, holder, kind). False if it was already sent (or reserved). */
  claim(actionId: Address, holder: Address, kind: NotifyKind, now = Date.now()) {
    return this.exclusive(async () => {
      const data = await this.read();
      const key = `${actionId}:${holder}:${kind}`;
      if (data.sent[key]) return false;
      data.sent[key] = now;
      await this.write(data);
      return true;
    });
  }

  /** Frees a reservation whose send failed, so a later retry may send it. */
  release(actionId: Address, holder: Address, kind: NotifyKind) {
    return this.exclusive(async () => {
      const data = await this.read();
      delete data.sent[`${actionId}:${holder}:${kind}`];
      await this.write(data);
    });
  }
}

/** Sliding-window limiter: at most `max` sends per `windowMs`. */
export function createSendLimiter(max = 30, windowMs = 60_000, clock = () => Date.now()) {
  const sent: number[] = [];
  return () => {
    const now = clock();
    while (sent.length && sent[0] <= now - windowMs) sent.shift();
    if (sent.length >= max) return false;
    sent.push(now);
    return true;
  };
}

// ---- templates ---------------------------------------------------------------------------------

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

const KIND_LABEL: Record<CorporateAction["kind"], string> = {
  Coupon: "Coupon payment",
  PartialRedemption: "Partial redemption",
  FinalRedemption: "Final redemption",
  Vote: "Bondholder vote",
};

type Row = [label: string, value: string];
type Link = { label: string; href: string };

function render(to: string, subject: string, heading: string, intro: string, rows: Row[], links: Link[]): NotifyEmail {
  const footer = "Solana Devnet · test tokens · No monetary value. You get this because you hold this bond in Plain.";
  const text = [
    `Plain — ${heading}`,
    "",
    intro,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(links.length ? ["", ...links.map((l) => `${l.label}: ${l.href}`)] : []),
    "",
    footer,
  ].join("\n");
  const table = rows
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;font-size:13px">${escapeHtml(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("");
  const buttons = links
    .map((l) => `<p style="margin:0 0 10px"><a href="${escapeHtml(l.href)}" style="color:#172554;font-weight:600">${escapeHtml(l.label)}</a></p>`)
    .join("");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6fa;color:#172033;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e8f0;border-radius:14px"><tr><td style="padding:28px"><p style="margin:0 0 24px;color:#64748b;font-size:14px;font-weight:700;letter-spacing:.04em">Plain</p><h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">${escapeHtml(heading)}</h1><p style="margin:0 0 18px;color:#475569;line-height:1.6">${escapeHtml(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px">${table}</table>${buttons}<p style="margin:16px 0 0;padding-top:18px;border-top:1px solid #e4e8f0;color:#64748b;font-size:12px;line-height:1.6">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { to, subject, text, html };
}

type Ctx = { to: string; instrument: Instrument; action: CorporateAction; siteUrl: string };

const money = (inst: Instrument, v: bigint) => formatSettlement(v, inst.settlementDecimals, inst.settlementSymbol);
const verifyUrl = (siteUrl: string, actionId: Address) => `${siteUrl.replace(/\/$/, "")}/verify/${actionId}`;

export function announceEmail({ to, instrument, action, siteUrl }: Ctx, units: bigint): NotifyEmail {
  const label = KIND_LABEL[action.kind];
  const bond = `${instrument.name} (${instrument.symbol})`;
  const e = holderEntitlement(instrument, action.params, units);
  const isVote = action.kind === "Vote";
  const rows: Row[] = [
    ["Bond", bond],
    ["Action", `#${action.seq} ${action.title || label}`],
    ["Record date", formatDateTime(action.recordTs)],
    [isVote ? "Voting closes" : "Payment date", formatDateTime(action.paymentTs)],
    ["Your units now", formatUnits(units)],
  ];
  if (isVote) rows.push(["Your voting weight", `${formatUnits(e.weight)} units`]);
  else {
    rows.push(["Amount per unit", money(instrument, action.amountPerUnit)]);
    if (e.redeemUnits > BigInt(0)) rows.push(["Units to be redeemed", formatUnits(e.redeemUnits)]);
    rows.push(["Your expected entitlement", money(instrument, e.amount)]);
  }
  const intro = isVote
    ? `The issuer of ${bond} opened a bondholder vote. Holders on the record date can vote with their units.`
    : `The issuer of ${bond} announced a ${label.toLowerCase()}. Holders on the record date are paid on the payment date. The final amount follows your units at the record date.`;
  return render(to, `Plain · ${label} announced · ${instrument.symbol}`, `${label} announced`, intro, rows, [
    { label: "Verify this action", href: verifyUrl(siteUrl, action.id) },
  ]);
}

export function paymentEmail({ to, instrument, action, siteUrl }: Ctx, receipt: Pick<ClaimReceipt, "amount" | "units" | "burnedUnits">, explorerUrl: string | null): NotifyEmail {
  const label = KIND_LABEL[action.kind];
  const rows: Row[] = [
    ["Bond", `${instrument.name} (${instrument.symbol})`],
    ["Action", `#${action.seq} ${action.title || label}`],
    ["Units at record date", formatUnits(receipt.units)],
    ...(receipt.burnedUnits > BigInt(0) ? [["Units redeemed", formatUnits(receipt.burnedUnits)] as Row] : []),
    ["Amount received", money(instrument, receipt.amount)],
  ];
  const links: Link[] = [
    ...(explorerUrl ? [{ label: "Open in Explorer", href: explorerUrl }] : []),
    { label: "Verify this payment", href: verifyUrl(siteUrl, action.id) },
  ];
  return render(
    to,
    `Plain · You received ${money(instrument, receipt.amount)} · ${instrument.symbol}`,
    `${label} received`,
    `Your ${label.toLowerCase()} was paid to your Plain wallet.`,
    rows,
    links,
  );
}

// ---- dispatch ----------------------------------------------------------------------------------

export type NotifyDeps = {
  ledger: Pick<MarketsLedger, "getAction" | "listInstruments" | "getRegister" | "listReceipts" | "explorerTxUrl">;
  store: Pick<NotifyStore, "emailFor" | "claim" | "release">;
  send: (email: NotifyEmail) => Promise<void>;
  /** Per-recipient gate (e.g. the user's email preferences). Defaults to allow. */
  allowed?: (email: string) => Promise<boolean>;
  limit: () => boolean;
  siteUrl: string;
};

export type NotifyOutcome = { sent: number; skipped: number; failed: number };

async function deliver(deps: NotifyDeps, actionId: Address, holder: Address, kind: NotifyKind, build: (to: string) => NotifyEmail, out: NotifyOutcome) {
  const to = await deps.store.emailFor(holder);
  if (!to || (deps.allowed && !(await deps.allowed(to)))) return void out.skipped++;
  if (!(await deps.store.claim(actionId, holder, kind))) return void out.skipped++;
  if (!deps.limit()) {
    await deps.store.release(actionId, holder, kind);
    return void out.skipped++;
  }
  try {
    await deps.send(build(to));
    out.sent++;
  } catch {
    out.failed++;
    await deps.store.release(actionId, holder, kind).catch(() => undefined);
  }
}

async function instrumentOf(deps: NotifyDeps, action: CorporateAction) {
  return (await deps.ledger.listInstruments()).find((i) => i.address === action.instrument) ?? null;
}

/** Announcement emails to every Plain investor currently holding the bond. */
export async function notifyAnnounce(deps: NotifyDeps, actionId: Address): Promise<NotifyOutcome> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const action = await deps.ledger.getAction(actionId);
  const instrument = action && (await instrumentOf(deps, action));
  if (!action || !instrument) return out;
  const register = await deps.ledger.getRegister(instrument.mint);
  for (const entry of register.entries) {
    if (!entry.plainInvestor || entry.units <= BigInt(0)) continue;
    await deliver(deps, actionId, entry.holder, "announce", (to) => announceEmail({ to, instrument, action, siteUrl: deps.siteUrl }, entry.units), out);
  }
  return out;
}

/** Payment email to one holder after a confirmed push payment. */
export async function notifyPayment(deps: NotifyDeps, actionId: Address, holder: Address, signature: string): Promise<NotifyOutcome> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  const action = await deps.ledger.getAction(actionId);
  const instrument = action && (await instrumentOf(deps, action));
  if (!action || !instrument) return out;
  const receipt = (await deps.ledger.listReceipts(actionId)).find((r) => r.holder === holder);
  if (!receipt) return out;
  const explorer = deps.ledger.explorerTxUrl(receipt.signature || signature);
  await deliver(deps, actionId, holder, "payment", (to) => paymentEmail({ to, instrument, action, siteUrl: deps.siteUrl }, receipt, explorer), out);
  return out;
}

/**
 * Fire-and-forget hook for the issuer API. Returns immediately; errors are logged, never thrown.
 * `getInstrument` is keyed by mint, so `action.instrument` (the PDA) is resolved by the caller's
 * ledger wrapper (see notify-server.ts).
 */
export function scheduleNotification(deps: () => NotifyDeps | null, op: string, body: { actionId?: unknown; holder?: unknown }, result: { signature: string; actionId?: string }) {
  const run = async () => {
    const d = deps();
    if (!d) return;
    if (op === "announce" && result.actionId) await notifyAnnounce(d, result.actionId);
    else if ((op === "pay" || op === "claim") && typeof body.actionId === "string" && typeof body.holder === "string") {
      await notifyPayment(d, body.actionId, body.holder, result.signature);
    }
  };
  try {
    void run().catch((error) => console.error("[markets] notification email failed:", error instanceof Error ? error.message : error));
  } catch {
    // never reaches the issuer op
  }
}
