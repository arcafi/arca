import { H1, H2, P, Ul, Callout, Table, Mono, NextPage } from "../ui";

export default function Architecture() {
  return (
    <article>
      <H1 kicker="Docs · system design">Architecture</H1>

      <P>
        Three components, each holding only the power it needs — nothing more. The vault is the only
        one that ever touches funds.
      </P>

      <Table
        head={["Component", "Where", "Role", "Power over funds"]}
        rows={[
          [
            <Mono key="v">ArcaVault</Mono>,
            "onchain",
            "ERC-20 index token, custody, and every rule — mint, redeem, rebalance rails, invariants",
            <b key="vp">Full — and rule-bound</b>,
          ],
          [
            <Mono key="r">ArcaUniV4Router</Mono>,
            "onchain",
            "Adapter that runs the vault's swaps across Uniswap v4 (multi-hop through a quote currency)",
            "Transient only — pulls in, swaps, and pushes back within one call",
          ],
          [
            "Agent",
            "offchain",
            "Momentum read → swap plan → submits rebalance() with its rationale",
            <b key="ap">None — holds only the rebalancer key</b>,
          ],
        ]}
      />

      <H2 id="vault">ArcaVault</H2>
      <P>
        One contract per index: the ERC-20 token, asset custody, and all policy in a single place.
        Every setting that bears on safety — the asset set, slippage/turnover caps, cooldown, fee
        cap, supply ceiling — is <b>immutable once deployed</b>. What stays mutable (guardian
        actions) is kept deliberately small, and can never move balances or block redemption.
      </P>

      <H2 id="router">ArcaUniV4Router</H2>
      <P>
        The vault never speaks Uniswap directly; it calls one clean interface —{" "}
        <Mono>swap(tokenIn, tokenOut, amountIn, minOut)</Mono>. The adapter follows an
        owner-registered route of v4 pools (stock → quote → stock, since stocks pair against a quote
        currency, not each other) inside a single lock. Toward funds it holds no state: a malicious
        or buggy route can at worst burn one approved <Mono>amountIn</Mono> — already bounded by the
        vault&apos;s turnover and slippage rails — and can never drain custody.
      </P>

      <H2 id="agent">The agent</H2>
      <P>
        Runs offchain: fetch prices → compute momentum-tilted target weights (with per-asset caps)
        → plan the smallest set of swaps within the turnover budget → submit. Its key is a{" "}
        <b>rebalancer session key</b> — the only function it can successfully call on the vault is{" "}
        <Mono>rebalance()</Mono>.
      </P>
      <Ul
        items={[
          <>If the agent dies, the product degrades gracefully — mint and redeem keep working; the basket simply stops rotating.</>,
          <>If the key leaks, the attacker inherits the same cage — bounded trades inside the rails, and no withdrawals.</>,
        ]}
      />

      <H2 id="oracles">Price oracles</H2>
      <P>
        Valuation reads Chainlink stock feeds (<Mono>AggregatorV3Interface</Mono>, 8 decimals) — the
        official oracle stack on Robinhood Chain. Oracles gate <i>rebalance quality</i> (slippage
        checks and NAV); they are deliberately <b>not</b> in the redemption path.
      </P>
      <Callout title="Oracle note" tone="amber">
        Mainnet points at the verified Chainlink feed proxies for all five constituents, with a
        staleness bound and an optional L2 sequencer-uptime check. Oracles price rebalance
        guardrails and NAV only — mint and redeem are in-kind and never read a price, so a
        paused feed can never lock your exit.
      </Callout>

      <NextPage href="/docs/security" label="Security & invariants" />
    </article>
  );
}
