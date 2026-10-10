import "server-only";

import { NextResponse } from "next/server";
import { OFFICE_ASSET } from "@/lib/assets";
import {
  appendMigration,
  getLedgerWallet,
  getUnmigratedPrincipal,
  hasLedgerSignature,
  withLedgerKeyLock,
} from "@/lib/devnet-ledger";
import { isConfigured, isValidWalletAddress, safeError, unavailableResponse } from "@/lib/devnet-route";
import { cacheDevnetPortfolio, readCachedDevnetPortfolio } from "@/lib/devnet-portfolio-cache";
import { explorerAddressUrl, getUnassignedIncomingPayments, getWalletSolBalance, getWalletTokenAccounts, getWalletTransactionHistory, mintVaultShares } from "@/lib/solana-server";
import { devnetConfig } from "@/lib/solana-server";
import { VAULT_PRODUCTS, getVaultQuote } from "@/lib/vaults";
import { ALL_YIELD_STRATEGIES } from "@/lib/yields";
import { getKztRateForOperation, readKztRate } from "@/lib/market-server";

type Holding = {
  kind: "cash" | "kzte" | "vault" | "asset";
  productId?: string;
  assetId?: string;
  name: string;
  ticker: string;
  mint: string;
  tokenAccount: string;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  costUsd?: number;
  pnlUsd?: number;
  mintExplorerUrl: string;
  tokenAccountExplorerUrl: string;
};

type HistoryRow = {
  id: string;
  title: string;
  type: "topup" | "invest" | "withdraw" | "buy";
  amountUsd: number;
  at: number;
  signature: string;
  explorerUrl: string;
};

type PortfolioResponse = {
  holdings: Holding[];
  positions: Array<{
    productId: string;
    principalUsd: number;
    since: number;
    earnedCarryUsd: number;
    shares: number;
    priceUsd: number;
    valueUsd: number;
  }>;
  activity: HistoryRow[];
  history: HistoryRow[];
  wallet: {
    address: string;
    solBalance: number;
    explorerUrl: string;
    network: "Solana devnet";
  };
  totalValueUsd: number;
  changeTodayUsd: number;
  cashUsd: number;
  unassignedDepositsUsd: number;
};

async function buildPortfolio(walletAddress: string): Promise<PortfolioResponse> {
  // A read endpoint must not create a token transfer by default. The old
  // numeric migration is retained only for a controlled, explicitly enabled
  // Devnet reconciliation and is never part of the universal Earn flow.
  if (process.env.ENABLE_LEGACY_EARN_IMPORT === "true") {
    for (const productId of Object.keys(VAULT_PRODUCTS)) {
      await withLedgerKeyLock(`legacy-migration:${walletAddress}:${productId}`, async () => {
        const principalUsd = await getUnmigratedPrincipal(walletAddress, productId);
        if (principalUsd <= 0.000001) return;
        const quote = await getVaultQuote(productId);
        const shares = Math.floor((principalUsd / quote.priceUsd) * 1_000_000) / 1_000_000;
        if (shares <= 0) return;
        const mintSignature = await mintVaultShares(walletAddress, productId, shares);
        await appendMigration(walletAddress, {
          productId,
          principalUsd,
          shares,
          priceUsd: quote.priceUsd,
          mintSignature,
          at: Date.now(),
        });
      });
    }
  }

  const [ledger, tokenAccounts, solBalance, quotes, kztRate] = await Promise.all([
    getLedgerWallet(walletAddress),
    getWalletTokenAccounts(walletAddress),
    getWalletSolBalance(walletAddress),
    Promise.all(Object.keys(VAULT_PRODUCTS).map((productId) => getVaultQuote(productId))),
    getKztRateForOperation().catch(() => readKztRate()),
  ]);
  const quoteByProduct = new Map(quotes.map((quote) => [quote.productId, quote]));
  const knownMints = new Map<string, Omit<Holding, "tokenAccount" | "balance" | "valueUsd" | "costUsd" | "pnlUsd" | "mintExplorerUrl" | "tokenAccountExplorerUrl">>();
  knownMints.set(devnetConfig.usdMint, {
    kind: "cash",
    name: "TEST QUOTE",
    ticker: "QUOTE-DEMO",
    mint: devnetConfig.usdMint,
    priceUsd: 1,
  });
  if (devnetConfig.kzteMint) {
    knownMints.set(devnetConfig.kzteMint, {
      kind: "kzte",
      name: "Legacy KZTE · Devnet only",
      ticker: "KZTE",
      mint: devnetConfig.kzteMint,
      priceUsd: 1 / (kztRate?.usdKzt ?? 480),
    });
  }
  for (const quote of quotes) {
    const strategy = ALL_YIELD_STRATEGIES.find((item) => item.id === quote.productId)!;
    knownMints.set(quote.mint, {
      kind: "vault",
      productId: quote.productId,
      name: strategy.name,
      ticker: quote.ticker,
      mint: quote.mint,
      priceUsd: quote.priceUsd,
    });
  }
  knownMints.set(devnetConfig.assetMint, {
    kind: "asset",
    assetId: OFFICE_ASSET.id,
    name: OFFICE_ASSET.name,
    ticker: "OFFICE",
    mint: devnetConfig.assetMint,
    priceUsd: 1,
  });

  const labels = Object.fromEntries([...knownMints.entries()].map(([mint, item]) => [mint, {
    ticker: item.ticker,
    name: item.name,
    kind: item.kind,
    priceUsd: item.priceUsd,
  }])) as Record<string, { ticker: string; name: string; kind: "cash" | "kzte" | "vault" | "asset"; priceUsd: number }>;
  const accountGroups = new Map<string, typeof tokenAccounts>();
  for (const account of tokenAccounts) {
    if (!knownMints.has(account.mint)) continue;
    const group = accountGroups.get(account.mint) ?? [];
    group.push(account);
    accountGroups.set(account.mint, group);
  }

  const depositsByProduct = new Map<string, number>();
  const sharesIssuedByProduct = new Map<string, number>();
  for (const deposit of ledger.deposits) {
    if (deposit.mintSignature) {
      depositsByProduct.set(deposit.productId, (depositsByProduct.get(deposit.productId) ?? 0) + deposit.amountUsd);
      sharesIssuedByProduct.set(deposit.productId, (sharesIssuedByProduct.get(deposit.productId) ?? 0) + (deposit.shares ?? 0));
    }
  }
  for (const migration of ledger.migrations) {
    depositsByProduct.set(migration.productId, (depositsByProduct.get(migration.productId) ?? 0) + migration.principalUsd);
    sharesIssuedByProduct.set(migration.productId, (sharesIssuedByProduct.get(migration.productId) ?? 0) + migration.shares);
  }

  const holdings: Holding[] = [];
  for (const [mint, accounts] of accountGroups) {
    const config = knownMints.get(mint)!;
    const balance = accounts.reduce((total, account) => total + account.balance, 0);
    if (balance <= 0) continue;
    const tokenAccount = accounts[0].tokenAccount;
    const valueUsd = balance * config.priceUsd;
    let costUsd: number | undefined;
    if (config.kind === "vault" && config.productId) {
      const cost = depositsByProduct.get(config.productId) ?? 0;
      const issued = sharesIssuedByProduct.get(config.productId) ?? 0;
      costUsd = issued > 0 ? cost * Math.min(balance, issued) / issued : valueUsd;
    } else if (config.kind === "asset") {
      const totalCost = ledger.purchases
        .filter((purchase) => purchase.assetId === OFFICE_ASSET.id)
        .reduce((total, purchase) => total + purchase.amountUsd, 0);
      const totalUnits = ledger.purchases
        .filter((purchase) => purchase.assetId === OFFICE_ASSET.id)
        .reduce((total, purchase) => total + purchase.units, 0);
      costUsd = totalUnits > 0 ? totalCost * Math.min(balance, totalUnits) / totalUnits : valueUsd;
    }
    const holding: Holding = {
      ...config,
      tokenAccount,
      balance,
      valueUsd,
      ...(costUsd !== undefined ? { costUsd, pnlUsd: valueUsd - costUsd } : {}),
      mintExplorerUrl: explorerAddressUrl(mint),
      tokenAccountExplorerUrl: explorerAddressUrl(tokenAccount),
    };
    holdings.push(holding);
  }

  const vaultHoldings = holdings.filter((holding) => holding.kind === "vault");
  const positions = vaultHoldings.map((holding) => {
    const lastAt = ledger.deposits
      .filter((item) => item.productId === holding.productId)
      .reduce((latest, item) => Math.min(latest, item.at), Number.POSITIVE_INFINITY);
    const migrationAt = ledger.migrations
      .filter((item) => item.productId === holding.productId)
      .reduce((latest, item) => Math.min(latest, item.at), Number.POSITIVE_INFINITY);
    const since = Math.min(lastAt, migrationAt);
    return {
      productId: holding.productId!,
      principalUsd: holding.costUsd ?? holding.valueUsd,
      since: Number.isFinite(since) ? since : Date.now(),
      earnedCarryUsd: holding.pnlUsd ?? 0,
      shares: holding.balance,
      priceUsd: holding.priceUsd,
      valueUsd: holding.valueUsd,
      // The selected demo never reports accrued or provider-derived APY.
      apy: null,
    };
  });

  const rawHistory = await getWalletTransactionHistory(walletAddress, tokenAccounts, labels);
  const history = rawHistory.slice();
  const historyBySignature = new Map(history.map((item) => [item.signature, item]));
  const mergedSignatures = new Set<string>();
  const mergedRows: HistoryRow[] = [];
  const recordMerged = (
    firstSignature: string,
    secondSignature: string | undefined,
    item: HistoryRow,
  ) => {
    if (!secondSignature || !historyBySignature.has(firstSignature) || !historyBySignature.has(secondSignature)) return;
    mergedSignatures.add(firstSignature);
    mergedSignatures.add(secondSignature);
    mergedRows.push(item);
  };
  for (const deposit of ledger.deposits) {
    if (!deposit.mintSignature || !deposit.shares) continue;
    const quote = quoteByProduct.get(deposit.productId);
    if (!quote) continue;
    const mintRow = historyBySignature.get(deposit.mintSignature);
    if (!mintRow) continue;
    recordMerged(deposit.signature, deposit.mintSignature, {
      id: deposit.mintSignature,
      title: `Devnet demo · −${deposit.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} TEST QUOTE, +${deposit.shares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${quote.ticker}`,
      type: "invest",
      amountUsd: deposit.amountUsd,
      at: Math.max(deposit.at, mintRow.at),
      signature: deposit.mintSignature,
      explorerUrl: mintRow.explorerUrl,
    });
  }
  for (const withdrawal of ledger.withdrawals) {
    if (!withdrawal.shares || !withdrawal.payoutSignature) continue;
    const quote = quoteByProduct.get(withdrawal.productId);
    const payoutRow = historyBySignature.get(withdrawal.payoutSignature);
    if (!quote || !payoutRow) continue;
    recordMerged(withdrawal.signature, withdrawal.payoutSignature, {
      id: withdrawal.payoutSignature,
      title: `Devnet test-token redemption · −${withdrawal.shares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${quote.ticker}, +${(withdrawal.amountUsd ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 6 })} TEST QUOTE`,
      type: "withdraw",
      amountUsd: withdrawal.amountUsd ?? 0,
      at: Math.max(withdrawal.at, payoutRow.at),
      signature: withdrawal.payoutSignature,
      explorerUrl: payoutRow.explorerUrl,
    });
  }
  for (const purchase of ledger.purchases) {
    const mintRow = historyBySignature.get(purchase.mintSignature);
    if (!mintRow) continue;
    recordMerged(purchase.paymentSignature, purchase.mintSignature, {
      id: purchase.mintSignature,
      title: `App test asset · −${purchase.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} TEST QUOTE, +${purchase.units.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} OFFICE-DEMO`,
      type: "buy",
      amountUsd: purchase.amountUsd,
      at: Math.max(purchase.at, mintRow.at),
      signature: purchase.mintSignature,
      explorerUrl: mintRow.explorerUrl,
    });
  }
  const kzteRows: HistoryRow[] = [];
  for (const operation of ledger.kzteOperations) {
    const sourceSignature = operation.sourceSignature;
    const targetSignature = operation.targetSignature;
    if (sourceSignature) mergedSignatures.add(sourceSignature);
    if (targetSignature) mergedSignatures.add(targetSignature);
    const signature = sourceSignature ?? targetSignature;
    if (!signature) continue;
    const title = operation.kind === "topup"
      ? "Перевод из резерва Intebix"
      : operation.kind === "exchange-kzte-usd"
        ? "KZTE возвращены в резерв Intebix · обмен KZTE → $"
        : operation.kind === "exchange-usd-kzte"
          ? "Перевод из резерва Intebix · обмен $ → KZTE"
          : "KZTE возвращены в резерв Intebix · выплата в тенге";
    kzteRows.push({
      id: signature,
      title,
      type: operation.kind === "topup" || operation.kind === "exchange-kzte-usd" ? "topup"
        : operation.kind === "redeem" ? "withdraw" : "buy",
      amountUsd: operation.amountUsd,
      at: operation.at,
      signature,
      explorerUrl: explorerAddressUrl(signature),
    });
  }
  const mergedHistory = [...history.filter((item) => !mergedSignatures.has(item.signature)), ...mergedRows, ...kzteRows]
    .sort((left, right) => right.at - left.at)
    .slice(0, 20);
  const usdHolding = holdings.find((holding) => holding.kind === "cash");
  let unassignedDepositsUsd = 0;
  if (ledger.deposits.length === 0) {
    const usedSignatures = new Set([
      ...ledger.withdrawals.map((item) => item.signature),
      ...ledger.purchases.flatMap((item) => [item.paymentSignature, item.mintSignature]),
    ]);
    const incoming = await getUnassignedIncomingPayments(walletAddress);
    for (const item of incoming) {
      if (usedSignatures.has(item.signature) || await hasLedgerSignature(item.signature)) continue;
      unassignedDepositsUsd += item.amountUsd;
    }
  }
  // Reference APYs are explicitly illustrative for this demo. They never
  // change the redemption price or appear as accrued/earned portfolio value.
  const changeTodayUsd = 0;
  return {
    holdings,
    positions,
    history: mergedHistory,
    activity: mergedHistory,
    wallet: {
      address: walletAddress,
      solBalance,
      explorerUrl: explorerAddressUrl(walletAddress),
      network: "Solana devnet",
    },
    totalValueUsd: holdings.reduce((total, holding) => total + holding.valueUsd, 0),
    changeTodayUsd,
    cashUsd: usdHolding?.balance ?? 0,
    unassignedDepositsUsd,
  };
}

export async function GET(request: Request) {
  if (!isConfigured()) return unavailableResponse();
  const walletAddress = new URL(request.url).searchParams.get("wallet");
  if (!isValidWalletAddress(walletAddress)) {
    return NextResponse.json({ error: "Укажите корректный адрес Solana-кошелька." }, { status: 400 });
  }
  const cached = readCachedDevnetPortfolio<PortfolioResponse>(walletAddress);
  if (cached) return NextResponse.json(cached);

  try {
    const value = await buildPortfolio(walletAddress);
    cacheDevnetPortfolio(walletAddress, value);
    return NextResponse.json(value);
  } catch (error) {
    return NextResponse.json({
      error: safeError(error, "Не удалось загрузить портфель из Solana devnet."),
    }, { status: 502 });
  }
}
