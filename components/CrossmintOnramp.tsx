"use client";

import { useEffect, useRef, useState } from "react";
import {
  CrossmintCheckoutProvider,
  CrossmintEmbeddedCheckout,
  useCrossmintCheckout,
} from "@crossmint/client-sdk-react-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Order = { orderId: string; clientSecret: string };

export function CrossmintOnramp({
  walletAddress,
  email,
  amountUsd,
  onCompleted,
}: {
  walletAddress: string;
  email: string;
  amountUsd: number;
  onCompleted: (amount: number) => void;
}) {
  const amount = String(amountUsd);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const createOrder = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onramp-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, email, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok || !data.orderId || !data.clientSecret) throw new Error(data.error ?? "заказ не создан");
      setOrder({ orderId: data.orderId, clientSecret: data.clientSecret });
    } catch (err) {
      setError(err instanceof Error ? err.message : "ошибка");
    } finally {
      setLoading(false);
    }
  };

  if (order) {
    return (
      <CrossmintCheckoutProvider>
        <div className="rounded-xl border bg-background p-2">
          <CrossmintEmbeddedCheckout
            orderId={order.orderId}
            clientSecret={order.clientSecret}
            payment={{ receiptEmail: email, crypto: { enabled: false }, fiat: { enabled: true }, defaultMethod: "fiat" }}
          />
        </div>
        <CompletionWatcher onCompleted={() => onCompleted(amountUsd)} />
        <p className="mt-2 text-xs text-muted-foreground">
          Тестовый режим: карта 4242 4242 4242 4242, любая будущая дата и CVC.
        </p>
      </CrossmintCheckoutProvider>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-3 text-sm">
        Сумма заказа
        <div className="flex w-32 items-center gap-2">
          <Input type="number" value={amountUsd} readOnly aria-label="Сумма заказа в долларах" />
          <span className="text-xs text-muted-foreground">USD</span>
        </div>
      </label>
      <Button
        onClick={createOrder}
        disabled={loading}
        className="self-start"
      >
        {loading ? "Создаём заказ…" : `Пополнить картой на $${amountUsd}`}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function CompletionWatcher({ onCompleted }: { onCompleted: () => void }) {
  const { order } = useCrossmintCheckout();
  const fired = useRef(false);
  useEffect(() => {
    if (order?.phase === "completed" && !fired.current) {
      fired.current = true;
      onCompleted();
    }
  }, [order?.phase, onCompleted]);
  return null;
}
