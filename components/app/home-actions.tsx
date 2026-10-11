"use client";

import Link from "next/link";
import { Activity, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";

export function QuickActions() {
  return (
    <section aria-label="Quick actions" className="grid grid-cols-3 gap-2">
      <QuickAction label="Add to Earn" icon={<ArrowDownToLine />} href="/earn/kamino-lend?action=deposit" />
      <QuickAction label="Withdraw" icon={<ArrowUpFromLine />} href="/earn/kamino-lend?action=withdraw" />
      <QuickAction label="Activity" icon={<Activity />} href="/activity" />
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
      <span className="flex size-14 items-center justify-center rounded-full bg-muted transition-colors group-hover:bg-accent [&_svg]:size-5">
        {icon}
      </span>
      <span className="text-center text-[11px] font-medium leading-tight">{label}</span>
    </>
  );
  const className = "group flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl px-1 py-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  );
}
