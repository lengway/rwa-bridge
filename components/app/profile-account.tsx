"use client";

import { useState } from "react";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Copy, LogIn, LogOut, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { isCrossmintConfigured } from "@/lib/config";

export function AccountSection() {
  if (!isCrossmintConfigured) {
    return (
      <Card className="gap-3 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Аккаунт</h2>
          <Badge variant="secondary">Демо</Badge>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          Вход не нужен: приложение работает с демо-данными на этом устройстве.
        </p>
      </Card>
    );
  }
  return <AccountSectionReady />;
}

function AccountSectionReady() {
  const { login, logout, user, status } = useCrossmintAuth();
  const [busy, setBusy] = useState(false);
  const loggedIn = status === "logged-in";

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logout();
      toast.success("Вы вышли из аккаунта");
    } catch {
      toast.error("Не удалось выйти. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="gap-3 rounded-2xl p-4">
      <h2 className="font-semibold">Аккаунт</h2>
      {loggedIn ? (
        <>
          <p className="text-sm text-muted-foreground">{user?.email ?? "Вы вошли"}</p>
          <Button variant="outline" onClick={handleLogout} disabled={busy}>
            <LogOut />{busy ? "Выходим…" : "Выйти"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm leading-5 text-muted-foreground">
            Войдите по email, чтобы подключить оплату картой и демо-покупки.
          </p>
          <Button
            onClick={login}
            disabled={status === "in-progress" || status === "initializing"}
          >
            <LogIn />{status === "in-progress" ? "Загружаем…" : "Войти по email"}
          </Button>
        </>
      )}
    </Card>
  );
}

export function WalletSection() {
  if (!isCrossmintConfigured) {
    return (
      <Collapsible>
        <Card className="rounded-2xl p-0">
          <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left font-medium">
            <WalletCards className="size-4" />
            <span className="flex-1">Кошелёк</span>
            <Badge variant="outline">Для продвинутых</Badge>
          </CollapsibleTrigger>
          <CollapsibleContent className="border-t p-4 text-sm leading-5 text-muted-foreground">
            Адрес появится после настройки входа. Для обычной работы он не нужен.
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }
  return <WalletSectionReady />;
}

function WalletSectionReady() {
  const { wallet } = useWallet();
  const address = wallet?.address;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Адрес скопирован");
    } catch {
      toast.error("Не удалось скопировать адрес");
    }
  };

  return (
    <Collapsible>
      <Card className="rounded-2xl p-0">
        <CollapsibleTrigger className="flex w-full items-center gap-2 p-4 text-left font-medium">
          <WalletCards className="size-4" />
          <span className="flex-1">Кошелёк</span>
          <Badge variant="outline">Для продвинутых</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 border-t p-4">
          {address ? (
            <>
              <p className="break-all font-mono text-xs leading-5">{address}</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={copyAddress}>
                  <Copy />Копировать
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href={`https://explorer.solana.com/address/${address}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  Открыть в Solana Explorer
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Сеть: Solana devnet. Адрес не нужен для обычной работы в приложении.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Войдите по email, чтобы получить адрес.
            </p>
          )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
