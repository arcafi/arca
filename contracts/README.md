# Arca — contracts

Managed, fully-backed stock indexes on **Robinhood Chain** (chain 4663). One token per index, minted and redeemed in-kind against tokenized stocks. An autonomous agent rebalances the weights — **within on-chain guardrails it cannot escape**. Every rebalance is published on-chain.

> Verify, don't trust. The agent can *manage* your basket. It can never *withdraw* it.

## What the contract guarantees (invariants)

| # | Invariant |
|---|---|
| INV1 | **Backing** — for every asset, `balanceOf(vault) ≥ totalSupply × units[i] / 1e18`. Always. |
| INV2 | **No drain** — tokens leave only via `redeem()` or whitelisted-router swaps in `rebalance()`. No arbitrary transfer. |
| INV3 | **Redeem liveness** — `redeem()` can never be blocked by any admin action. |
| INV4 | **Closed set** — the asset whitelist is fixed at deploy; rebalance cannot add a new asset. |
| INV5 | **Guardian bounds** — guardian may only pause *mint*, lower the cap, and set feeRecipient/rebalancer/guardian. It can never touch balances, change weights, or pause redeem. |

The agent (rebalancer) can call **only** `rebalance`, bounded by slippage, turnover, cooldown, and whitelist. If the agent's model goes rogue — or its key is compromised — the worst case is a poor-but-bounded rebalance. **User funds cannot leave.** If the agent dies entirely, `redeem()` still works.

## Layout

```
src/ArcaVault.sol   the vault (ERC-20 share token holding the basket)
test/                unit · fuzz · invariant · fork · adversarial
SPEC.md              full spec + threat model + agent policy
```

## Build & test

```bash
forge build
forge test
# fork tests against RHC mainnet (auto-skip if unset):
RHC_FORK_URL=<rpc> forge test --match-contract ArcaVaultRhcForkTest -vv
```

Current: **73 tests passing**, including an invariant run proving INV1 holds under randomized mint/redeem/rebalance.

## Status

Preview / testnet. Not audited yet. Underlying stock tokens are debt instruments of Robinhood Assets (Jersey) Ltd — **not equity**, no voting rights. Nothing here is investment advice.

## License

MIT.
