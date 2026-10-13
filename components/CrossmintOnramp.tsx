"use client";

import { useEffect, useRef, useState } from "react";
import {
  CrossmintCheckoutProvider,
  CrossmintEmbeddedCheckout,
  useCrossmintCheckout,
} from "@crossmint/client-sdk-react-ui";
import { Button } from "@/components/ui/button";
import { ProviderSheet } from "@/components/app/provider-sheet";

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
  const [orderAmount, setOrderAmount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const creating = useRef(false);

  const createOrder = async () => {
    if (creating.current) return;
    if (order && orderAmount === amountUsd) {
      setSheetOpen(true);
      return;
    }
    creating.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/onramp-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, email, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok || !data.orderId || !data.clientSecret) throw new Error(data.error ?? "order was not created");
      setOrder({ orderId: data.orderId, clientSecret: data.clientSecret });
      setOrderAmount(amountUsd);
      setSheetOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "error");
    } finally {
      creating.current = false;
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={createOrder}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Creating order…" : `Open card payment · $${amountUsd}`}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ProviderSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Crossmint"
        testData={<p>Sandbox: card 4242 4242 4242 4242, any future date and CVC.</p>}
      >
        {order ? (
          <CrossmintCheckoutProvider>
            <div className="h-full min-h-0 w-full overflow-auto bg-white">
              <CrossmintEmbeddedCheckout
                orderId={order.orderId}
                clientSecret={order.clientSecret}
                payment={{ receiptEmail: email, crypto: { enabled: false }, fiat: { enabled: true }, defaultMethod: "fiat" }}
              />
            </div>
            <CompletionWatcher onCompleted={() => {
              setSheetOpen(false);
              onCompleted(amountUsd);
            }} />
          </CrossmintCheckoutProvider>
        ) : null}
      </ProviderSheet>
    </>
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
