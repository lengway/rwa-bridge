"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export function QuickActions({ onInvest, onWithdraw }: { onInvest?: () => void; onWithdraw?: () => void }) {
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
}: {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="[&_svg]:size-4">
        {icon}
      </span>
      <span className="text-sm font-semibold">{label}</span>
    </>
  );
  const className = `group flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${label === "Invest" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border bg-background text-foreground hover:bg-muted"}`;
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  );
}
