# Arca

*The vault that guards itself.*

Managed, fully-backed stock indexes on **Robinhood Chain** (chain 4663). One token per index, minted and redeemed in-kind against tokenized stocks. An autonomous agent rebalances the weights — **within on-chain guardrails it cannot escape** — and every rebalance is a public on-chain transaction.

> Don't trust — look inside. The agent can *manage* your basket. It can never *withdraw* it. The lock has no key; the custodian is the contract.

## Deployment (Robinhood Chain mainnet, 4663)

| Contract | Address |
|---|---|
| **ArcaVault** — "Arca Frontier" (ARCI) | [`0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628`](https://robinhoodchain.blockscout.com/address/0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628) |
| **ArcaUniV4Router** — Uniswap v4 adapter | [`0x107d393006494fce1C325e67507d33011239997f`](https://robinhoodchain.blockscout.com/address/0x107d393006494fce1C325e67507d33011239997f) |

The source for every contract is in `contracts/` — verify the deployed bytecode yourself on the explorer.

## Baskets

- **Arca Frontier** (live) — NVDA, MSFT, TSLA, GOOGL, SPCX. Every name passed an on-chain
  liquidity check (two-way Uniswap v4 depth vs USDG within ~1% of oracle), so the agent can
  rebalance the entire basket permissionlessly.
- **Arca Blue** (planned) — mega-cap core.

## What's here

| Path | |
|---|---|
| `contracts/` | the vault, a one-click USDG zapper + tests (unit · fuzz · invariant · fork against live mainnet pools · adversarial). See `contracts/README.md`. |
| `web/` | the live app + site (Next.js) |

## The agent

A momentum strategy rebalances the baskets on a schedule. It holds the `rebalancer` role — but that role is boxed in by the contract: whitelist, slippage cap, turnover cap, cooldown, and **no withdrawal path**. It can rotate weights; it can never move funds out. Every rebalance is a public on-chain transaction you can verify. The strategy code runs off-repo.

## Guarantees (enforced by the contract)

- **Backing** — every share is always fully backed; redemption is always solvent.
- **No drain** — funds leave only via your own redemption or whitelisted-router swaps during a rebalance.
- **Redeem is never pausable.**
- **Closed asset set** — the whitelist is fixed at deploy.
- **Bounded guardian** — can pause *mint*, lower the cap, and set the fee recipient / rebalancer. It can never touch balances, change weights, or pause redeem.

An invariant test proves backing holds under randomized mint / redeem / rebalance sequences.

## Build

```bash
cd contracts && forge test
cd web && npm install && npm run dev
```

## License

MIT — see [LICENSE](LICENSE). Covers the contracts and web app in this repo. The rebalancer strategy runs off-repo and is not part of this license.

## Status

Live on mainnet with a deliberately small supply cap that rises gradually. Not audited yet — an external audit comes before any large cap raise. Underlying stock tokens are debt instruments of Robinhood Assets (Jersey) Ltd — **not equity**, no voting rights. Nothing here is investment advice.

---

**$ARCA** · on Robinhood Chain · [@arca_fi](https://x.com/arca_fi)
