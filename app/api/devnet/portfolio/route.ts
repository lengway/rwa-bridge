import "server-only";

import { NextResponse } from "next/server";
import { DEMO_OFFICE_ASSET } from "@/lib/assets";
import { getLedgerWallet, hasLedgerSignature } from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { YIELD_STRATEGIES } from "@/lib/yields";
import { explorerUrl, getUnassignedIncomingPayments, getWalletTokenBalances } from "@/lib/solana-server";

export async function GET(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const walletAddress = new URL(request.url).searchParams.get("wallet");
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }

  try {
    const [ledger, balances] = await Promise.all([
      getLedgerWallet(walletAddress),
      getWalletTokenBalances(walletAddress),
    ]);
    const positionIds = new Set([...ledger.deposits, ...ledger.withdrawals].map((item) => item.productId));
    const positions = [...positionIds].flatMap((productId) => {
      const transactions = [
        ...ledger.deposits.filter((item) => item.productId === productId)
          .map((item) => ({ type: "deposit" as const, at: item.at, amount: item.amountUsd })),
        ...ledger.withdrawals.filter((item) => item.productId === productId)
          .map((item) => ({ type: "withdrawal" as const, at: item.at, amount: item.principalUsd })),
      ].sort((left, right) => left.at - right.at);
      let principalUsd = 0;
      let since: number | undefined;
      for (const transaction of transactions) {
        if (transaction.type === "deposit") {
          if (principalUsd <= 0) since = transaction.at;
          principalUsd += transaction.amount;
        } else {
          principalUsd = Math.max(0, principalUsd - transaction.amount);
          if (principalUsd <= 0.000001) {
            principalUsd = 0;
            since = undefined;
          }
        }
      }
      if (principalUsd <= 0 || since === undefined) return [];
      return [{ productId, principalUsd, since, earnedCarryUsd: 0 }];
    });

    const purchaseCost = ledger.purchases
      .filter((item) => item.assetId === DEMO_OFFICE_ASSET.id)
      .reduce((total, item) => total + item.amountUsd, 0);
    const holdings = balances.assetUnits > 0 || purchaseCost > 0
      ? [{ assetId: DEMO_OFFICE_ASSET.id, units: balances.assetUnits, costUsd: purchaseCost }]
      : [];

    const activity = [
      ...ledger.deposits.map((item) => ({
        id: item.signature,
        type: "invest" as const,
        title: YIELD_STRATEGIES.find((strategy) => strategy.id === item.productId)?.name ?? "Вклад",
        amountUsd: item.amountUsd,
        at: item.at,
        signature: item.signature,
        explorerUrl: explorerUrl(item.signature),
      })),
      ...ledger.withdrawals.map((item) => ({
        id: item.signature,
        type: "withdraw" as const,
        title: `Вывод: ${YIELD_STRATEGIES.find((strategy) => strategy.id === item.productId)?.name ?? "вклад"}`,
        amountUsd: item.principalUsd + item.earnedUsd,
        at: item.at,
        signature: item.signature,
        explorerUrl: explorerUrl(item.signature),
      })),
      ...ledger.purchases.map((item) => ({
        id: item.mintSignature,
        type: "buy" as const,
        title: DEMO_OFFICE_ASSET.name,
        amountUsd: item.amountUsd,
        at: item.at,
        signature: item.mintSignature,
        explorerUrl: explorerUrl(item.mintSignature),
      })),
    ].sort((left, right) => right.at - left.at);

    let unassignedDepositsUsd = 0;
    if (ledger.deposits.length === 0) {
      const usedSignatures = new Set([
        ...ledger.withdrawals.map((item) => item.signature),
        ...ledger.purchases.flatMap((item) => [item.paymentSignature, item.mintSignature]),
      ]);
      const incoming = await getUnassignedIncomingPayments(walletAddress);
      const available = [];
      for (const item of incoming) {
        if (usedSignatures.has(item.signature) || await hasLedgerSignature(item.signature)) continue;
        available.push(item);
      }
      unassignedDepositsUsd = available.reduce((total, item) => total + item.amountUsd, 0);
    }

    return NextResponse.json({ positions, holdings, activity, unassignedDepositsUsd });
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось загрузить портфель из Solana devnet."),
    }, { status: 502 });
  }
}
