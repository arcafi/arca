import { H1, H2, P, Ul, Table, Mono, NextPage } from "../ui";

export default function Security() {
  return (
    <article>
      <H1 kicker="Docs · trust model">Security &amp; invariants</H1>

      <P>
        Security here isn&apos;t a promise in a PDF — it&apos;s five invariants the test suite
        hammers on every path, plus a deliberately boring admin surface.
      </P>

      <H2 id="invariants">The five invariants</H2>
      <Table
        head={["#", "Invariant", "Plain English"]}
        rows={[
          ["INV1", <b key="1">Backing</b>, "For every asset, the vault's balance always covers supply × units. One token is never worth less than its basket."],
          ["INV2", <b key="2">No drain</b>, "Tokens leave the vault only via redemption or whitelisted rebalance swaps. There is no arbitrary transfer, sweep, or rescue function."],
          ["INV3", <b key="3">Redeem liveness</b>, "No admin action can block redemption. Pausing mint, zeroing the rebalancer, dropping the cap — redeem still works."],
          ["INV4", <b key="4">Closed set</b>, "The asset list is fixed at construction. A rebalance can never introduce a new token."],
          ["INV5", <b key="5">Bounded guardian</b>, "The guardian can pause mint, lower the cap, and rotate roles. It can never move balances, change units, or touch redemption."],
        ]}
      />

      <H2 id="roles">Who can do what</H2>
      <Table
        head={["Actor", "Can", "Cannot"]}
        rows={[
          [
            <b key="g">Guardian</b>,
            "pause/unpause mint · lower supply cap · set fee recipient · rotate rebalancer/guardian",
            "withdraw · pause redeem · raise the cap back up · change rails or the asset set",
          ],
          [
            <b key="a">Agent (rebalancer)</b>,
            "call rebalance() within whitelist, slippage cap, turnover cap, cooldown",
            "withdraw · mint · touch any other function",
          ],
          [<b key="h">Holder</b>, "mint (when open) · transfer · redeem anytime", "—"],
        ]}
      />

      <H2 id="testing">How it&apos;s tested</H2>
      <P>
        The suite is 95 tests across six files — unit, fuzz, invariant, adversarial, and fork:
      </P>
      <Ul
        items={[
          <>
            <b>Invariant fuzzing</b> — INV1/INV2 hold across hundreds of thousands of random
            mint/redeem/rebalance sequences (2 × 128k calls, zero reverts).
          </>,
          <>
            <b>Adversarial suite</b> — reentrant router, router that over-pulls funds (
            <Mono>EvilRouter</Mono>), frozen-asset tokens, exact-wei boundary attacks on every rail.
          </>,
          <>
            <b>Fork tests</b> — mint/redeem against real Robinhood Chain state (chain 4663) with the
            real stock tokens&apos; ERC-20 semantics.
          </>,
          <>
            <b>Real-basket suite</b> — the actual 6-asset Frontier configuration at real prices, not
            just toy 2-asset setups.
          </>,
        ]}
      />

      <H2 id="honesty">Known limitations, stated plainly</H2>
      <Ul
        items={[
          <>
            <b>Issuer risk is inherited.</b> Tokenized stocks are debt instruments of Robinhood
            Assets (Jersey) Ltd — holders are creditors, not shareholders. An issuer freeze on one
            asset blocks whole-basket redemption until it lifts.
          </>,
          <>
            <b>Oracles gate rebalance, not redemption.</b> A broken feed can pause good rebalancing;
            it cannot lock your exit.
          </>,
          <>
            <b>Early-stage deployment.</b> Mainnet is live with a deliberately small supply cap
            that rises gradually, and the suite is fork-tested against live pools — but the code
            is young and unaudited. An external audit comes before any large cap raise.
          </>,
        ]}
      />

      <NextPage href="/docs/contracts" label="Contracts & addresses" />
    </article>
  );
}
