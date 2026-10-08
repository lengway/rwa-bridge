import "server-only";

import { NextResponse } from "next/server";
import { DEMO_OFFICE_ASSET } from "@/lib/assets";
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
import { YIELD_STRATEGIES } from "@/lib/yields";

type Holding = {
  kind: "cash" | "vault" | "asset";
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

  const [ledger, tokenAccounts, solBalance, quotes] = await Promise.all([
    getLedgerWallet(walletAddress),
    getWalletTokenAccounts(walletAddress),
    getWalletSolBalance(walletAddress),
    Promise.all(Object.keys(VAULT_PRODUCTS).map((productId) => getVaultQuote(productId))),
  ]);
  const quoteByProduct = new Map(quotes.map((quote) => [quote.productId, quote]));
  const knownMints = new Map<string, Omit<Holding, "tokenAccount" | "balance" | "valueUsd" | "costUsd" | "pnlUsd" | "mintExplorerUrl" | "tokenAccountExplorerUrl">>();
  knownMints.set(devnetConfig.usdMint, {
    kind: "cash",
    name: "Тестовые доллары",
    ticker: "тест. долларов",
    mint: devnetConfig.usdMint,
    priceUsd: 1,
  });
  for (const quote of quotes) {
    const strategy = YIELD_STRATEGIES.find((item) => item.id === quote.productId)!;
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
    assetId: DEMO_OFFICE_ASSET.id,
    name: DEMO_OFFICE_ASSET.name,
    ticker: "OFFICE-DEMO",
    mint: devnetConfig.assetMint,
    priceUsd: 1,
  });

  const labels = Object.fromEntries([...knownMints.entries()].map(([mint, item]) => [mint, {
    ticker: item.ticker,
    name: item.name,
    kind: item.kind,
    priceUsd: item.priceUsd,
  }])) as Record<string, { ticker: string; name: string; kind: "cash" | "vault" | "asset"; priceUsd: number }>;
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
        .filter((purchase) => purchase.assetId === DEMO_OFFICE_ASSET.id)
        .reduce((total, purchase) => total + purchase.amountUsd, 0);
      const totalUnits = ledger.purchases
        .filter((purchase) => purchase.assetId === DEMO_OFFICE_ASSET.id)
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
    const strategy = YIELD_STRATEGIES.find((item) => item.id === holding.productId);
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
      apy: quoteByProduct.get(holding.productId!)?.apy ?? strategy?.demoApy ?? 0,
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
      title: `Вклад · −${deposit.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} тест. долларов, +${deposit.shares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${quote.ticker}`,
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
      title: `Вывод · −${withdrawal.shares.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} ${quote.ticker}, +${(withdrawal.amountUsd ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 6 })} тест. долларов`,
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
      title: `Покупка · −${purchase.amountUsd.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} тест. долларов, +${purchase.units.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} OFFICE-DEMO`,
      type: "buy",
      amountUsd: purchase.amountUsd,
      at: Math.max(purchase.at, mintRow.at),
      signature: purchase.mintSignature,
      explorerUrl: mintRow.explorerUrl,
    });
  }
  const mergedHistory = [...history.filter((item) => !mergedSignatures.has(item.signature)), ...mergedRows]
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
  const changeTodayUsd = vaultHoldings.reduce((total, holding) => {
    const apy = quoteByProduct.get(holding.productId!)?.apy ?? 0;
    return total + holding.valueUsd * (Math.pow(1 + apy, 1 / 365) - 1);
  }, 0);
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
