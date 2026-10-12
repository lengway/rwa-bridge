# Plain consumer earning pipeline

Target: email registration → automatically created wallet → funding → deposit → transparent yield → withdraw or switch strategy.

Implemented: Home journey, consolidated /funding catalog, wallet-bound Transak staging and MoonPay sandbox sessions/order checks, faucet and transfer guidance, live Kamino Devnet overview, protocol gain reconciliation and daily forecast. Sandbox provider completion never credits a wallet or mints substitute assets. Daily forecasts are estimates, not realized earnings.

Fee policy: 35% of positive profit, configurable up to 40%. Principal and losses are excluded; fee quoting uses a cash-flow-adjusted high-water mark. Collection is disabled pending a verified collector and disclosure before deposit. Example: $1,000 principal plus $100 eligible profit means $35 fee and $65 net profit.

Execution blocker: Crossmint Solana smart wallet is a PDA. Existing direct Kamino transaction signer/fee-payer assumptions and exact-message receipt validation require a verified smart-wallet executor. A successful sandbox checkout or unsigned simulation does not prove deposit/withdrawal. Keep guards in place until wrapped execution, receipt verification and sponsored fees are tested together.

Gas target: Plain sponsors network fees. Crossmint staging sponsorship does not prove production sponsorship; production project billing and available sponsorship must be configured and verified. Card/onramp charges are separate.

Funding: Circle faucet and wallet transfer deliver actual Devnet USDC. Transak staging and MoonPay sandbox test checkout separately from settlement. Crossmint card funding and bank/KZT remain visibly unavailable until connected. Never represent sandbox purchases as delivered Devnet USDC.

Strategy expansion order:
1. Finish Kamino USDC deposit → receipt → withdrawal with Crossmint.
2. Native SOL staking: Devnet lifecycle and delayed exit.
3. Marinade mSOL: Devnet program/mint exist; integration and liquidity roundtrip still need verification.
4. JitoSOL: production liquid staking after vetted swap/withdrawal routes.
5. Kamino curated USDC vaults: additional curator, allocation and withdrawal risks.
6. Meteora liquidity strategies: advanced opt-in with impermanent-loss and liquidity disclosures.

Switching should be one user flow but remains withdraw → optional swap → deposit. Persist each stage, quote slippage and exit constraints, recover from partial completion; never promise instantaneous exits from every strategy.

Release acceptance: real email sign-in and wallet creation; sandbox checkout with server-confirmed order; separate observed Devnet USDC credit; sponsored Kamino deposit with independently verified receipt; accurate balance/forecast and actual profit distinction; withdrawal; recoverable strategy switch. Only sandbox bootstrap/tracking and read paths have passed so far, not this full signed roundtrip.

References:
- https://docs.transak.com/guides/sandbox-credentials
- https://docs.crossmint.com/wallets/guides/gas-sponsorship
- https://docs.marinade.finance/developers/contract-addresses
- https://www.jito.network/docs/jitosol/jitosol-liquid-staking/for-developers/staking-integration/
- https://docs.meteora.ag/get-started
