"use client";

import { useEffect, useRef, useState } from "react";
import {
  CrossmintCheckoutProvider,
  CrossmintEmbeddedCheckout,
  useCrossmintCheckout,
} from "@crossmint/client-sdk-react-ui";

type Order = { orderId: string; clientSecret: string };

export function CrossmintOnramp({
  walletAddress,
  email,
  onCompleted,
}: {
  walletAddress: string;
  email: string;
  onCompleted: (amount: number) => void;
}) {
  const [amount, setAmount] = useState("5");
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
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
          <CrossmintEmbeddedCheckout
            orderId={order.orderId}
            clientSecret={order.clientSecret}
            payment={{ receiptEmail: email, crypto: { enabled: false }, fiat: { enabled: true }, defaultMethod: "fiat" }}
          />
        </div>
        <CompletionWatcher onCompleted={() => onCompleted(Number(amount))} />
        <p className="text-xs text-zinc-500 mt-2">Staging: тестовая карта 4242 4242 4242 4242, любой будущий срок и CVC.</p>
      </CrossmintCheckoutProvider>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm">
        Сумма, $
        <input
          type="number"
          min={1}
          max={1000}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 py-1"
        />
      </label>
      <button
        onClick={createOrder}
        disabled={loading}
        className="self-start rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "создаём заказ..." : "Пополнить картой"}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
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
