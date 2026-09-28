"use client";

import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { isCrossmintConfigured } from "@/lib/config";

export function LoginPanel() {
  if (!isCrossmintConfigured) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-600 dark:text-zinc-400">
        Добавь NEXT_PUBLIC_CROSSMINT_API_KEY в .env.local, чтобы включить вход и кошелёк. Ставинг-ключ даёт тестнет бесплатно.
      </div>
    );
  }
  return <LoginPanelReady />;
}

function LoginPanelReady() {
  const { login, logout, user, status } = useCrossmintAuth();
  const { wallet, status: walletStatus } = useWallet();

  if (status === "in-progress" || status === "initializing") {
    return <p className="text-sm text-zinc-500">Загружаем...</p>;
  }

  if (status !== "logged-in" || !user) {
    return (
      <button
        onClick={login}
        className="rounded-full bg-foreground text-background px-5 py-3 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        Войти по email — без сид-фразы
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        <span>{user.email ?? "вошёл"}</span>
      </div>
      <div className="text-zinc-500">
        {walletStatus === "in-progress" && "создаём кошелёк..."}
        {walletStatus === "loaded" && wallet && (
          <span className="font-mono break-all">{wallet.address}</span>
        )}
      </div>
      <button onClick={logout} className="self-start text-zinc-500 underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100">
        выйти
      </button>
    </div>
  );
}
