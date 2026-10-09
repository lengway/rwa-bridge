"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";

export function DrawerSuccess({
  amount,
  currency = "USD",
  sentence,
  onDone,
  secondaryHref,
  secondaryLabel,
  note,
  explorerUrl,
  secondaryExplorerUrl,
  amountLabel,
}: {
  amount: number;
  currency?: "USD" | "KZT";
  sentence: string;
  onDone: () => void;
  secondaryHref: string;
  secondaryLabel: string;
  note?: string;
  explorerUrl?: string;
  secondaryExplorerUrl?: string;
  amountLabel?: string;
}) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        <Check className="size-7" />
      </span>
      <div className="space-y-1">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {amountLabel ?? formatMoney(amount, currency)}
        </p>
        <p className="text-sm leading-5 text-muted-foreground">{sentence}</p>
      </div>
      {note ? <p className="max-w-xs text-xs leading-5 text-muted-foreground">{note}</p> : null}
      <div className="mt-2 grid w-full gap-2">
        <Button className="w-full" onClick={onDone}>Готово</Button>
        {explorerUrl ? (
          <div className="grid gap-2">
            <Button
              variant="outline"
              className="w-full"
              nativeButton={false}
              render={<a href={explorerUrl} target="_blank" rel="noopener noreferrer" />}
            >
              Открыть подтверждение в обозревателе
            </Button>
            {secondaryExplorerUrl ? (
              <Button
                variant="outline"
                className="w-full"
                nativeButton={false}
                render={<a href={secondaryExplorerUrl} target="_blank" rel="noopener noreferrer" />}
              >
                Открыть зачисление в обозревателе
              </Button>
            ) : null}
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href={secondaryHref} />}
          >
            {secondaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
