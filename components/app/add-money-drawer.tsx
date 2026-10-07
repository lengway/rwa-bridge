"use client";

import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import { CrossmintPath, MercuryoPath, MethodOption, TransakPath } from "@/components/app/onramp-methods";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { ONRAMP_OPTIONS } from "@/lib/onramps";
import { useAppStore } from "@/lib/store";

type SuccessState = {
  amount: number;
  sentence: string;
  note?: string;
};

export function AddMoneyDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { topUp } = useAppStore();
  const [amount, setAmount] = useState("50");
  const [method, setMethod] = useState("crossmint");
  const [processing, setProcessing] = useState(false);
  const [transakWidgetOpen, setTransakWidgetOpen] = useState(false);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const amountValue = Number(amount);
  const valid = Number.isFinite(amountValue) && amountValue >= 1 && amountValue <= 1000;
  const methods = ["crossmint", "transak", "mercuryo", "kaspi", "freedom"]
    .map((id) => ONRAMP_OPTIONS.find((option) => option.id === id))
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  const changeOpen = (nextOpen: boolean) => {
    setSuccess(null);
    setTransakWidgetOpen(false);
    onOpenChange(nextOpen);
  };

  const complete = useCallback((value: number, source: string, sentence: string, note?: string) => {
    setTransakWidgetOpen(false);
    topUp(value, source);
    setSuccess({ amount: value, sentence, note });
    toast.success("Баланс пополнен");
  }, [topUp]);

  const selectAnotherMethod = useCallback(() => {
    setTransakWidgetOpen(false);
    setMethod("");
  }, []);

  const completeTransak = useCallback(
    (value: number) => complete(value, "transak", "Сумма зачислена после оплаты картой."),
    [complete],
  );

  const addMockMoney = () => {
    if (!valid || processing) return;
    setProcessing(true);
    window.setTimeout(() => {
      const source = method === "crossmint" || method === "mercuryo" || method === "transak"
        ? `${method}-demo`
        : method;
      complete(
        amountValue,
        source,
        "Сумма зачислена на демо-баланс.",
        "Деньги не списывались. Это демо-пополнение.",
      );
      setProcessing(false);
    }, 450);
  };

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      fullHeight={transakWidgetOpen}
      title="Пополнить баланс"
      description="Сначала выберите сумму, затем способ. Все суммы показаны в долларах."
    >
      {success ? (
        <DrawerSuccess
          amount={success.amount}
          sentence={success.sentence}
          note={success.note}
          onDone={() => changeOpen(false)}
          secondaryHref="/earn"
          secondaryLabel="Открыть вклад"
        />
      ) : (
        <div className={transakWidgetOpen ? "flex h-full min-h-0 flex-col gap-4" : "space-y-5"}>
          <div className={transakWidgetOpen ? "shrink-0 space-y-3" : "space-y-3"}>
            <label htmlFor="add-amount" className="text-sm font-medium">Сумма</label>
            <div className="flex items-center gap-2">
              <Input
                id="add-amount"
                type="number"
                min="1"
                max="1000"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={transakWidgetOpen}
                className="h-11 text-lg tabular-nums"
              />
              <span className="text-sm font-medium">USD</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[30, 50, 100].map((value) => (
                <Button
                  key={value}
                  type="button"
                  variant={amount === String(value) ? "secondary" : "outline"}
                  onClick={() => setAmount(String(value))}
                  disabled={transakWidgetOpen}
                >
                  ${value}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              ≈ {formatMoney(Number(amount) || 0, "KZT")} по демо-курсу 480 ₸ за $1.
            </p>
          </div>

          {!transakWidgetOpen ? (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Способ пополнения</h3>
              <div className="space-y-2">
                {methods.map((option) => (
                  <MethodOption
                    key={option.id}
                    id={option.id}
                    selected={method === option.id}
                    onSelect={(id) => {
                      setTransakWidgetOpen(false);
                      setMethod(id);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {open && method === "transak" && valid ? (
            <TransakPath
              amount={amountValue}
              onDemo={addMockMoney}
              onComplete={completeTransak}
              onSelectAnotherMethod={selectAnotherMethod}
              onWidgetVisibilityChange={setTransakWidgetOpen}
            />
          ) : null}

          {open && method === "crossmint" && valid ? (
            <CrossmintPath
              amount={amountValue}
              onDemo={addMockMoney}
              onComplete={(value) => complete(value, "crossmint", "Сумма зачислена после оплаты картой.")}
              onSelectAnotherMethod={selectAnotherMethod}
              processing={processing}
            />
          ) : null}
          {open && method === "mercuryo" && valid ? (
            <MercuryoPath amount={amountValue} onDemo={addMockMoney} processing={processing} />
          ) : null}
          {open && (method === "kaspi" || method === "freedom") ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Это концепт. Деньги не списываются, баланс изменится только в демо-режиме.
              </p>
              <Button className="w-full" onClick={addMockMoney} disabled={!valid || processing}>
                <Plus />
                {processing ? "Зачисляем…" : `Продолжить в демо-режиме · ${formatMoney(amountValue || 0)}`}
              </Button>
            </div>
          ) : null}
          {!valid ? (
            <p className="text-xs text-destructive">Введите сумму от $1 до $1 000.</p>
          ) : null}
        </div>
      )}
    </DrawerFrame>
  );
}
