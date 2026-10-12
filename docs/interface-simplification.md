# Plain: simpler consumer interface

## Product rule
One screen answers one question, with one primary action. Users should not need to understand smart wallets, token accounts, reserves, cUSDC or epochs before starting. Keep amounts, network, fees, exit terms and approval visible when they affect the decision.

## First release implemented
- Three navigation tabs: Home, Earn, Activity. Existing holdings remain accessible on Home and existing direct routes.
- Home: one next-step card (fund → deposit → manage), no duplicated promo, quick-action row or funding-story blocks. Balance details are collapsed; yield forecast appears only for an existing position.
- Funding: free Devnet USDC and wallet transfer first. Sandbox checkout tests and unconnected methods are behind an explicit secondary action.
- Faucet flow: copy exact wallet → explicitly select USDC / Solana Devnet → request → check actual onchain USDC. Provide a Devnet explorer link. Never treat a faucet toast, provider checkout or rate limit as settlement.
- Earn: one current lending route, then compact upcoming strategies grouped by complexity. Unimplemented integrations remain unavailable.

## Target redesign
1. Registration: email + code; create wallet in background. Move optional mock identity out of the critical path. Explain provider KYC only when required at purchase.
2. Funding: one amount field and recommended provider, with “other methods” below. Show quote, card/provider fees, supported geography and target asset before continuing. Sandbox mode must remain visibly distinct.
3. Deposit: recommended USDC strategy by default, amount presets (25/50/100% of available balance), a short fee/exit review, then one wallet approval. Expand “details” for protocol and token identifiers. Current Devnet reserve cap is 1 USDC, so presets must honor this limit.
4. Home after deposit: invested principal, current position value, actual tracked profit, estimated daily net income; avoid duplicating balances across cards. Missing data displays unavailable rather than zero.
5. Switch: choose destination → review amount, conversion/slippage, fee, exit duration → confirm. A persistent progress record carries withdraw/swap/deposit and lets a user resume an interrupted step. Never hide partial completion or promise instant exit.
6. Withdrawal: amount → expected receive asset and timing → review → approval → confirmed receipt.

## Integration order and acceptance
First fix the common Crossmint executor: verified inner instructions, independent finalized receipts, project-sponsored gas, timeout recovery and duplicate-signature protection. Then test Kamino roundtrip; native SOL stake/deactivate/withdraw; Marinade mint/unstake; Jito and curated vaults on an explicitly selected production environment; Meteora advanced opt-in. Mainnet payments and signing require separate explicit owner authorization.

For each route: real supported network and pinned accounts, read balances, quote including all fees, simulate actual wrapped transaction, user approval, confirm expected asset changes, show actual position, verify exit, and recover uncertain results. A catalog card alone does not meet these acceptance criteria.

## Faucet incident
Public Devnet reads for ACreLvLZcmPgHZHjzUzQWnvLtWHiqENjWNLQ7iqLewcc found no account, zero SOL, no SPL/Token-2022 accounts, no signatures. The address is off-curve and is linked in Plain’s server ledger. Circle reported sent to the user and then rate limited repeat requests; without a transaction signature we cannot establish the failure cause. Off-curve rejection/ATA provisioning and incorrect network are hypotheses, not confirmed explanations. Do not automatically retry and do not change the user’s wallet address.

Executor research: installed Crossmint stagingFund supports USDXM only, not the canonical Devnet USDC required by Kamino. Do not substitute it for USDC. prepareOnly returns a provider transaction ID but does not expose a verified outer Solana transaction in installed types. Final verification needs the actual wrapped transaction, pinned CPI instructions and token deltas; the existing exact-template-digest check must not simply be removed.
