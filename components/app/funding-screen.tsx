"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  LoaderCircle,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useDevnet } from "@/lib/useDevnet";
import {
  isSandboxWidgetUrl,
  type FundingMethod,
  type FundingProvider,
} from "@/lib/funding-contract";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ProviderSheet } from "@/components/app/provider-sheet";

type Checkout = {
  id: string;
  provider: FundingProvider;
  url: string;
  walletAddress: string;
};
const storageKey = (wallet: string) => `plain-sandbox-checkout:v1:${wallet}`;

export function FundingScreen({
  initialMethods,
}: {
  initialMethods?: FundingMethod[];
}) {
  const devnet = useDevnet();
  const walletAddress = devnet.walletAddress;
  const activeWallet = useRef(walletAddress);
  const [methods, setMethods] = useState<FundingMethod[] | null>(
    initialMethods ?? null,
  );
  const [selected, setSelected] = useState("circle");
  const [amount, setAmount] = useState("30");
  const [orderId, setOrderId] = useState("");
  const [checkoutState, setCheckout] = useState<Checkout | null>(null);
  const checkout =
    checkoutState?.walletAddress === walletAddress ? checkoutState : null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusState, setStatus] = useState<{
    wallet: string;
    text: string;
  } | null>(null);
  const status =
    statusState?.wallet === walletAddress ? statusState.text : null;
  const [walletCheck, setWalletCheck] = useState<{
    walletAddress: string;
    amountAtomic: string;
    hasTokenAccount: boolean;
    explorerUrl: string;
  } | null>(null);
  const [checkingWallet, setCheckingWallet] = useState(false);
  async function checkWallet() {
    if (!walletAddress || checkingWallet) return;
    const expectedWallet = walletAddress;
    setCheckingWallet(true);
    try {
      const response = await fetch("/api/funding/wallet", {
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      if (
        !response.ok ||
        result.walletAddress !== expectedWallet ||
        result.network !== "devnet" ||
        !/^(0|[1-9]\d*)$/.test(result.amountAtomic)
      )
        throw new Error("Could not verify your Devnet USDC. Try again.");
      if (activeWallet.current === expectedWallet) {
        setWalletCheck(result);
        await devnet.refreshPortfolio();
      }
    } catch (cause) {
      if (activeWallet.current === expectedWallet)
        setError(
          cause instanceof Error ? cause.message : "Could not check funds.",
        );
    } finally {
      setCheckingWallet(false);
    }
  }
  const [showAllMethods, setShowAllMethods] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const method = methods?.find((item) => item.id === selected);

  useEffect(() => {
    activeWallet.current = walletAddress;
  }, [walletAddress]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/funding/methods", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const value = await response.json();
        if (
          !response.ok ||
          value.network !== "devnet" ||
          !Array.isArray(value.methods)
        )
          throw new Error("Funding methods are unavailable.");
        if (!controller.signal.aborted) setMethods(value.methods);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load funding methods. Reload to retry.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!walletAddress) return;
    try {
      const raw = localStorage.getItem(storageKey(walletAddress));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (
        saved.walletAddress === walletAddress &&
        /^[0-9a-f-]{36}$/i.test(saved.id) &&
        ["transak", "moonpay"].includes(saved.provider) &&
        isSandboxWidgetUrl(saved.provider, saved.url)
      ) {
        const timer = window.setTimeout(() => {
          setCheckout(saved);
          setSelected(saved.provider);
          setOrderId(saved.providerOrderId ?? "");
        }, 0);
        return () => window.clearTimeout(timer);
      }
    } catch {
      /* Invalid public recovery metadata never authorizes a checkout. */
    }
  }, [walletAddress]);

  async function startCheckout() {
    if (
      !walletAddress ||
      busy ||
      !method?.available ||
      method.kind !== "sandbox" ||
      checkout
    )
      return;
    const actionWallet = walletAddress;
    setBusy(true);
    setError(null);
    try {
      // The old providers also require an IP-bound sandbox session. Only use
      // this hint for local development; the server uses its proxy remotely.
      let userIp: string | undefined;
      if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
        const ipResponse = await fetch("https://api.ipify.org?format=json", {
          signal: AbortSignal.timeout(5000),
        });
        userIp = (await ipResponse.json()).ip;
      }
      const response = await fetch("/api/funding/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selected,
          amountUsd: Number(amount),
          userIp,
        }),
        signal: AbortSignal.timeout(30000),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? "Could not open checkout.");
      if (
        value.walletAddress !== actionWallet ||
        value.mode !== "SANDBOX" ||
        value.deliversDevnetUsdc !== false ||
        !isSandboxWidgetUrl(value.provider, value.url)
      )
        throw new Error("Unexpected checkout details.");
      localStorage.setItem(storageKey(actionWallet), JSON.stringify(value));
      if (activeWallet.current === actionWallet) {
        setCheckout(value);
        setSheetOpen(true);
      }
    } catch (cause) {
      if (activeWallet.current === actionWallet)
        setError(
          cause instanceof Error ? cause.message : "Could not create checkout.",
        );
    } finally {
      setBusy(false);
    }
  }

  async function checkCheckout() {
    if (!checkout || busy || !walletAddress) return;
    const actionWallet = walletAddress;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/funding/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: checkout.id, providerOrderId: orderId }),
        signal: AbortSignal.timeout(25000),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? "Could not check order.");
      if (
        value.id !== checkout.id ||
        value.walletCredited !== false ||
        !["PROVIDER_COMPLETED", "FAILED", "PENDING"].includes(value.status)
      )
        throw new Error("Unexpected provider status.");
      if (activeWallet.current !== actionWallet) return;
      setStatus({ wallet: actionWallet, text: value.status });
      localStorage.setItem(
        storageKey(actionWallet),
        JSON.stringify({ ...checkout, providerOrderId: orderId }),
      );
    } catch (cause) {
      if (activeWallet.current === actionWallet)
        setError(
          cause instanceof Error ? cause.message : "Could not verify order.",
        );
    } finally {
      setBusy(false);
    }
  }

  const balance = devnet.portfolio?.cashUsd;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Badge variant="secondary">Step 2 · Add funds</Badge>
        <h2 className="text-3xl font-semibold tracking-tight">
          Your first USDC.
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Choose free demo funds, receive a transfer, or test a card checkout.
        </p>
      </div>
      <Card className="gap-3 rounded-3xl border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-sky-500/5 p-5">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Available to invest</p>
          <Wallet className="size-5 text-emerald-600" />
        </div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {balance === undefined
            ? "—"
            : `${balance.toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC`}
        </p>
        <p className="text-xs text-muted-foreground">
          Solana Devnet · test funds have no monetary value
        </p>
        <Button
          variant="outline"
          onClick={() => void devnet.refreshPortfolio()}
        >
          Refresh wallet balance
        </Button>
        {balance !== undefined && balance > 0 ? (
          <Button
            nativeButton={false}
            render={<Link href="/earn/kamino-lend?action=deposit" />}
          >
            Continue to Earn
            <ArrowRight />
          </Button>
        ) : null}
      </Card>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {methods
          ?.filter(
            (item) =>
              showAllMethods ||
              item.kind === "faucet" ||
              item.kind === "transfer",
          )
          .map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => {
                setSelected(item.id);
                setError(null);
              }}
              aria-pressed={selected === item.id}
              className={`rounded-2xl border p-4 text-left transition hover:bg-muted/40 ${selected === item.id ? "border-emerald-600 bg-emerald-500/5 ring-1 ring-emerald-600/20" : "bg-card"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{item.name}</span>
                {item.kind === "sandbox" ? (
                  <CreditCard className="size-4 text-muted-foreground" />
                ) : item.kind === "planned" ? (
                  <Badge variant="outline">Planned</Badge>
                ) : (
                  <Wallet className="size-4 text-muted-foreground" />
                )}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {item.description}
              </p>
              {item.kind === "sandbox" ? (
                <p className="mt-2 text-xs font-medium">
                  {item.available ? "Sandbox ready" : "Sandbox setup required"}
                </p>
              ) : null}
            </button>
          )) ?? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading methods…
          </p>
        )}
      </div>
      {selected === "circle" || selected === "transfer" ? (
        <Card className="gap-4 rounded-2xl p-5">
          <h3 className="font-semibold">
            {selected === "circle" ? "Get free demo USDC" : "Receive USDC"}
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            {selected === "circle"
              ? "1. Copy the address below. 2. Open Circle and select USDC + Solana Devnet (not Arc Testnet). 3. Request funds, then check here."
              : "Send only USDC on Solana Devnet to this address. Mainnet assets and TEST QUOTE cannot fund this demo."}
          </p>
          <div className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/60 p-3">
            <code className="min-w-0 flex-1 break-all text-xs">
              {walletAddress ?? "Connecting wallet…"}
            </code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy wallet address"
              disabled={!walletAddress}
              onClick={() => {
                if (walletAddress)
                  void navigator.clipboard.writeText(walletAddress).then(
                    () => toast.success("Address copied"),
                    () =>
                      setError("Could not copy. Select the address manually."),
                  );
              }}
            >
              <Copy />
            </Button>
          </div>
          {selected === "circle" ? (
            <Button
              nativeButton={false}
              render={
                <a
                  href="https://faucet.circle.com/?chain=SOL"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              Open USDC faucet
              <ExternalLink />
            </Button>
          ) : null}
          <Button
            variant="outline"
            disabled={!walletAddress || checkingWallet}
            onClick={() => void checkWallet()}
          >
            {checkingWallet ? "Checking Devnet…" : "Check if USDC arrived"}
          </Button>
          {walletCheck?.walletAddress === walletAddress ? (
            <div role="status" className="space-y-2 text-sm">
              <p>
                {BigInt(walletCheck.amountAtomic) > BigInt(0)
                  ? `${Number(walletCheck.amountAtomic) / 1e6} USDC received on Solana Devnet.`
                  : "No USDC received on Solana Devnet yet. Check Circle’s network and transaction result."}
              </p>
              <a
                className="underline"
                href={walletCheck.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View this wallet on Devnet Solscan
              </a>
            </div>
          ) : null}
          <details className="text-xs leading-5 text-muted-foreground">
            <summary className="cursor-pointer">Funds did not arrive?</summary>
            <p className="mt-2">
              Circle must report a successful transaction on Solana Devnet. A
              completed Transak test does not send Devnet USDC. This embedded
              wallet uses a smart-wallet address; Circle funding to it has not
              been verified. If Circle rejects it, use a Devnet USDC transfer
              from another wallet and retain the transaction link.
            </p>
          </details>
          <p className="text-xs text-muted-foreground">
            The current route accepts up to 1 demo USDC per action. Faucets can
            have verification and rate limits.
          </p>
        </Card>
      ) : null}
      <Button
        variant="ghost"
        onClick={() => setShowAllMethods(!showAllMethods)}
      >
        {showAllMethods
          ? "Hide checkout tests"
          : "Card checkout tests & other methods"}
      </Button>
      {method?.kind === "sandbox" ? (
        <Card className="gap-4 rounded-2xl p-5">
          <div>
            <h3 className="font-semibold">Test {method.name} checkout</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              No real card charge. This tests provider onboarding and order
              status; it does not supply USDC to Solana Devnet.
            </p>
          </div>
          <label className="space-y-2 text-sm">
            <span>Test purchase amount · USD</span>
            <Input
              type="number"
              min={method.minimumUsd}
              max={1000}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={busy || !!checkout}
            />
          </label>
          {checkout ? (
            <>
              <p className="text-xs text-muted-foreground">
                An existing {checkout.provider} checkout is saved. Check it
                before starting another.
              </p>
              <Button variant="outline" onClick={() => setSheetOpen(true)}>
                Reopen saved checkout
              </Button>
              {checkout.provider === "transak" ? (
                <label className="space-y-2 text-sm">
                  <span>Transak order ID</span>
                  <Input
                    value={orderId}
                    onChange={(event) => setOrderId(event.target.value)}
                    placeholder="Copy the order ID from Transak"
                  />
                </label>
              ) : null}
              <Button
                onClick={() => void checkCheckout()}
                disabled={
                  busy || (checkout.provider === "transak" && !orderId.trim())
                }
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                Check provider status
              </Button>
              {status ? (
                <p
                  role="status"
                  className="rounded-xl bg-muted/60 p-3 text-sm leading-6"
                >
                  {status === "PROVIDER_COMPLETED"
                    ? "Provider test completed. Wallet funding is a separate step: use free Devnet USDC or a Devnet transfer, then continue to Earn."
                    : status === "FAILED"
                      ? "The provider reports that this checkout failed."
                      : "Provider processing is still pending. Check again; no wallet credit is assumed."}
                </p>
              ) : null}
              {status === "PROVIDER_COMPLETED" || status === "FAILED" ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (walletAddress)
                      localStorage.removeItem(storageKey(walletAddress));
                    setCheckout(null);
                    setStatus(null);
                    setOrderId("");
                  }}
                >
                  Finish tracking this checkout
                </Button>
              ) : null}
            </>
          ) : (
            <Button
              onClick={() => void startCheckout()}
              disabled={
                busy ||
                !method.available ||
                !Number.isFinite(Number(amount)) ||
                Number(amount) < (method.minimumUsd ?? 1) ||
                Number(amount) > 1000
              }
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CreditCard />
              )}
              Open sandbox checkout
            </Button>
          )}
          {!method.available ? (
            <p className="text-xs text-muted-foreground">
              The server must enable this provider&apos;s sandbox credentials
              before checkout is available.
            </p>
          ) : null}
        </Card>
      ) : null}
      {method?.kind === "planned" ? (
        <Card className="rounded-2xl p-5">
          <p className="text-sm leading-6 text-muted-foreground">
            {method.description}. Choose free demo USDC or an enabled sandbox
            checkout for now.
          </p>
        </Card>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        Plain&apos;s target is to cover network fees. Sponsored smart-wallet
        execution must be verified before a gas-free deposit is offered; the
        current action review remains authoritative.
      </p>
      <ProviderSheet
        open={sheetOpen && !!checkout}
        onOpenChange={setSheetOpen}
        title={
          checkout
            ? `${checkout.provider === "transak" ? "Transak" : "MoonPay"} test checkout`
            : "Checkout"
        }
        badge="Sandbox"
        externalUrl={checkout?.url}
      >
        {checkout ? (
          <iframe
            src={checkout.url}
            title="Sandbox card checkout"
            className="h-full w-full border-0"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="payment"
          />
        ) : null}
      </ProviderSheet>
    </div>
  );
}
