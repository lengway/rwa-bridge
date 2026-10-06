"use client";

import { useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { useBalance } from "@/lib/mockBalance";
import { isCrossmintConfigured } from "@/lib/config";
import { ONRAMP_OPTIONS, buildMercuryoUrl, isMercuryoConfigured } from "@/lib/onramps";
import { CrossmintOnramp } from "@/components/CrossmintOnramp";

export function OnrampButton() {
  if (!isCrossmintConfigured) return <OnrampPicker address={undefined} email={undefined} />;
  return <OnrampPickerWithWallet />;
}

function OnrampPickerWithWallet() {
  const { wallet } = useWallet();
  const { user } = useCrossmintAuth();
  return <OnrampPicker address={wallet?.address} email={user?.email} />;
}

function OnrampPicker({ address, email }: { address: string | undefined; email: string | undefined }) {
  const { addFunds } = useBalance();
  const [selected, setSelected] = useState(ONRAMP_OPTIONS[0].id);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const option = ONRAMP_OPTIONS.find((o) => o.id === selected) ?? ONRAMP_OPTIONS[0];
  const crossmintReady = option.id === "crossmint" && isCrossmintConfigured && !!address && !!email;
  const mercuryoReady = option.id === "mercuryo" && isMercuryoConfigured && !!address;

  const mockCredit = () => {
    setLoading(true);
    setNote(null);
    setTimeout(() => {
      addFunds(50);
      setLoading(false);
      setNote(
        option.kind === "concept"
          ? "Демо-зачисление: этот способ показан как концепт, реальной интеграции нет."
          : "Демо-зачисление: войди по email (и добавь ключи), чтобы платить по-настоящему.",
      );
    }, 500);
  };

  const handleClick = () => {
    if (mercuryoReady) {
      window.open(buildMercuryoUrl(address!), "_blank", "noopener,noreferrer");
      setNote("Открыли виджет Mercuryo. Реальное зачисление придёт на кошелёк, демо-баланс не меняется.");
      return;
    }
    mockCredit();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {ONRAMP_OPTIONS.map((o) => (
          <label
            key={o.id}
            className={`rounded-xl border p-3 flex gap-3 cursor-pointer text-sm ${
              selected === o.id ? "border-foreground" : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <input
              type="radio"
              name="onramp"
              checked={selected === o.id}
              onChange={() => {
                setSelected(o.id);
                setNote(null);
              }}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {o.name}
                {o.kind === "concept" && <span className="ml-2 text-xs text-amber-600 dark:text-amber-500">концепт</span>}
              </span>
              <span className="text-xs text-zinc-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {crossmintReady ? (
        <CrossmintOnramp
          walletAddress={address!}
          email={email!}
          onCompleted={(amount) => {
            addFunds(amount);
            setNote(`Оплата прошла: $${amount} USDC зачислены на кошелёк (devnet).`);
          }}
        />
      ) : (
        <button
          onClick={handleClick}
          disabled={loading}
          className="rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 self-start"
        >
          {loading ? "зачисляем..." : mercuryoReady ? "Пополнить через Mercuryo" : "Пополнить на $50 (демо)"}
        </button>
      )}
      {note && <p className="text-xs text-zinc-500">{note}</p>}
    </div>
  );
}
