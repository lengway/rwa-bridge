import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

export type ReceiptKind =
  | "welcome"
  | "faucet"
  | "bank-embed"
  | "transak"
  | "moonpay"
  | "invest"
  | "redemption"
  | "asset-purchase"
  | "wallet-send"
  | "kzte-topup"
  | "kzte-exchange"
  | "kzte-redeem";

export type Receipt = {
  to: string;
  kind: ReceiptKind;
  amountUsd: number;
  details: string;
  explorerUrl?: string;
  secondaryExplorerUrl?: string;
};

const labels: Record<ReceiptKind, string> = {
  welcome: "Welcome",
  faucet: "Test-token funding",
  "bank-embed": "Legacy demo-bank funding",
  transak: "Legacy Transak test flow",
  moonpay: "Legacy MoonPay test flow",
  invest: "Devnet test deposit",
  redemption: "Historic test-share redemption",
  "asset-purchase": "OFFICE test-token purchase",
  "wallet-send": "Test-token transfer",
  "kzte-topup": "Legacy Intebix test reserve transfer",
  "kzte-exchange": "Legacy KZTE test-token exchange",
  "kzte-redeem": "Legacy KZTE test-token redemption",
};

let transport: Transporter | null = null;

export function isMailerConfigured() {
  return Boolean(
    process.env.SMTP_HOST?.trim()
    && process.env.SMTP_USER?.trim()
    && process.env.SMTP_PASS
    && process.env.MAIL_FROM?.trim()
    && Number.isFinite(Number(process.env.SMTP_PORT)),
  );
}

function getTransport() {
  if (transport) return transport;
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !Number.isFinite(port)) throw new Error("SMTP is not configured");
  transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
  return transport;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function safeExplorerUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "explorer.solana.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function formatUsd(amountUsd: number) {
  const amount = Number.isFinite(amountUsd) && amountUsd > 0 ? amountUsd : 0;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)} TEST UNITS`;
}

export async function sendReceipt({ to, kind, amountUsd, details, explorerUrl, secondaryExplorerUrl }: Receipt) {
  if (!isMailerConfigured()) return;
  const label = labels[kind];
  const formattedAmount = formatUsd(amountUsd);
  const href = safeExplorerUrl(explorerUrl);
  const secondaryHref = safeExplorerUrl(secondaryExplorerUrl);
  const safeDetails = escapeHtml(details);
  const button = href
    ? `<a href="${escapeHtml(href)}" style="display:inline-block;background:#172554;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">Open in Explorer</a>`
    : "";
  const secondaryButton = secondaryHref
    ? `<a href="${escapeHtml(secondaryHref)}" style="display:inline-block;background:#ffffff;color:#172554;text-decoration:none;padding:11px 17px;border:1px solid #cbd5e1;border-radius:8px;font-weight:600">Open second transaction</a>`
    : "";
  const isWelcome = kind === "welcome";
  const isKzte = kind.startsWith("kzte-");
  const networkNote = `${isKzte ? "Solana Devnet · legacy KZTE" : "Solana Devnet · test tokens"} · No monetary value`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6fa;color:#172033;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e8f0;border-radius:14px"><tr><td style="padding:28px"><p style="margin:0 0 24px;color:#64748b;font-size:14px;font-weight:700;letter-spacing:.04em">Plain</p><h1 style="margin:0 0 18px;font-size:24px;line-height:1.3">${isWelcome ? "Welcome to Plain" : escapeHtml(label)}</h1>${isWelcome ? "<p style=\"margin:0 0 20px;color:#475569;line-height:1.6\">Explore Kamino Lend with a Solana Devnet wallet and free test tokens. The app checks your wallet-signed transactions before showing confirmation. Test funds have no monetary value.</p>" : `<p style="margin:0 0 8px;color:#64748b;font-size:13px">Test quantity</p><p style="margin:0 0 20px;font-size:24px;font-weight:700">${formattedAmount}</p><p style="margin:0 0 22px;color:#475569;line-height:1.6">${safeDetails}</p>`}${button ? `<p style="margin:0 0 ${secondaryButton ? 10 : 26}px">${button}</p>` : ""}${secondaryButton ? `<p style="margin:0 0 26px">${secondaryButton}</p>` : ""}<p style="margin:0;padding-top:18px;border-top:1px solid #e4e8f0;color:#64748b;font-size:12px;line-height:1.6">${networkNote}</p></td></tr></table></td></tr></table></body></html>`;
  const text = isWelcome
    ? "Welcome to Plain. Explore Kamino Lend with a Solana Devnet wallet and free test tokens. Transactions are verified before confirmation. Test funds have no monetary value."
    : `Plain — ${label}\nTest quantity: ${formattedAmount}\n${details}${href ? `\nOpen in Explorer: ${href}` : ""}${secondaryHref ? `\nOpen second transaction: ${secondaryHref}` : ""}\n\n${networkNote}`;

  await getTransport().sendMail({
    from: { name: "Plain", address: process.env.MAIL_FROM as string },
    to,
    subject: `${isWelcome ? "Welcome to Plain" : `Plain · ${label}`}`,
    text,
    html,
  });
}

export async function sendLoginCode(to: string, code: string) {
  const formattedCode = `${code.slice(0, 3)} ${code.slice(3)}`;
  const text = `Plain\n\nYour sign-in code: ${formattedCode}\n\nThis code is valid for 10 minutes. If you did not request it, ignore this email.`;
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f4f6fa;color:#172033;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border:1px solid #e4e8f0;border-radius:14px"><tr><td style="padding:28px"><p style="margin:0 0 24px;color:#64748b;font-size:14px;font-weight:700;letter-spacing:.04em">Plain</p><h1 style="margin:0 0 18px;font-size:22px;line-height:1.3">Your sign-in code</h1><p style="margin:0 0 8px;color:#475569;line-height:1.6">Enter this code on the sign-in page:</p><p style="margin:0 0 18px;font-size:32px;font-weight:700;letter-spacing:.16em">${formattedCode}</p><p style="margin:0;color:#64748b;font-size:13px;line-height:1.6">This code is valid for 10 minutes. If you did not request it, ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
  await getTransport().sendMail({
    from: { name: "Plain", address: process.env.MAIL_FROM as string },
    to,
    subject: "Your Plain sign-in code",
    text,
    html,
  });
}
