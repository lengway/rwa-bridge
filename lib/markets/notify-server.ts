import "server-only";

import path from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

import { getEmailPreferences } from "@/lib/devnet-ledger";
import { isMailerConfigured } from "@/lib/mailer";
import { SITE_URL } from "@/lib/site";
import { NotifyStore, createSendLimiter, notifyEnabled, scheduleNotification, type NotifyDeps, type NotifyEmail } from "./notify";
import { marketsServer } from "./server";

/**
 * Server wiring for corporate-action emails (see notify.ts).
 *
 *   MARKETS_NOTIFY_EMAILS      on | off (default off). Off: no contacts are recorded, nothing is sent.
 *   MARKETS_NOTIFY_STORE_PATH  JSON file for wallet contacts + the sent-log
 *                              (default: next to DEMO_LEDGER_PATH, else .markets-notify.json)
 *   MARKETS_NOTIFY_RATE        max emails per minute (default 30)
 *
 * Uses the same SMTP settings and sender (MAIL_FROM) as the sign-in and receipt emails, on a
 * separate transport instance so login delivery is never affected.
 */

let store: NotifyStore | null = null;
let transport: Transporter | null = null;
const limit = createSendLimiter(Number(process.env.MARKETS_NOTIFY_RATE) || 30);

function notifyStore() {
  const file = process.env.MARKETS_NOTIFY_STORE_PATH
    || (process.env.DEMO_LEDGER_PATH ? path.join(path.dirname(process.env.DEMO_LEDGER_PATH), ".markets-notify.json") : path.join(process.cwd(), ".markets-notify.json"));
  return (store ??= new NotifyStore(file));
}

async function send(email: NotifyEmail) {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim(),
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER?.trim(), pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({ from: { name: "Plain", address: process.env.MAIL_FROM as string }, ...email });
}

/** Records the signed-in user's wallet → email contact (flag on only). Never throws. */
export async function rememberInvestorContact(email: string, wallet: string) {
  if (!notifyEnabled()) return;
  try {
    await notifyStore().setContact(wallet, email.trim().toLowerCase());
  } catch {
    console.error("[markets] could not record notification contact.");
  }
}

function deps(): NotifyDeps | null {
  if (!notifyEnabled() || !isMailerConfigured()) return null;
  const server = marketsServer();
  if (!server) return null;
  server.ledger.changed();
  return {
    ledger: server.ledger,
    store: notifyStore(),
    send,
    allowed: async (email) => (await getEmailPreferences(email)).receiptsEnabled,
    limit,
    siteUrl: SITE_URL,
  };
}

/** Called by the issuer API after a confirmed operation. Returns immediately, never throws. */
export function notifyAfterIssuerOp(op: string, body: { actionId?: unknown; holder?: unknown }, result: { signature: string; actionId?: string }) {
  if (!notifyEnabled()) return;
  scheduleNotification(deps, op, body, result);
}
