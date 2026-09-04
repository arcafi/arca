# Arca — Execution Spec

Core contract = **`ArcaVault`**. One reusable contract, deployed per basket (immutable per version).
Foundry + MIT. Chain: Robinhood Chain (mainnet 4663, testnet 46630).

**v1 basket — Frontier v2:** NVDA · MSFT · TSLA · GOOGL · SPCX. All five have live Chainlink feeds
and two-way Uniswap v4 liquidity vs USDG within <1% of oracle, so the agent can rebalance the whole
basket on-chain. (Names without permissionless AMM depth — e.g. AMD/MU/PLTR — are deliberately excluded.)

Non-negotiable principles (framing B: systematic, transparent, anti-rug):
- **Trustless custody** — the agent may *manage*, never *withdraw*.
- **Redeem can never be paused.**
- **The guardian must never touch user funds.** If a design needs that → redesign, not negotiate.

---

## 1. Contract spec — `ArcaVault` (ERC-20 share token that holds the constituents)

The vault is an ERC-20 share token (e.g. `ARCI`) holding N stock tokens. Mint in-kind, redeem in-kind.

### Public functions
| Function | Signature | Access |
|---|---|---|
| mint | `mint(uint256 shares, address to)` | anyone (delivers the in-kind basket) |
| redeem | `redeem(uint256 shares, address to)` | holder — **never pausable** |
| rebalance | `rebalance(Swap[] swaps, bytes32 rationale)` | **rebalancer (agent) only** |
| assets / units | `assets() → address[]`, `units() → uint256[]` | view |
| nav / isFullyBacked | view | view |
| setMintPaused | `setMintPaused(bool)` | guardian |
| setSupplyCap | `setSupplyCap(uint256)` | guardian (≤ immutable ceiling, may only lower) |
| setFeeRecipient / setRebalancer / setGuardian | `(address)` | guardian |

### State
- `address[] assets` — **whitelist, set at deploy, IMMUTABLE.**
- `uint256[] _units` — amount of each asset per 1e18 shares. **Mutable ONLY via `rebalance`.**
- `supplyCap` (guardian, ≤ immutable `SUPPLY_CEILING`), `mintPaused` (guardian; redeem is NOT pausable).
- `guardian` (Safe), `rebalancer` (agent session key), `feeRecipient` (guardian-swappable), `mintFeeBps` (immutable, ≤ 50).
- `router` (DEX adapter, immutable), `oracleOf[asset]` (Chainlink feed per asset, immutable).
- Rebalance guardrails (immutable): `maxSlippageBps`, `maxTurnoverBps`, `rebalanceCooldown`; `lastRebalance`.
- Oracle-safety (immutable): `maxOracleAge` (staleness bound), `sequencerUptimeFeed` (L2 liveness; `address(0)` skips).

### Mechanics
- **mint(shares):** pull `ceil(shares × units[i] / 1e18)` of each asset from the caller → mint `shares`
  (fee `mintFeeBps` in shares to `feeRecipient`, remainder to `to`). Backing stays intact (ceil rounding).
- **redeem(shares):** burn shares → transfer `floor(shares × units[i] / 1e18)` of each asset. **No gate, no pause.**
- **rebalance(swaps, rationale):** rebalancer only, after cooldown. Executes swaps **between whitelisted
  assets, via the router only** (the router hops stock → USDG → stock internally; the vault never holds
  USDG). Enforces `navAfter ≥ navBefore × (1 − maxSlippage)` and `turnover ≤ maxTurnover`, then
  **recomputes `units[i] = balance[i] × 1e18 / supply`** so units always mirror real balances
  (fully-backed by construction). Emits the rationale hash for transparency.

### 🔒 Invariants (must ALWAYS hold — enforced in `test/invariant`)
- **INV1 — backing:** ∀ i, `assets[i].balanceOf(vault) ≥ totalSupply × units[i] / 1e18`. Redeem is always solvent.
- **INV2 — no drain:** tokens leave the vault ONLY via (a) redeem to the redeemer, (b) a router swap during
  rebalance. No arbitrary `transfer` path exists.
- **INV3 — redeem liveness:** `redeem()` never reverts due to an admin action (there is no pause on redeem).
- **INV4 — closed set:** the asset set is fixed at deploy; rebalance cannot introduce a non-whitelisted asset.
- **INV5 — guardian bounds:** the guardian may only pause *mint*, lower the cap (≤ ceiling), and change
  feeRecipient / rebalancer / guardian. It can NEVER move balances, change units, or pause redeem.

### Immutable vs guardian vs agent
| Locked forever | Guardian may change | Agent (rebalancer) may change |
|---|---|---|
| asset set, router, oracles, mintFeeBps, ceiling, slippage/turnover/cooldown, maxOracleAge, sequencer feed | mintPaused, supplyCap (↓ only), feeRecipient, rebalancer, guardian | `_units` (via guardrailed rebalance only) |

---

## 2. Agent spec (this is what makes the launch a real agent product)

- **Autonomous decisions:** (1) target weight per asset (systematic / rules-based, framing B),
  (2) swap sizing per rebalance, (3) timing within the window (weekly cooldown + drift-over-threshold trigger).
- **Trigger:** schedule **or** total drift > threshold. Never a user request.
- **Authority bound:** may only call `rebalance`. It **cannot** mint / redeem / withdraw / change the guardian.
- **Policy gate = THE CONTRACT.** Slippage, turnover, whitelist, cooldown and backing are enforced on-chain.
  Even if the agent model is wrong or adversarial, the contract rejects anything that violates a guardrail.
  The agent is not trusted for fund safety — only for decision quality.
- **Custody:** user keys are never held by a server. The rebalancer is a **limited session key** that can only
  call `rebalance`. If it leaks, the worst case is a poor rebalance within the guardrails (small slippage loss);
  funds cannot be withdrawn (INV2). The guardian can rotate the rebalancer instantly.
- **ACP framework:** declare the agent framework in the Agent Registry at launch setup.
- **Agent dead → funds safe?** ✅ Yes. In-kind redeem always works without the agent. Setting the rebalancer
  to `address(0)` freezes the weights but the basket stays fully-backed and fully redeemable.
  Proven in test: redeem succeeds after the rebalancer is set to `address(0)`.

---

## 3. Threat model (written up front, honestly)

### Inherited (cannot be removed)
- **Issuer (Robinhood Jersey):** stock tokens are RH Jersey debt instruments; the issuer can **freeze** a
  token. If one constituent freezes, redeeming that asset reverts (all-or-nothing, same as any RHC basket).
- **Chainlink oracle:** used to bound rebalance slippage/turnover. A stale or manipulated feed could let the
  agent pass a value-losing rebalance. Mitigations: staleness bound (`maxOracleAge`), sequencer-uptime check,
  reject non-positive prices; **the oracle is NOT used for mint/redeem** (those are in-kind, price-free).
- **Single RHC sequencer** (Robinhood) and the launch venue (token settlement elsewhere).
- **Liquidity is compliance-gated:** the deep professional stock liquidity on RHC (Arcus CLOB, 0x RFQ) is
  permissioned and cannot be called by a permissionless contract. Rebalancing therefore routes only through
  permissionless Uniswap v4 pools — which is why the basket is restricted to names with real AMM depth.

### Introduced by this design
- **Rebalance complexity + router dependency** — the largest surface. Swaps face MEV/slippage. Mitigations:
  per-swap `minOut`, on-chain slippage + turnover caps, cooldown. A mis-wired or thin route can only make a
  rebalance revert — it cannot drain the vault (INV2 + guardrails are the backstop).
- **Agent key (rebalancer)** — if leaked, a poor rebalance within guardrails (small loss); no withdrawal
  (INV2). Mitigations: session key, instant guardian rotation.

### Cannot be removed (acknowledged)
- **An issuer freeze stalls redeem all-or-nothing** — product decision (LOCKED): redeem stays fully in-kind;
  one frozen constituent makes the whole basket wait for unfreeze. Partial-per-asset redemption was rejected
  because it (1) inverts into a bank run, (2) requires an oracle in redeem (opening MEV/manipulation), and
  (3) adds a permanent bug surface for a rare, temporary case. Covered by `ArcaVaultFreezeTest`: clean
  revert, state intact. Public messaging: "a consequence of the RH Jersey debt instrument, identical for any
  product holding RHC stock tokens."
- Trust in Chainlink for rebalance guardrails.
- Rebalancing = swapping = real slippage cost.

---

## 4. Test plan
- **Unit** — every public function ≥ 1 test (mint, redeem, rebalance, each setter, access control).
- **Fuzz** — random mint/redeem amounts; random rebalance params.
- **Invariant** — INV1 backing never breaks under random mint/redeem/rebalance sequences; INV2 no-drain.
- **Oracle hardening** — staleness, sequencer-down, bad price; redeem survives a stale oracle (INV3).
- **Fork (RHC mainnet)** — against real RHC stock tokens, real Chainlink feeds, and real Uniswap v4 USDG
  pools: deploy Frontier v2, mint, nav, rebalance through the wired hops, assert INV1 and that guards fire.
- **Agent sim (adversarial)** — a rebalance that adds a non-whitelisted asset → revert; slippage > cap →
  revert; turnover > cap → revert; before cooldown → revert; net backing decrease → revert.
- **Liveness** — redeem succeeds even with `mintPaused = true` and `rebalancer = address(0)`.
- CI: `forge fmt --check` + `forge test` on every push.

## 5. Milestones
```
[x] Spec + invariants written
[x] ArcaVault.sol + full test suite (108 tests, oracle-hardened)
[ ] Frontier v2 fork test against RHC mainnet state
[ ] Agent runtime + policy gate + adversarial tests
[ ] Testnet RHC (46630) end-to-end
[ ] Mainnet deploy + VERIFY source (mandatory, not optional)
[ ] Small cap first → raise gradually
[ ] Audit before a large cap
[ ] Token launch
[ ] UI wiring (Next.js + wagmi) — LAST
```

## 6. Avoid the deployed-idle failure mode
- **First real tx:** the team mints the first Frontier basket (acting as the first participant) and publishes
  the first rebalance rationale — the vault is funded, not an empty shell.
- **Who executes & why:** an early holder wanting managed, hands-off, verifiable 5-stock exposure in one token.
- **Zero users in week 1** would be a distribution problem, not a product one — hence build-in-public from the
  first commit, before the token is live.

## 7. Launch narrative
- **One-line pitch:** "Managed stock indexes on Robinhood Chain — every rebalance is a public on-chain
  transaction, and the agent can't touch your funds."
- **Contrast vs incumbents:** passive baskets leave weights to drift with no manager → Arca actively
  rebalances, transparently. Single-EOA custody designs → Arca custody is trustless (agent cannot withdraw).
- **Proof:** on-chain rebalance txs + fully-backed live + verified source + (later) audit.
- **Social:** build-in-public from the first commit (@ArcaFi). Don't launch from a zero footprint.
