# Testnet deploy (Robinhood Chain testnet, chain 46630)

RHC testnet **does have real Robinhood stock tokens** (obtainable from a testnet faucet — verified
`uiMultiplier()==1e18`), but **no Chainlink stock feeds** (those are mainnet-only). Two deploy paths:

**A. `DeployArcaTestnet.s.sol` — fully self-contained** (no dependencies, deploy anywhere):
- 5 `MockStockToken` (NVDA/AMD/MU/PLTR/GOOGL, 18-dec, open mint)
- 5 `MockStockOracle` (8-dec, settable price, seeded to the live mainnet prices)
- 1 `MockV4PoolManager`
- the **real** `ArcaUniV4Router` + `ArcaVault` on top

**B. `DeployArcaTestnetReal.s.sol` — real testnet stock tokens** (TSLA/AMD/AMZN/NFLX/PLTR the deployer
holds), with `MockStockOracle` standing in for the missing feeds. Mint/redeem/backing run on genuine
testnet stock tokens; only the price feed is mocked.

…then smoke-mints 1 share to the deployer. Everything the mainnet system does, with fakes for the
assets RH only ships on mainnet. **Never deploy these mocks to mainnet.**

## Validated

Simulated on a blank EVM (no key needed) — deploys the whole stack and mints 1 share end-to-end:

```bash
forge script script/DeployArcaTestnet.s.sol:DeployArcaTestnet    # -> "shares held by deployer: 1e18"
```

## Broadcast to testnet 46630

```bash
export PK=0x...                       # deployer key, funded with testnet ETH for gas
forge script script/DeployArcaTestnet.s.sol:DeployArcaTestnet \
  --rpc-url <RHC_TESTNET_RPC> --private-key "$PK" --broadcast
```

Needs: a **testnet RPC** (Alchemy RHC testnet endpoint, or the public testnet RPC) and **testnet ETH**
in the deployer for gas. The script logs every deployed address (vault, router, mock tokens/oracles).

Handy testnet infra (from `docs.robinhood.com/chain/protocol-contracts`, testnet column):
`L2 WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa`, `Permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3`.
(Arca itself needs neither — quote is USDG-equivalent mock, gas is native ETH.)

## After deploy

- **Mint/redeem are live immediately** — that's the "product is alive" milestone.
- Move a mock price: `MockStockOracle.setAnswer(newPrice8)` to simulate market moves.
- **Rebalance demo (next):** fund the `MockV4PoolManager` with output tokens, `setRate` per pool,
  `router.setRoute(...)`, then call `vault.rebalance(...)` as the rebalancer. (Unit-tested already in
  `test/ArcaUniV4Router.t.sol`; wiring it on testnet is a follow-up.)

## Live on testnet — proven end-to-end (19 Jul 2026, chain 46630)

Explorer: `explorer.testnet.chain.robinhood.com/address/<addr>` · `/tx/<hash>`

### Vault A — REAL testnet stock tokens (headline)

`ArcaVault` **`0x1Fb3f8c9569bd45D1D7b9417Cb7aDa64D7552A94`** ("Arca Frontier (testnet, real assets)", ARCIr),
backed by the genuine RH testnet stock tokens the deployer holds (`uiMultiplier()==1e18`):

| Op | tx |
|---|---|
| **mint** (deposit TSLA/AMD/AMZN/NFLX/PLTR → 1 share) | `0x4f8a9a416df7e71d9ac0b8b518a063197a740c1ac5c9e8aaf6b46865e32f90df` |
| **rebalance** (agent: AMD→TSLA, stayed fully backed) | `0x1c00daa3a0ea3f7db0191a26d1b66456a4e8ce31278bbecc99da8b6abbebab32` |
| **redeem** (burn 0.5 share → 5 stocks back, in-kind) | `0xb5efff6a5e72fdaea677d07c057e94d0ef2debeb4c30403191b7a79fdb0ba98f` |

Real testnet stock tokens: TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, AMD `0x71178BAc73cBeb415514eB542a8995b82669778d`,
AMZN `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`, NFLX `0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93`, PLTR `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`.
Router `0xBa8DbbE3C24B38ea48acc2d530331aD8aFc90998` · mock PoolManager `0xdACf1CF9F336695C508f3325E7eF536CCd9dAF77`.

### Vault B — self-contained (mock tokens)

Vault `0xbbc3297beb20e8eD59db8d6DbB9FcC1A35b19fef` · router `0xbf8F1434d35D68CD3db1183a50B4084D2529a6a1` ·
PoolManager `0xDcd709b2e6fD72A2bdf28257AeF88a7bfd35B92c`. redeem `0x0ec9829b…afee12b3` · rebalance `0x43d2f29e…18cf47dd8`.

Both vaults proved the full loop — **mint**, **redeem** in-kind, **rebalance** (backing invariant holds
before & after). All verified with `cast`.

> Deploying via forge needs `--legacy --gas-estimate-multiplier 300` — the chain is "unsupported" so
> forge under-estimates the Arbitrum L1-calldata gas and deploys OOG without it.

## Mainnet is different

Mainnet deploy uses the **real** verified addresses in `frontier.env.example` via
`DeployArcaFrontier.s.sol` — no mocks. See `DEPLOY.md`.
