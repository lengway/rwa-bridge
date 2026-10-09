import "server-only";

import { randomUUID } from "node:crypto";
import { getVerifiedEmailFromRequest } from "@/lib/auth-server";
import { claimWelcomeEmail, reserveEmailReceipt } from "@/lib/devnet-ledger";
import { isMailerConfigured, sendReceipt, type Receipt } from "@/lib/mailer";

let skippedForMissingSmtp = false;

function logMissingSmtpOnce() {
  if (skippedForMissingSmtp) return;
  skippedForMissingSmtp = true;
  console.info("Plain: transactional email skipped (SMTP is not configured).");
}

export function notifyReceipt(request: Request, receipt: Omit<Receipt, "to"> & { receiptId?: string }) {
  void (async () => {
    if (!isMailerConfigured()) {
      logMissingSmtpOnce();
      return;
    }
    const email = await getVerifiedEmailFromRequest(request);
    if (!email || !(await reserveEmailReceipt(email, receipt.receiptId ?? randomUUID()))) return;
    await sendReceipt({ ...receipt, to: email });
  })().catch(() => console.error("Plain: transactional email could not be sent."));
}

export async function notifyWelcome(request: Request) {
  try {
    if (!isMailerConfigured()) {
      logMissingSmtpOnce();
      return false;
    }
    const email = await getVerifiedEmailFromRequest(request);
    if (!email || !(await claimWelcomeEmail(email))) return false;
    void sendReceipt({
      to: email,
      kind: "welcome",
      amountUsd: 0,
      details: "Добро пожаловать в Plain.",
    }).catch(() => console.error("Plain: welcome email could not be sent."));
    return true;
  } catch {
    console.error("Plain: welcome email could not be scheduled.");
    return false;
  }
}
