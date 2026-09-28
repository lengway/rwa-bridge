"use client";

import { useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import type { BridgeAsset } from "@/lib/assets";
import { isCrossmintConfigured } from "@/lib/config";

export function AssetCard({ asset }: { asset: BridgeAsset }) {
  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{asset.logoEmoji}</span>
          <div>
            <p className="font-medium">{asset.name}</p>
            <p className="text-xs text-zinc-500">{asset.ticker} · {asset.sourceLabel}</p>
          </div>
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{asset.description}</p>
      <AssetAction asset={asset} />
    </div>
  );
}

function AssetAction({ asset }: { asset: BridgeAsset }) {
  if (asset.buyFlow === "not-wired") {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-500">
        покупка пока не подключена — нужен проверенный адрес контракта и маршрут свопа
      </p>
    );
  }
  if (asset.buyFlow === "crossmint-checkout") {
    return <MintDemoButton asset={asset} />;
  }
  return null;
}

function MintDemoButton({ asset }: { asset: BridgeAsset }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!isCrossmintConfigured) {
    return (
      <button disabled className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm text-zinc-400 cursor-not-allowed self-start">
        купить — добавь Crossmint-ключ
      </button>
    );
  }

  return <MintDemoButtonReady asset={asset} state={state} setState={setState} message={message} setMessage={setMessage} />;
}

function MintDemoButtonReady({
  asset,
  state,
  setState,
  message,
  setMessage,
}: {
  asset: BridgeAsset;
  state: "idle" | "loading" | "done" | "error";
  setState: (s: "idle" | "loading" | "done" | "error") => void;
  message: string | null;
  setMessage: (m: string | null) => void;
}) {
  const { wallet } = useWallet();

  const handleBuy = async () => {
    if (!wallet) {
      setMessage("сначала войди через кнопку выше");
      setState("error");
      return;
    }
    setState("loading");
    setMessage(null);
    try {
      const res = await fetch("/api/mint-demo-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientAddress: wallet.address, assetId: asset.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "ошибка минта");
      setState("done");
      setMessage(data.message ?? "готово");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "ошибка");
    }
  };

  return (
    <div className="flex flex-col gap-2 items-start">
      <button
        onClick={handleBuy}
        disabled={state === "loading"}
        className="rounded-full bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {state === "loading" ? "отправляем..." : "купить долю (демо-минт)"}
      </button>
      {message && (
        <p className={`text-xs ${state === "error" ? "text-red-500" : "text-emerald-600 dark:text-emerald-500"}`}>
          {message}
        </p>
      )}
    </div>
  );
}
