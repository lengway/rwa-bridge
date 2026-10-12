"use client";

import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export function QuickActions({ onInvest, onWithdraw }: { onInvest?: () => void; onWithdraw?: () => void }) {
  if (!onInvest && !onWithdraw) return (
    <section aria-label="Quick actions" className="grid grid-cols-3 gap-2">
      <QuickAction label="Add to Earn" icon={<ArrowDownToLine />} href="/earn/kamino-lend?action=deposit" compact={false} />
      <QuickAction label="Withdraw" icon={<ArrowUpFromLine />} href="/earn/kamino-lend?action=withdraw" compact={false} />
      <QuickAction label="Activity" icon={<Activity />} href="/activity" compact={false} />
    </section>
  );
  return (
    <section aria-label="Invest or withdraw" className="grid grid-cols-2 gap-3">
      <QuickAction label="Invest" icon={<ArrowDownToLine />} onClick={onInvest} href={onInvest ? undefined : "/earn/kamino-lend?action=deposit"} />
      <QuickAction label="Withdraw" icon={<ArrowUpFromLine />} onClick={onWithdraw} href={onWithdraw ? undefined : "/earn/kamino-lend?action=withdraw"} />
    </section>
  );
}

function QuickAction({
  label,
  icon,
  href,
  onClick,
  compact = true,
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  compact?: boolean;
}) {
  const content = (
    <>
      <span className={compact ? "[&_svg]:size-4" : "flex size-14 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-accent [&_svg]:size-5"}>
        {icon}
      </span>
      <span className={compact ? "text-sm font-semibold" : "text-center text-[11px] font-medium leading-tight"}>{label}</span>
    </>
  );
  const className = compact ? `group flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${label === "Invest" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border bg-background text-foreground hover:bg-muted"}` : "group flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl px-1 py-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  );
}
