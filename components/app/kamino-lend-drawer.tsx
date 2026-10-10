"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SolanaWallet } from "@crossmint/wallets-sdk";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { DrawerFrame } from "@/components/app/drawer-frame";
import { DrawerSuccess } from "@/components/app/drawer-success";
import {
  type KaminoLendAction,
  type KaminoLendConfirmation,
  type KaminoLendMarket,
  type PreparedKaminoLendAction,
  decimalToAtomic,
  formatAtomicAmount,
  normalizeKaminoLendConfirmation,
  normalizeKaminoLendMarket,
  normalizePreparedKaminoLendAction,
  preparedActionMatchesMarket,
  readKaminoApiError,
} from "@/components/app/kamino-lend-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/useAuth";
import { useDevnet } from "@/lib/useDevnet";

export type KaminoLendDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAction?: KaminoLendAction;
  /** Called only after the server verifies finalized Devnet completion. */
  onConfirmed?: (confirmation: KaminoLendConfirmation) => void;
};

type BusyState = "loading" | "preparing" | "signing" | "confirming" | null;

/**
 * Self-contained client UI for a server-built Kamino Lend Devnet transaction.
 * It does not build, sign, or submit an instruction itself: the API creates
 * and simulates the serialized transaction, and the wallet owns signature.
 */
export function KaminoLendDrawer({
  open,
  onOpenChange,
  initialAction = "deposit",
  onConfirmed,
}: KaminoLendDrawerProps) {
  const { wallet, walletAddress } = useAuth();
  const devnet = useDevnet();
  const [market, setMarket] = useState<KaminoLendMarket | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [action, setAction] = useState<KaminoLendAction>(initialAction);
  const [amount, setAmount] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [prepared, setPrepared] = useState<PreparedKaminoLendAction | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<KaminoLendConfirmation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeWalletAddress = walletAddress ?? devnet.walletAddress;
  const reserve = market?.ready ? market.reserve : null;
  const amountAtomic = useMemo(
    () => reserve ? decimalToAtomic(amount, reserve.decimals) : null,
    [amount, reserve],
  );
  const exceedsMaximum = Boolean(amountAtomic && reserve?.maximumAmountAtomic
    && BigInt(amountAtomic) > BigInt(reserve.maximumAmountAtomic));
  const marketReady = market?.ready === true && market.market !== null && reserve !== null;
  const actionLabel = action === "deposit" ? "Пополнить резерв" : "Вывести из резерва";
  const inputLabel = action === "deposit" ? "Сумма для пополнения" : "Сумма для вывода";
  const canPrepare = marketReady
    && Boolean(wallet)
    && Boolean(activeWalletAddress)
    && Boolean(amountAtomic)
    && !exceedsMaximum
    && accepted
    && !prepared
    && !pendingSignature
    && !busy;

  const resetPreparedAction = useCallback(() => {
    setPrepared(null);
    setPendingSignature(null);
    setConfirmation(null);
    setNotice(null);
    setError(null);
  }, []);

  const loadMarket = useCallback(async (signal?: AbortSignal) => {
    setBusy("loading");
    setError(null);
    try {
      // Route readiness is public and must not depend on an optional balance
      // lookup for the connected wallet. In particular, the Crossmint-wallet
      // link can still be settling immediately after sign-in; coupling it to
      // this read made a healthy Kamino route appear unavailable. Wallet-bound
      // authorization remains enforced by the prepare/confirm endpoints.
      const response = await fetch("/api/kamino/market", { cache: "no-store", signal });
      const payload = await response.json().catch(() => null);
      const nextMarket = normalizeKaminoLendMarket(payload);
      if (signal?.aborted) return;
      if (!nextMarket) throw new KaminoDrawerError("Маршрут Kamino Lend вернул неполные технические данные.", response.status);
      if (!response.ok && nextMarket.ready) throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось проверить маршрут Kamino Lend."), response.status);
      setMarket(nextMarket);
      if (!nextMarket.ready) setNotice(nextMarket.reason ?? "Маршрут Kamino Lend временно недоступен.");
    } catch (requestError) {
      if (isAbortError(requestError)) return;
      setMarket(null);
      setError(userFacingError(requestError, "Не удалось загрузить состояние Kamino Lend."));
    } finally {
      if (!signal?.aborted) setBusy((current) => current === "loading" ? null : current);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadMarket(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadMarket, open]);

  const confirmSubmittedAction = useCallback(async (
    actionToConfirm: PreparedKaminoLendAction,
    signature: string,
  ) => {
    if (!activeWalletAddress) return;
    setBusy("confirming");
    setError(null);
    try {
      const response = await fetch(`/api/kamino/${actionToConfirm.action}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: actionToConfirm.actionId,
          walletAddress: activeWalletAddress,
          signature,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 202) {
        setNotice("Транзакция отправлена в Solana Devnet. Подтверждение ещё обрабатывается — повторите проверку через несколько секунд.");
        return;
      }
      if (!response.ok) throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось подтвердить транзакцию в Kamino Lend."), response.status);

      const nextConfirmation = normalizeKaminoLendConfirmation(
        payload,
        actionToConfirm.action,
        actionToConfirm.actionId,
        signature,
      );
      if (!nextConfirmation) {
        throw new KaminoDrawerError("Сервер ещё не подтвердил завершение транзакции. Повторите проверку, не создавая новую операцию.", 502);
      }

      setConfirmation(nextConfirmation);
      setNotice(null);
      void devnet.refreshPortfolio();
      void loadMarket();
      onConfirmed?.(nextConfirmation);
      toast.success(actionToConfirm.action === "deposit"
        ? "Пополнение Kamino Lend подтверждено в Solana Devnet"
        : "Вывод из Kamino Lend подтверждён в Solana Devnet");
    } catch (requestError) {
      setError(userFacingError(requestError, "Не удалось подтвердить транзакцию. Повторите только проверку подтверждения."));
    } finally {
      setBusy(null);
    }
  }, [activeWalletAddress, devnet, loadMarket, onConfirmed]);

  const prepareAction = async () => {
    if (!marketReady || !amountAtomic || !activeWalletAddress || !wallet || !accepted || exceedsMaximum || busy) return;
    setBusy("preparing");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/kamino/${action}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: activeWalletAddress, amountAtomic, cluster: "devnet" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new KaminoDrawerError(readKaminoApiError(payload, "Не удалось подготовить транзакцию Kamino Lend."), response.status);
      const nextPrepared = normalizePreparedKaminoLendAction(payload, action);
      if (!nextPrepared || !preparedActionMatchesMarket(nextPrepared, market, amountAtomic)) {
        throw new KaminoDrawerError("Сервер вернул транзакцию, которая не совпадает с выбранным Devnet-маршрутом.", 502);
      }
      setPrepared(nextPrepared);
      setNotice("Серверная симуляция пройдена. Проверьте детали операции перед подписью в кошельке.");
    } catch (requestError) {
      setError(userFacingError(requestError, "Не удалось подготовить операцию Kamino Lend."));
    } finally {
      setBusy(null);
    }
  };

  const signAndSendPreparedAction = async () => {
    if (!prepared || !wallet || !activeWalletAddress || busy) return;
    setBusy("signing");
    setError(null);
    try {
      const result = await SolanaWallet.from(wallet).sendTransaction({
        serializedTransaction: prepared.serializedTransaction,
      });
      if (!result.hash) throw new KaminoDrawerError("Кошелёк не вернул подпись транзакции.", 502);
      setPendingSignature(result.hash);
      setNotice("Транзакция отправлена. Проверяем подтверждение в Solana Devnet.");
      await confirmSubmittedAction(prepared, result.hash);
    } catch (requestError) {
      setError(userFacingError(requestError, "Не удалось подписать или отправить транзакцию. Проверьте кошелёк перед повторной попыткой."));
    } finally {
      setBusy(null);
    }
  };

  const verifyPendingConfirmation = async () => {
    if (!prepared || !pendingSignature || busy) return;
    await confirmSubmittedAction(prepared, pendingSignature);
  };

  const changeAction = (nextAction: KaminoLendAction) => {
    if (nextAction === action || busy || prepared || pendingSignature) return;
    setAction(nextAction);
    setAmount("");
    setAccepted(false);
    resetPreparedAction();
  };

  const changeAmount = (value: string) => {
    if (busy || prepared || pendingSignature) return;
    setAmount(value);
    setError(null);
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && !pendingSignature && !busy) resetPreparedAction();
    onOpenChange(nextOpen);
  };

  if (confirmation && reserve) {
    const completedActionLabel = confirmation.action === "deposit" ? "Пополнено" : "Выведено";
    return (
      <DrawerFrame
        open={open}
        onOpenChange={changeOpen}
        title="Kamino Lend · Solana Devnet"
        description="Операция подтверждена в Devnet."
      >
        <DrawerSuccess
          amount={0}
          amountLabel={`${completedActionLabel} ${formatAtomicAmount(prepared?.amountAtomic ?? amountAtomic ?? "0", reserve.decimals)}`}
          sentence={confirmation.action === "deposit"
            ? "Ликвидность внесена в выбранный резерв Kamino Lend."
            : "Ликвидность выведена из выбранного резерва Kamino Lend."}
          note="SOLANA DEVNET · Тестовые токены и позиции не имеют денежной стоимости."
          explorerUrl={confirmation.explorerUrl}
          onDone={() => {
            resetPreparedAction();
            onOpenChange(false);
          }}
          secondaryHref="/portfolio"
          secondaryLabel="Открыть портфель"
        />
      </DrawerFrame>
    );
  }

  return (
    <DrawerFrame
      open={open}
      onOpenChange={changeOpen}
      title="Kamino Lend · Solana Devnet"
      description="On-chain supply и вывод через проверенный Devnet-маршрут."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-1.5" aria-label="Сведения о сети и протоколе">
          <Badge variant="secondary">SOLANA DEVNET</Badge>
          <Badge variant="outline">KAMINO LEND</Badge>
          <Badge variant="outline">USER-SIGNED</Badge>
        </div>

        {busy === "loading" && !market ? <LoadingLine label="Проверяем маршрут Kamino Lend…" /> : null}

        {!market && busy !== "loading" ? (
          <UnavailableRoute error={error} onRetry={() => void loadMarket()} />
        ) : null}

        {market && !market.ready ? (
          <UnavailableRoute error={market.reason} onRetry={() => void loadMarket()} />
        ) : null}

        {marketReady && reserve ? (
          <>
            <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Действие Kamino Lend">
              <ActionTab
                active={action === "deposit"}
                disabled={Boolean(busy || prepared || pendingSignature)}
                icon={<ArrowDownToLine />}
                label="Пополнить"
                onClick={() => changeAction("deposit")}
              />
              <ActionTab
                active={action === "withdraw"}
                disabled={Boolean(busy || prepared || pendingSignature)}
                icon={<ArrowUpFromLine />}
                label="Вывести"
                onClick={() => changeAction("withdraw")}
              />
            </div>

            <RouteSummary market={market} action={action} />

            {market.wallet ? (
              <Card className="gap-2 rounded-xl border-muted-foreground/15 bg-muted/30 p-3 text-xs leading-5">
                <p>
                  Доступно в кошельке: <span className="font-medium text-foreground">{formatAtomicAmount(market.wallet.liquidityBalanceAtomic, reserve.decimals)} Devnet USDC</span>
                </p>
                <p className="text-muted-foreground">
                  Collateral в Kamino: {formatAtomicAmount(market.wallet.collateralBalanceAtomic, reserve.decimals)} cToken. Точная доступная сумма для вывода будет проверена перед подписью.
                </p>
              </Card>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="kamino-lend-amount" className="text-sm font-medium">{inputLabel}</label>
                {reserve.maximumAmountAtomic ? (
                  <span className="text-xs text-muted-foreground">
                    Лимит {formatAtomicAmount(reserve.maximumAmountAtomic, reserve.decimals)}
                  </span>
                ) : null}
              </div>
              <Input
                id="kamino-lend-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(event) => changeAmount(event.target.value)}
                disabled={Boolean(busy || prepared || pendingSignature)}
                className="h-12 text-xl font-semibold tabular-nums"
              />
              {exceedsMaximum ? (
                <p className="text-xs text-destructive">Сумма превышает текущий лимит маршрута.</p>
              ) : null}
              {amount && !amountAtomic ? (
                <p className="text-xs text-destructive">Укажите положительную сумму с точностью до {reserve.decimals} знаков после запятой.</p>
              ) : null}
              {reserve.availableLiquidityAtomic ? (
                <p className="text-xs text-muted-foreground">
                  Ликвидность резерва: {formatAtomicAmount(reserve.availableLiquidityAtomic, reserve.decimals)}. Доступность вывода проверяется сервером перед подписью.
                </p>
              ) : null}
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-5">
              <Checkbox
                checked={accepted}
                onCheckedChange={(checked) => setAccepted(checked === true)}
                disabled={Boolean(busy || prepared || pendingSignature)}
                className="mt-0.5"
              />
              <span>
                Понимаю, что операция выполняется в Solana Devnet: использую тестовые токены, а позиция не имеет денежной стоимости. Перед подписью я увижу сумму, маршрут и результат серверной симуляции.
              </span>
            </label>

            {prepared ? (
              <PreparedActionReview prepared={prepared} reserve={reserve} walletAddress={activeWalletAddress} />
            ) : null}

            {notice ? <Notice>{notice}</Notice> : null}
            {error ? <p className="text-xs leading-5 text-destructive">{error}</p> : null}

            {!activeWalletAddress || !wallet ? (
              <Card className="gap-2 rounded-xl border-amber-500/30 bg-amber-500/5 p-3">
                <p className="text-sm font-medium">Подключите Solana-кошелёк</p>
                <p className="text-xs leading-5 text-muted-foreground">Кошелёк требуется только для подписи уже подготовленной Devnet-транзакции.</p>
              </Card>
            ) : null}

            {pendingSignature && prepared ? (
              <Button className="w-full" onClick={() => void verifyPendingConfirmation()} disabled={Boolean(busy)}>
                {busy === "confirming" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {busy === "confirming" ? "Проверяем подтверждение…" : "Проверить подтверждение"}
              </Button>
            ) : prepared ? (
              <Button className="w-full" onClick={() => void signAndSendPreparedAction()} disabled={Boolean(busy || !wallet)}>
                {busy === "signing" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
                {busy === "signing" ? "Ожидаем подпись…" : `${actionLabel} и подписать`}
              </Button>
            ) : (
              <Button className="w-full" onClick={() => void prepareAction()} disabled={!canPrepare}>
                {busy === "preparing" ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
                {busy === "preparing" ? "Симулируем операцию…" : "Подготовить транзакцию"}
              </Button>
            )}
          </>
        ) : null}
      </div>
    </DrawerFrame>
  );
}

function RouteSummary({ market, action }: { market: KaminoLendMarket; action: KaminoLendAction }) {
  const reserve = market.reserve;
  if (!market.market || !reserve) return null;
  return (
    <Card className="gap-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{action === "deposit" ? "Supply в Kamino Lend" : "Redeem из Kamino Lend"}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {action === "deposit"
              ? "Токен резерва будет направлен в выбранный lending reserve."
              : "Сервер проверит доступность ликвидности и подготовит вывод из выбранного lending reserve."}
          </p>
        </div>
        <Badge variant="secondary">DEVNET</Badge>
      </div>
      <details className="rounded-xl bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Технические детали маршрута</summary>
        <div className="space-y-2 pt-3">
          <RouteRow label="Рынок" value={market.market.name ?? shortenAddress(market.market.address)} />
          <RouteRow label="Reserve" value={shortenAddress(reserve.address)} />
          <RouteRow label="Mint" value={shortenAddress(reserve.mint)} />
          <RouteRow label="Collateral mint" value={shortenAddress(reserve.collateralMint)} />
        </div>
      </details>
    </Card>
  );
}

function PreparedActionReview({
  prepared,
  reserve,
  walletAddress,
}: {
  prepared: PreparedKaminoLendAction;
  reserve: NonNullable<KaminoLendMarket["reserve"]>;
  walletAddress: string | null;
}) {
  return (
    <Card className="gap-3 border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <div>
          <p className="font-medium">Транзакция готова к подписи</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Серверная симуляция завершилась без ошибки. Подпись и отправка выполняются только после вашего следующего действия.</p>
        </div>
      </div>
      <div className="space-y-2 rounded-xl bg-background/70 p-3 text-xs">
        <RouteRow label="Действие" value={prepared.action === "deposit" ? "Пополнение резерва" : "Вывод из резерва"} />
        <RouteRow label="Сумма" value={formatAtomicAmount(prepared.amountAtomic, reserve.decimals)} />
        <RouteRow label="Сеть" value="Solana Devnet" />
        <RouteRow label="Комиссию оплачивает" value={walletAddress ? shortenAddress(walletAddress) : "Подключённый кошелёк"} />
        <RouteRow label="Reserve" value={shortenAddress(prepared.reserve)} />
        {prepared.simulation.unitsConsumed !== null ? <RouteRow label="Compute units" value={prepared.simulation.unitsConsumed.toLocaleString("ru-RU")} /> : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">Перед подтверждением внимательно проверьте сумму, сеть и кошелёк-оплатчик комиссии.</p>
    </Card>
  );
}

function ActionTab({
  active,
  disabled,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-foreground bg-muted" : "hover:bg-muted/40"}`}
    >
      {icon}{label}
    </button>
  );
}

function UnavailableRoute({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 rounded-2xl p-5 text-center">
      <ShieldCheck className="size-5 text-muted-foreground" />
      <div>
        <p className="font-medium">Kamino Lend временно недоступен</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{error ?? "Маршрут Devnet пока не готов к новым операциям."}</p>
      </div>
      <Button variant="outline" onClick={onRetry}><RefreshCw />Обновить</Button>
    </Card>
  );
}

function LoadingLine({ label }: { label: string }) {
  return <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{label}</p>;
}

function RouteRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">{children}</p>;
}

class KaminoDrawerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "KaminoDrawerError";
    this.status = status;
  }
}

function userFacingError(error: unknown, fallback: string) {
  if (isLikelyUserRejection(error)) return "Подтверждение в кошельке отменено. Транзакция не была отправлена.";
  const message = error instanceof Error ? error.message : "";
  if (/insufficient|balance|liquidity/i.test(message)) return "Недостаточно доступного баланса или ликвидности для этой операции.";
  if (/blockhash|expired/i.test(message)) return "Подготовленная транзакция устарела. Подготовьте её заново перед подписью.";
  if (/wallet|session/i.test(message)) return "Не удалось подтвердить подключённый Solana-кошелёк. Перезайдите в аккаунт и повторите попытку.";
  return error instanceof KaminoDrawerError && error.message ? error.message : fallback;
}

function isLikelyUserRejection(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /reject|declin|cancel|denied|abort/i.test(message);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function shortenAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
