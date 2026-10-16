"use client";

import { ChevronDown, FileCode2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { downloadText } from "@/lib/markets/csv";
import { SEEV_031, SEEV_036, buildMovementConfirmations, buildNotification, isoFilename, paidReceipts, supportsIso20022 } from "@/lib/markets/iso20022";
import type { CorporateAction, EntitlementSheet, Instrument, LedgerSource } from "@/lib/markets/service";
import { pillButton } from "./primitives";
import { iconButton } from "./disclosure";

const XML = "application/xml;charset=utf-8";

/** Read-only "Export ISO 20022" menu: seev.031 notification and seev.036 confirmations, built in the browser from public data. */
export function Iso20022Export({ action, instrument, sheet, source, compact }: { action: CorporateAction; instrument: Instrument; sheet: EntitlementSheet | null; source?: Pick<LedgerSource, "cluster" | "kind">; compact?: boolean }) {
  if (!supportsIso20022(action)) return null;
  const ctx = { action, instrument, source };
  const paid = sheet ? paidReceipts(sheet).length : 0;

  return (
    <DropdownMenu>
      {compact ? (
        <DropdownMenuTrigger className={iconButton} aria-label="Export ISO 20022" title="Export ISO 20022">
          <FileCode2 className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger className={pillButton}>
          <FileCode2 className="size-4" aria-hidden="true" /> ISO 20022 <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Export ISO 20022 (from on-chain data)</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => downloadText(isoFilename(instrument, action, "seev031"), buildNotification(ctx), XML)}>
            <span className="flex flex-col">
              <span>Notification</span>
              <span className="text-xs text-muted-foreground">{SEEV_031} · announced terms</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!sheet || paid === 0} onClick={() => sheet && downloadText(isoFilename(instrument, action, "seev036"), buildMovementConfirmations(ctx, sheet).xml, XML)}>
            <span className="flex flex-col">
              <span>Movement confirmations</span>
              <span className="text-xs text-muted-foreground">
                {SEEV_036} · {paid === 0 ? "available once holders are paid" : `${paid} paid holder${paid === 1 ? "" : "s"}, one message each`}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">Security identified by its mint (no ISIN). Devnet test-token amounts. Not XSD-validated.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
