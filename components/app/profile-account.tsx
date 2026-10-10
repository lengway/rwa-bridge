"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, LogOut, Send, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatQuantity } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { useDevnet } from "@/lib/useDevnet";
import { useAuth } from "@/lib/useAuth";

export function AccountSection() {
  return <AccountSectionReady />;
}

function AccountSectionReady() {
  const { signOut, email, status } = useAuth();
  const [busy, setBusy] = useState(false);
  const loggedIn = status === "signed-in";

  const handleLogout = async () => {
    setBusy(true);
    try {
      await signOut();
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
          <p className="text-sm text-muted-foreground">{email ?? "Вы вошли"}</p>
          <Button variant="outline" onClick={handleLogout} disabled={busy}>
            <LogOut />{busy ? "Выходим…" : "Выйти"}
          </Button>
        </>
      ) : <p className="text-sm text-muted-foreground">Сессия аккаунта не активна.</p>}
    </Card>
  );
}

function shortWalletAddress(address: string) {
  return address.length > 18 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

export function WalletSection() {
  return <WalletSectionReady />;
}

function WalletSectionReady() {
  const { wallet } = useAuth();
  const devnet = useDevnet();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("10");
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{ signature: string; recipient: string; amountTestQuote: number } | null>(null);
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
    if (!wallet || !devnet.usdMint || (!pendingTransfer && (!recipientValid || !amountValid)) || sending) return;
    setSending(true);
    setSendError(null);
    try {
      let transfer = pendingTransfer;
      if (!transfer) {
        setSendProgress("Подписываем перевод…");
        const transaction = await wallet.send(recipient.trim(), devnet.usdMint, String(amountValue));
        if (!transaction.hash) throw new Error("Кошелёк не вернул подпись перевода.");
        transfer = { signature: transaction.hash, recipient: recipient.trim(), amountTestQuote: amountValue };
        setPendingTransfer(transfer);
      }
      setSendProgress("Подтверждаем в сети…");
      const response = await fetch("/api/devnet/wallet-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          recipientAddress: transfer.recipient,
          // The legacy endpoint retains this field name for compatibility; the
          // value is an app-controlled Devnet test quantity, never USD.
          amountUsd: transfer.amountTestQuote,
          signature: transfer.signature,
        }),
      });
      const result = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
      if (!response.ok || result?.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : "Перевод пока не подтверждён в Solana devnet.");
      }
      void devnet.refreshPortfolio();
      setPendingTransfer(null);
      setRecipient("");
      setAmount("10");
      toast.success("Тестовые единицы отправлены");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setSendError(/[А-Яа-яЁё]/.test(message) ? message : "Не удалось подтвердить перевод. Повторите проверку через несколько секунд.");
    } finally {
      setSending(false);
      setSendProgress(null);
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
              <p className="font-mono text-xs leading-5" title={address}>{shortWalletAddress(address)}</p>
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
                      rel="noopener noreferrer"
                    />
                  }
                >
                  Открыть в Solana Explorer
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Сеть: Solana devnet. Адрес не нужен для обычной работы в приложении.
              </p>
              <Card className="gap-3 rounded-2xl p-4">
                  <div>
                    <h3 className="font-medium">Отправить на другой кошелёк</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Переведите app-controlled TEST QUOTE на любой адрес Solana. Перевод имеет значение только в Devnet-демо.
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
                      disabled={sending || Boolean(pendingTransfer)}
                    />
                  </label>
                  {recipient.length > 0 && !recipientValid ? (
                    <p className="text-xs text-destructive">Проверьте адрес Solana.</p>
                  ) : null}
                  <label className="space-y-1.5 text-sm">
                    <span>Сумма в TEST QUOTE</span>
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={balance}
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      disabled={sending || Boolean(pendingTransfer)}
                    />
                  </label>
                  {amountValue > balance ? (
                    <p className="text-xs text-destructive">
                      Недостаточно средств. <Link href="/home" className="underline">Пополнить баланс</Link>.
                    </p>
                  ) : null}
                  {sendError ? <p className="text-xs text-destructive">{sendError}</p> : null}
                  <Button className="w-full" onClick={sendTokens} disabled={sending || (!pendingTransfer && (!recipientValid || !amountValid))}>
                    <Send />{sending ? (sendProgress ?? "Отправляем…") : pendingTransfer ? "Повторить подтверждение" : `Отправить ${formatQuantity(amountValue || 0)} TEST QUOTE`}
                  </Button>
                  <p className="text-xs text-muted-foreground">DEVNET DEMO · NO MONETARY VALUE. Подтверждённая подпись появляется только после реального перевода в Solana Devnet.</p>
              </Card>
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
