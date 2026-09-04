import { H1, H2, P, Ul, Callout, Table, Mono, NextPage } from "../ui";

export default function HowItWorks() {
  return (
    <article>
      <H1 kicker="Docs · lifecycle">How it works</H1>

      <P>
        An Arca index is defined by a fixed set of assets and a per-token backing amount for each —
        the <Mono>units</Mono>. Hold a single index token and the vault holds, at minimum, one unit
        of every asset on your behalf. Everything that follows exists to keep that sentence true.
      </P>

      <H2 id="mint">Mint — enter with the basket</H2>
      <P>
        You deposit the per-token amount of <i>every</i> asset in the basket and the vault mints
        your index tokens against them. Deposits round <b>up</b> (in the vault&apos;s favor), so
        backing is only ever met or exceeded, never short. A mint fee (hard-capped at 0.50%) is
        taken in newly minted tokens, never from the basket.
      </P>
      <Ul
        items={[
          <>Supply is capped: a hard ceiling fixed at deploy, and an active cap that the guardian can only lower.</>,
          <>Minting can be paused in an emergency — but pausing mint never affects redemption.</>,
        ]}
      />

      <H2 id="redeem">Redeem — exit in-kind, always</H2>
      <P>
        Burn tokens, receive the underlying stocks — all of them, in one transaction, rounded{" "}
        <b>down</b>. Redemption is, by design, the least-privileged path in the system:
      </P>
      <Ul
        items={[
          <>No admin, guardian, or agent can pause or gate it. There is no code path for that.</>,
          <>It needs no oracle and no router — even if every external dependency dies, redemption still works.</>,
          <>
            It is all-or-nothing by design: you always get the <i>whole</i> basket, never a partial IOU.
          </>,
        ]}
      />
      <Callout title="Honest limitation · issuer freeze" tone="amber">
        Robinhood stock tokens are issuer-controlled instruments. If the issuer freezes transfers of
        one asset in the basket, in-kind redemption of the whole basket reverts until it unfreezes.
        This is inherited from the underlying tokens — not something Arca introduces — and we chose
        all-or-nothing over partial redemptions to avoid bank-run dynamics and oracle dependence in
        the exit path.
      </Callout>

      <H2 id="rebalance">Rebalance — the agent&apos;s only power</H2>
      <P>
        On a schedule, the agent computes target weights (momentum strategy), plans the minimal set
        of swaps, and submits them to the vault. The vault — not the agent — enforces the rails:
      </P>
      <Table
        head={["Rail", "What the contract enforces"]}
        rows={[
          [<b key="w">Whitelist</b>, "Swaps may only touch assets already in the basket. The set is fixed at deploy."],
          [<b key="s">Slippage cap</b>, "Portfolio value (by oracle) may not drop more than the fixed tolerance in one rebalance."],
          [<b key="t">Turnover cap</b>, "Total value moved per rebalance is bounded — no full-portfolio churn."],
          [<b key="c">Cooldown</b>, "A minimum time gap between rebalances, enforced onchain."],
          [<b key="u">Recompute</b>, "After the swaps, units are recomputed from actual balances — fully backed by construction."],
        ]}
      />
      <P>
        Each rebalance emits an event carrying a hash of the agent&apos;s rationale, so every move
        ships with its reasoning on the record. If the agent goes rogue or its strategy is wrong,
        the worst it can do is a bad-but-bounded trade inside the rails — it cannot withdraw, and it
        cannot block your exit.
      </P>

      <NextPage href="/docs/architecture" label="Architecture" />
    </article>
  );
}
