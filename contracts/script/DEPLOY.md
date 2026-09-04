# Deploying Arca Frontier + v4 router (Robinhood Chain)

`DeployArcaFrontier.s.sol` deploys, in one broadcast:

1. `ArcaUniV4Router` — the Uniswap v4 adapter (`IArcaRouter`) the vault's `rebalance()` swaps through.
2. `ArcaVault` ("Arca Frontier", `ARCI`) — the fully-backed 6-stock index.
3. Every asset↔asset swap route, hopping through a common quote currency.

> **Mint/redeem go live the instant the vault deploys** — they never touch the router. Routes only
> matter once the agent rebalances. So even a routes-less deploy is already a usable product.

## Run

```bash
export PK=0x...                       # deployer key (also the tx sender)
source script/frontier.env           # the vars below
forge script script/DeployArcaFrontier.s.sol:DeployArcaFrontier \
  --rpc-url "$ALCHEMY_RHC_URL" --private-key "$PK" --broadcast
```

Every value is read from env and **reverts loudly if unset** — no silent zero-address deploys.

## Env vars

### Known / decided

| Var | Value | Source |
|---|---|---|
| `ARCA_POOL_MANAGER` | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | Uniswap v4 PoolManager on RHC (The Index docs) |
| `ARCA_NVDA_TOKEN` | `0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec` | verified on-chain (konsep-Arca.md) |
| `ARCA_OWNER` / `ARCA_GUARDIAN` / `ARCA_REBALANCER` / `ARCA_FEE_RECIPIENT` | your addresses | you |
| `ARCA_MINT_FEE_BPS` | e.g. `20` (0.20%, ≤ 50) | policy |
| `ARCA_MAX_SLIPPAGE_BPS` | e.g. `100` (1%) | policy |
| `ARCA_MAX_TURNOVER_BPS` | e.g. `5000` (50%) | policy |
| `ARCA_REBALANCE_COOLDOWN` | e.g. `604800` (7d) | policy |
| `ARCA_SUPPLY_CEILING` / `ARCA_SUPPLY_CAP` | share caps (wei) | policy |
| `ARCA_<SYM>_UNIT` | initial backing per 1e18 shares, per token decimals | you (defines 1 share) |

### ✅ RESOLVED — all in `script/frontier.env.example` (verified on-chain 2026-07-19)

Fetched from `docs.robinhood.com/chain` + Chainlink via browser MCP, then **verified with `cast`**
against chain 4663 (symbol / decimals / `latestRoundData`). `ARCA_QUOTE` = **USDG** (6 dec), each
stock's `_ORACLE` is the RHC "shared-svr" Chainlink proxy (8 dec, live price), tokens are 18 dec, and
`ARCA_POOL_MANAGER` (Uniswap v4) has code and answers `owner()`. Just source the env file.

### ⏳ Still to confirm (does NOT block a vault+router deploy)

| Var | What | Note |
|---|---|---|
| `ARCA_SPCX_TOKEN` / `_ORACLE` | SPCX token (feed already verified) | token registry page was down; refetch, then add `SPCX` to `ARCA_SYMBOLS` |
| `ARCA_POOL_FEE` / `_SPACING` / `_HOOKS` | actual v4 fee tier of each stock/USDG pool | defaults 3000/60/0x0; confirm before `ARCA_WIRE_ROUTES=true`. Routes are wired post-deploy, so mint/redeem go live without them |
| Sequencer Uptime Feed | L2 staleness guard (hardening) | separate Chainlink feed; add to the vault's oracle read before mainnet |

> ⚠️ **Before mainnet:** fork-test the router against live RHC v4 pools. `IUniswapV4Minimal.sol` is a
> hand-written subset; `test/mocks/MockV4PoolManager.sol` validates *our* accounting, not RHC's real
> pool behaviour (fees, hooks, price impact).

## Assumption to verify

The router routes stock→stock via `ARCA_QUOTE` (2 hops), because tokenized stocks pair against a
quote, not each other. **If RHC has direct stock↔stock v4 pools**, register 1-hop routes instead
(cheaper) — the adapter already supports any hop count via `setRoute`.
