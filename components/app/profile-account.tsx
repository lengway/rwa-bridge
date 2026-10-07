"use client";

import { useState } from "react";
import Link from "next/link";
import { useCrossmintAuth, useWallet } from "@crossmint/client-sdk-react-ui";
import { Copy, LogIn, LogOut, Send, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { isCrossmintConfigured } from "@/lib/config";
import { useAppStore } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { useDevnet } from "@/lib/useDevnet";

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
  const devnet = useDevnet();
  const { recordWalletSend } = useAppStore();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("10");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const address = wallet?.address;
  const amountValue = Number(amount);
  const recipientValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient.trim());
  const balance = devnet.onchain?.usd ?? 0;
  const amountValid = Number.isFinite(amountValue) && amountValue >= 0.01 && amountValue <= balance;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Адрес скопирован");
    } catch {
      toast.error("Не удалось скопировать адрес");
    }
  };

  const sendTokens = async () => {
    if (!wallet || !devnet.usdMint || !recipientValid || !amountValid || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const transaction = await wallet.send(recipient.trim(), devnet.usdMint, String(amountValue));
      const signature = transaction.hash;
      const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
      recordWalletSend(amountValue, signature, explorer);
      void devnet.refresh();
      setRecipient("");
      setAmount("10");
      toast.success("Тестовые доллары отправлены");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSendError(/[А-Яа-яЁё]/.test(message) ? message : "Перевод не выполнен. Проверьте адрес и баланс тестовых долларов.");
    } finally {
      setSending(false);
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
              {devnet.mode === "devnet" ? (
                <Card className="gap-3 rounded-2xl p-4">
                  <div>
                    <h3 className="font-medium">Отправить на другой кошелёк</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Переведите тестовые доллары на любой адрес Solana devnet.
                    </p>
                  </div>
                  <label className="space-y-1.5 text-sm">
                    <span>Адрес получателя</span>
                    <Input
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="Адрес Solana"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  {recipient.length > 0 && !recipientValid ? (
                    <p className="text-xs text-destructive">Проверьте адрес Solana.</p>
                  ) : null}
                  <label className="space-y-1.5 text-sm">
                    <span>Сумма в USD</span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={balance}
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </label>
                  {amountValue > balance ? (
                    <p className="text-xs text-destructive">
                      Недостаточно средств. <Link href="/home" className="underline">Пополнить через тестовый банкомат</Link>.
                    </p>
                  ) : null}
                  {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
                  <Button className="w-full" onClick={sendTokens} disabled={!recipientValid || !amountValid || sending}>
                    <Send />{sending ? "Отправляем…" : `Отправить ${formatMoney(amountValue || 0)}`}
                  </Button>
                </Card>
              ) : null}
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
