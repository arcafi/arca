import { H1, H2, P, Ul, Callout, NextPage } from "./ui";

export default function Overview() {
  return (
    <article>
      <H1 kicker="Arca · documentation">Managed stock indexes with no keeper to trust</H1>

      <P>
        Arca is a family of onchain stock indexes on Robinhood Chain. Each index is a single ERC-20
        token, backed one-to-one by a basket of tokenized stocks locked in a vault contract. An
        autonomous agent runs the basket — rotating weights on a fixed schedule — yet it acts only
        inside guardrails the contract enforces on its own.
      </P>
      <P>
        The design draws a line traditional funds never can:{" "}
        <b>management and custody are separate powers</b>. The agent sets weights. The contract
        holds the assets. Neither can reach into the other&apos;s lane.
      </P>

      <H2 id="why">Why this exists</H2>
      <P>
        Every managed fund rests on one quiet assumption: the manager won&apos;t touch your money.
        Custody lives with people and processes you can&apos;t inspect, and redemption runs on their
        timeline, not yours.
      </P>
      <Ul
        items={[
          <>
            <b>Fully backed, provably.</b> Token supply can never exceed what the vault holds — an
            invariant enforced on every mint, redeem, and rebalance, not a monthly attestation.
          </>,
          <>
            <b>Redeemable anytime, in-kind.</b> Burn the token and receive every underlying stock in
            a single transaction. No queue, no approval, and no admin can pause it.
          </>,
          <>
            <b>Managed in the open.</b> Every rebalance lands as a public transaction with its
            rationale attached. You read <i>why</i>, not just <i>what</i>.
          </>,
        ]}
      />

      <H2 id="loop">The loop</H2>
      <P>
        <b>Mint</b> — deposit the basket, receive the index token. <b>Manage</b> — the agent
        rotates weights within fixed rails (whitelist, slippage cap, turnover cap, cooldown).{" "}
        <b>Redeem</b> — burn the token, take the stocks back. That&apos;s the entire product; every
        arrow in it is a transaction anyone can verify.
      </P>

      <Callout title="Status · mainnet">
        Arca is live on Robinhood Chain <b>mainnet</b> (chain 4663): a vault backed by real
        Robinhood stock tokens with verified Chainlink feeds, in-kind mint and redemption, and
        agent rebalancing routed through live Uniswap v4 pools. Contracts are open source with a
        111-test suite (unit, fuzz, invariant, and fork tests against mainnet state) — see{" "}
        <a href="/docs/contracts" className="border-b border-green text-ink">
          Contracts &amp; addresses
        </a>{" "}
        for the live records.
      </Callout>

      <NextPage href="/docs/how-it-works" label="How it works" />
    </article>
  );
}
