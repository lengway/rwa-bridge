"use client";

import { useState } from "react";
import { useWallet } from "@crossmint/client-sdk-react-ui";
import { useBalance } from "@/lib/mockBalance";
import { isCrossmintConfigured } from "@/lib/config";
import { ONRAMP_OPTIONS, buildMercuryoUrl, isMercuryoConfigured } from "@/lib/onramps";

export function OnrampButton() {
  if (!isCrossmintConfigured) return <OnrampPicker address={undefined} />;
  return <OnrampPickerWithWallet />;
}

function OnrampPickerWithWallet() {
  const { wallet } = useWallet();
  return <OnrampPicker address={wallet?.address} />;
}

function OnrampPicker({ address }: { address: string | undefined }) {
  const { addFunds } = useBalance();
  const [selected, setSelected] = useState(ONRAMP_OPTIONS[0].id);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const option = ONRAMP_OPTIONS.find((o) => o.id === selected) ?? ONRAMP_OPTIONS[0];
  const realFlow = option.id === "mercuryo" && isMercuryoConfigured && !!address;

  const handleClick = () => {
    if (realFlow) {
      window.open(buildMercuryoUrl(address!), "_blank", "noopener,noreferrer");
      setNote("Открыли виджет провайдера. Реальное зачисление придёт на кошелёк, демо-баланс ниже не меняется.");
      return;
    }
    setLoading(true);
    setNote(null);
    setTimeout(() => {
      addFunds(50);
      setLoading(false);
      setNote(
        option.id === "mercuryo"
          ? "Демо-зачисление: ключ провайдера или вход пока не настроены."
          : "Демо-зачисление: этот способ показан как концепт, реальной интеграции нет.",
      );
    }, 500);
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
            <input type="radio" name="onramp" checked={selected === o.id} onChange={() => setSelected(o.id)} />
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
      <button
        onClick={handleClick}
        disabled={loading}
        className="rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 self-start"
      >
        {loading ? "зачисляем..." : realFlow ? "Пополнить через провайдера" : "Пополнить на $50 (демо)"}
      </button>
      {note && <p className="text-xs text-zinc-500">{note}</p>}
    </div>
  );
}
