# Earn provider feasibility research

**Access date:** 2026-10-10
**Scope:** official provider/Solana documentation and repositories, a read-only Solana Devnet RPC probe, and the existing `rwa-bridge` configuration. No wallet was connected, no transaction was built, signed, simulated, or sent.

## Decision

**Implement one `SIMULATED_DEMO` Earn strategy first.** Its deposit and exit should use the repository's already-verifiable Devnet test-token/share movements, while the strategy return is labelled **`ILLUSTRATIVE YIELD`**, never Kamino, USDY, KZGB, bank interest, or earned/on-chain yield. Reuse the stricter Devnet-only configuration and transaction-verification pattern from the existing RWA-DEMO/Meteora flow; a swap is useful proof of a real Devnet transaction, but it is not itself an Earn strategy.

Do **not** add a Kamino provider or present a Kamino card as executable in this delivery. The evidence proves deployed Devnet programs and SDK-level Devnet configuration, but does not prove a particular, public, liquid, supported user-facing Devnet market/vault suitable for this app's deposit-and-withdraw demo.

Native SOL staking is a credible later Devnet spike, but not the first end-to-end strategy: stake activation/deactivation is epoch-bound, and a fast demo cannot honestly promise an immediate completed withdrawal.

## Evidence summary

| Candidate | What is proven | What is not proven / blocker | First-strategy result |
| --- | --- | --- | --- |
| Kamino Lend / KVault | KLend is officially declared on Devnet; official SDK source accepts a `devnet` environment; both KLend and KVault Devnet program accounts were executable in a read-only probe. | A pinned official Devnet user market/reserve or vault, compatible test asset/liquidity/oracles, a simulated deposit and withdrawal with the app's wallet, and a permissible end-user route. Official end-user vault tutorials inspected use Mainnet RPC and a Mainnet USDC vault. | Defer; read-only research only. |
| Native SOL staking | Solana documents Devnet as a public development cluster; installed `@solana/web3.js@1.99.0` exposes `StakeProgram.createAccount`, `delegate`, `deactivate`, and `withdraw`. | Current UI only uses Crossmint's simple SPL-transfer `wallet.send` path; raw stake-transaction execution must be tested with a staging wallet. Activation/deactivation may take one or more epochs. | Feasible follow-up spike, not an instant-exit demo. |
| Existing demo-token/share flow | The app verifies an inbound Devnet transfer before server-side share minting and verifies a share transfer before burning shares and returning test tokens. The final implementation applies a canonical-Devnet genesis guard immediately before legacy signer operations. | It is not a third-party yield protocol and its return is not on-chain provider yield. The JSON ledger remains a single-process demo persistence layer. | **Chosen, relabelled, and guarded as a fixed 1:1 Devnet demo.** |
| Existing direct Meteora RWA-DEMO swap | The code constructs, simulates, checks, and verifies a direct Devnet DLMM swap with explicit no-rights/no-payout disclosures. | A swap is not yield or an Earn position. | Keep as optional real-transaction evidence, not the Earn provider. |
| Crossmint | The existing app already provisions a Solana wallet through Crossmint; Crossmint documents isolated staging/testnet and production/mainnet environments and lists Solana wallets/onramp/offramp support. | No keys, enabled product scopes, country approval, or Kazakhstan production eligibility were tested. Crossmint is wallet/funding infrastructure, not a yield provider. | Keep optional; do not make it a dependency of the first strategy. |

## Kamino: exact feasibility finding

### Official deployment and SDK evidence

- Kamino's official KLend repository declares the same program ID for Mainnet and Devnet: `KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD`. [KLend deployment README](https://github.com/Kamino-Finance/klend/blob/master/README.md) (accessed 2026-10-10).
- The official `klend-sdk` is a real lending/vault SDK and documents instruction construction through `KaminoAction.buildDepositTxns`. Its public basic action example explicitly initialises `mainnet-beta`; it is not evidence of a supported Devnet product. [SDK README](https://github.com/Kamino-Finance/klend-sdk/blob/master/README.md) (accessed 2026-10-10).
- A shallow read-only clone of the official SDK at commit [`3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8`](https://github.com/Kamino-Finance/klend-sdk/tree/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8) reports version `13.0.2`. Its `CliEnv` parser permits `devnet`; for that environment it uses the KLend program ID and Devnet Farms configuration. [Environment implementation](https://github.com/Kamino-Finance/klend-sdk/blob/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8/src/client/tx/CliEnv.ts) and [Devnet KVault/Farms constants](https://github.com/Kamino-Finance/klend-sdk/blob/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8/src/manager/utils/consts.ts) (accessed 2026-10-10).
- The same official SDK exposes user deposit and withdraw instruction builders, but the inspected KVault tutorials pin `https://api.mainnet-beta.solana.com` and Mainnet vault `HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E`. [Deposit tutorial](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-04-user-deposit-example/index.ts) and [withdraw tutorial](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-05-user-withdraw-example/index.ts) (accessed 2026-10-10).

The correct conclusion is therefore nuanced: **Kamino Devnet program deployment is verified; a ready-to-integrate Kamino Devnet Earn product for this app is not.** A program address, or even program-owned accounts, does not establish a safe, liquid, provider-supported end-user strategy.

### Bounded read-only Devnet probe

All calls used `https://api.devnet.solana.com` at `confirmed` commitment on 2026-10-10. Solana describes Devnet as a public development cluster with non-real tokens, a faucet, possible ledger resets, and public-RPC rate limits. [Solana cluster documentation](https://solana.com/docs/references/clusters) (accessed 2026-10-10).

| Check | Result | Interpretation |
| --- | --- | --- |
| `getHealth` / `getEpochInfo` | `ok`; epoch `1179`, `432000` slots per epoch | The public RPC was available for reads. |
| `getAccountInfo(KLend...)` | `executable: true`; owner `BPFLoaderUpgradeab1e11111111111111111111111` | KLend binary is deployed on Devnet. |
| `getProgramAccounts(KLend..., dataSlice=0)` | 739 program-owned accounts | The deployment has state; it is not a bare program address. |
| Official-SDK LendingMarket discriminator filter | 174 matching Devnet accounts | Lending-market-shaped accounts exist. This does **not** establish which market, reserve, asset, capacity, permission, or withdrawal condition should be used. |
| `getAccountInfo(devkRngFnfp4gBc5a3LsadgbQKdPo8MSZ4prFiNSVmY)` | `executable: true` | The SDK's KVault Devnet program ID is deployed. |
| `getProgramAccounts(KVault Devnet ID, dataSlice=0)` | 31 program-owned accounts | KVault state exists, but no official public user-vault configuration was selected or executed. |

**Not run:** a Kamino instruction simulation, deposit, or withdrawal. Doing so requires selecting a precise Devnet market/reserve or vault and test asset, using a funded test wallet, and independently checking resulting state. A wallet transaction would also need explicit approval; this research task had none.

### App compatibility and integration unknowns

- `rwa-bridge/package.json` and its lockfile do **not** contain `@kamino-finance/klend-sdk`. The application currently pins `@solana/web3.js@1.99.0`, while the inspected Kamino SDK source depends on `@solana/kit@^2.3.0` plus Kamino component SDKs. This is a material integration and browser/server-bundling decision, not a one-file adapter.
- Before any Kamino integration, pin the intended SDK release; load one identified Devnet market/vault by address; verify owner, reserve mint, oracle, capacity, withdrawal/liquidity constraints, and eligibility; construct and **simulate** a user transaction; then submit only a user-approved Devnet transaction and verify the resulting account state.
- Do not use a mainnet market address, example vault, APY, or API response as Devnet evidence. Do not query or submit a mainnet transaction for this task.

## Native SOL staking: feasible mechanics, unsuitable instant-exit UX

Solana's official material is decisive here:

- A stake account has distinct stake and withdraw authorities; delegation, deactivation, and withdrawal are separate operations. [Stake-account reference](https://solana.com/docs/references/staking/stake-accounts) (accessed 2026-10-10).
- Delegation and deactivation do not take effect immediately. They change at epoch boundaries and can take several epochs; duration is not exactly predictable because warmup/cooldown is network-wide. [Stake-account reference](https://solana.com/docs/references/staking/stake-accounts) (accessed 2026-10-10).
- Solana's staking explanation says rewards are issued per epoch and presented annualized yields vary; it also makes clear that deactivating stake cannot be withdrawn before deactivation finishes. [Solana staking](https://solana.com/staking) (accessed 2026-10-10).
- The CLI reference provides Devnet stake-account creation, delegate, deactivate, and withdraw workflows, and says deactivation can take more than one epoch. [Solana CLI reference](https://solana.com/docs/references/solana-cli) (accessed 2026-10-10).

Repository inspection shows the currently installed Web3 library can build the required stake instructions. However, the current UI uses `wallet.send(recipient, mint, amount)` for SPL transfers. The installed Crossmint wallet types declare a raw Solana `sendTransaction` method, but that exact staging-wallet route has not been tested here. A native-staking implementation would need a focused Devnet-only build/simulate/send/verify spike and clear states such as `ACTIVATING`, `ACTIVE`, `DEACTIVATING`, and `PROCEEDS_AVAILABLE`.

**Recommendation:** do not describe `Withdraw` as immediate for native staking. It is a good later real-Devnet strategy only if the UI is intentionally designed around pending/cooldown states; it is not a good deadline-oriented full deposit-and-exit demonstration.

## Existing application: safest truthful first path

Relevant observations from the checked repository:

- The legacy vault flow at `app/api/devnet/invest/route.ts` verifies a user-to-treasury test-token transfer, then `lib/solana-server.ts` mints a local share token. Its inverse at `app/api/devnet/withdraw/route.ts` verifies receipt of shares, pays test tokens from the treasury, and burns shares. These are genuine Devnet token transactions once configured, but they are **application-controlled demo assets**, not a provider position.
- The final selected catalog entry is renamed `Devnet Demo Strategy`, settles at a fixed 1:1 test-token/share rate, and exposes no numeric yield. `ILLUSTRATIVE YIELD` is excluded from redemption accounting. Historic demo shares are redemption-only. Neither the retained legacy labels nor the older code establish a live Ondo, KASE, or Kamino position.
- The final implementation applies the RWA-DEMO-style `SOLANA_CLUSTER` and canonical-Devnet-genesis guard to legacy signer helpers immediately before a write-capable operation. `lib/meteora-devnet.ts` remains a separate direct-swap path and not an Earn provider.
- Do not use the direct Meteora swap as a yield claim. It may demonstrate a verified Devnet quote/swap, but the asset route itself correctly says it has no real-asset rights and no KZT payout.

The first strategy should thus disclose all of the following in the product and API response:

- `DEVNET DEMO` and `NO MONETARY VALUE` for test assets;
- `SIMULATED FUNDING` / `SIMULATED PAYOUT` for fiat-facing steps;
- `ILLUSTRATIVE YIELD` for any rate or accrued-return display;
- transaction signature and Devnet Explorer URL only after independent confirmation;
- a typed `NOT_SUPPORTED` / disabled status for Kamino and native staking until their exact provider routes have passed the gate above.

## Crossmint: optional wallet/funding infrastructure

Crossmint is relevant because the repository already uses `@crossmint/client-sdk-react-ui@4.8.0`, `CrossmintProvider`, and `CrossmintWalletProvider`; it is not a reason to add a separate wallet stack.

- Crossmint's official staging/production documentation says staging is isolated from production, connects to testnets, uses test tokens, and is appropriate for development; production connects to mainnets and real assets. [Staging vs Production](https://docs.crossmint.com/introduction/platform/staging-vs-production) (accessed 2026-10-10).
- Its supported-chains table lists Solana support for wallets, onramp, and offramp; it also says testnets are accessed through staging. [Supported Chains](https://docs.crossmint.com/introduction/supported-chains) (accessed 2026-10-10).
- Crossmint's official Solana quickstart demonstrates wallet creation, balances, sending transactions, and delegated signers. [Solana wallets quickstart](https://github.com/Crossmint/solana-wallets-quickstart) (accessed 2026-10-10).
- The current Crossmint production-access documentation requires an enterprise agreement/KYB and asks applicants to specify countries of operation. [Production-access requirements](https://help.crossmint.com/articles/2804023362-how-do-i-get-production-access-to-crossmint) (accessed 2026-10-10).

Keep Crossmint **optional**: it can supply a user-owned/staging wallet and, when separately enabled, funding UI. It must not be treated as proof of a real card transfer, Kazakhstan availability, protocol eligibility, or a yield integration. No Crossmint API request was made because this workspace has no configured keys and this task did not authorize external orders.

## Region and eligibility gate

The first market is Kazakhstan, but no provider should be marked `available` merely because Kazakhstan is not visibly named in a documentation page.

- Kamino's current terms limit use to permitted users, prohibit sanctioned/prohibited persons, reserve the right to limit availability by person/geography/jurisdiction, and state that services must not be used contrary to local law. [Kamino Terms](https://kamino.com/terms) (accessed 2026-10-10).
- The fetched terms' static list does not name Kazakhstan. That is **not** a Kazakhstan availability, licensing, customer-suitability, or distribution determination; use `requires_review` until legal/compliance and provider eligibility are confirmed for the actual user, product, and flow.
- Crossmint's production process likewise makes country-of-operation and KYB part of enabling production. Staging/testnet use does not grant production authorization.

No geo-block, KYC/AML check, or provider restriction should be bypassed. The chosen Devnet demo can be shown as non-monetary testing only; production availability stays disabled pending review.

## Re-entry criteria for a real provider route

Only promote a Kamino or native-stake strategy from disabled/demo status after all applicable criteria have been captured in a follow-up report:

1. Exact provider program, market/vault/reserve, token mint, cluster, SDK version, and official source are pinned.
2. A read-only load verifies account ownership, discriminator/data shape, token mint/decimals, oracle/reserve status, capacity, and user eligibility requirements.
3. A user wallet can build and simulate the exact Devnet transaction, with fee payer, recent blockhash, expected signer, and expected account changes reviewed.
4. An explicitly user-approved Devnet deposit succeeds, has a signature/Explorer URL, and the expected provider/on-chain state—not merely a local ledger row—is verified.
5. The matching withdrawal/undelegation route is tested and its actual liquidity/cooldown/queue state is surfaced. For native staking, do not mark funds withdrawable until they are inactive.
6. Mainnet writes remain rejected by default and provider, funding, and regional capability gates stay fail-closed.

## Source list

All external sources below are official provider, protocol, or Solana properties and were accessed on **2026-10-10**.

- [Kamino KLend deployments](https://github.com/Kamino-Finance/klend/blob/master/README.md)
- [Kamino KLend SDK, pinned inspected revision](https://github.com/Kamino-Finance/klend-sdk/tree/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8)
- [Kamino SDK Devnet environment logic](https://github.com/Kamino-Finance/klend-sdk/blob/3c3a38d4ff9d7cf7b0380a383b81c9cd4f0f58b8/src/client/tx/CliEnv.ts)
- [Kamino deposit example](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-04-user-deposit-example/index.ts)
- [Kamino withdrawal example](https://github.com/Kamino-Finance/klend-sdk/blob/master/examples/kvault-tutorial/earn-vaults-05-user-withdraw-example/index.ts)
- [Kamino Terms](https://kamino.com/terms)
- [Solana clusters and Devnet](https://solana.com/docs/references/clusters)
- [Solana stake accounts](https://solana.com/docs/references/staking/stake-accounts)
- [Solana staking mechanics](https://solana.com/staking)
- [Solana CLI stake workflows](https://solana.com/docs/references/solana-cli)
- [Crossmint staging vs production](https://docs.crossmint.com/introduction/platform/staging-vs-production)
- [Crossmint supported chains](https://docs.crossmint.com/introduction/supported-chains)
- [Crossmint Solana wallet quickstart](https://github.com/Crossmint/solana-wallets-quickstart)
- [Crossmint production-access requirements](https://help.crossmint.com/articles/2804023362-how-do-i-get-production-access-to-crossmint)
