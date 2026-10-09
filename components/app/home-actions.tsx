"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Plus, ShoppingBag } from "lucide-react";

export function QuickActions({
  onAddMoney,
  onWithdraw,
}: {
  onAddMoney: () => void;
  onWithdraw: () => void;
}) {
  return (
    <section aria-label="Быстрые действия" className="grid grid-cols-4 gap-2">
      <QuickAction label="Пополнить" icon={<Plus />} onClick={onAddMoney} />
      <QuickAction label="Вложить" icon={<ArrowDownToLine />} href="/earn" />
      <QuickAction label="Купить долю" icon={<ShoppingBag />} href="/assets" />
      <QuickAction label="Вывести" icon={<ArrowUpFromLine />} onClick={onWithdraw} />
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
  const className = "group flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground";
  return href ? (
    <Link href={href} className={className}>{content}</Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>{content}</button>
  );
}
