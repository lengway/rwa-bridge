import type { ReactNode } from "react";

export function DetailActionBar({
  amount,
  children,
  note,
}: {
  amount: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="fixed inset-x-4 bottom-[calc(4.25rem_+_max(env(safe-area-inset-bottom),0.5rem))] z-30 mx-auto w-auto max-w-[calc(28rem-2rem)] rounded-[18px] border border-border bg-card p-3 shadow-[0_8px_26px_rgba(15,23,42,0.12)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.42)]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Asset</p>
          <p className="truncate text-sm font-semibold tabular-nums">{amount}</p>
        </div>
        {children}
      </div>
      {note ? <p className="mt-2 text-center text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
