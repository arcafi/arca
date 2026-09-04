import type { Metadata } from "next";
import { Logo } from "../components/Logo";
import navHistory from "../data/nav-history.json";
import { EXPLORER, VAULT_ADDRESS } from "../lib/appchain";
import { getAgentData } from "../lib/vault";

type NavPoint = { date: string; t: number; managed: number; benchmark: number };

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arca Agent — the rebalancer on the record",
  description:
    "The autonomous rebalancer behind the Arca index: its live status, every rebalance written on-chain, and the limits it can never step past.",
};

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function AgentPage() {
  const a = await getAgentData();

  return (
    <div className="min-h-screen text-ink">
      {/* top bar */}
      <div className="sticky top-0 z-40 border-b border-hair bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between px-4 py-3.5 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
            <Logo className="h-5 w-auto" />
            Arca
            <span className="ml-1 hidden rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted sm:inline-block">
              agent
            </span>
          </a>
          <div className="flex items-center gap-2">
            <a href="/app" className="rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium transition-colors hover:border-ink/30">
              Open app
            </a>
            <a href="/" className="group inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium transition-colors hover:border-ink/30">
              <span aria-hidden className="text-green-deep transition-transform group-hover:-translate-x-0.5">←</span>
              Back to site
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1000px] px-6 pt-12 pb-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-green-deep">The manager, on the record</p>
        <h1 className="mt-3 max-w-[20ch] font-display text-[clamp(1.8rem,3.6vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.02em]">
          An agent that can steer the basket — and can never seize it.
        </h1>
        <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-muted">
          A momentum strategy rotates the weights on a fixed schedule. Every move it makes lands as a
          public transaction, and every move it <em>can&apos;t</em> make is enforced by the vault itself.
        </p>

        {!a ? (
          <div className="mt-10 rounded-3xl border border-hair bg-white px-6 py-8 text-[14.5px] text-muted">
            The live on-chain read is momentarily unavailable. The vault and its full history stay
            verifiable on the explorer — don&apos;t trust it, check it.
          </div>
        ) : (
          <>
            {/* identity + live status */}
            <div className="mt-10 overflow-hidden rounded-3xl border border-hair bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair px-6 py-4">
                <div>
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Rebalancer</p>
                  <a
                    href={`${EXPLORER}/address/${a.rebalancer}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[13.5px] text-ink hover:text-green-deep"
                  >
                    {short(a.rebalancer)} ↗
                  </a>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-green/10 px-3 py-1.5 font-mono text-[11px] text-green-deep">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
                  </span>
                  managing live
                </span>
              </div>
              <div className="grid grid-cols-2 divide-hair sm:grid-cols-4 sm:divide-x">
                <Stat label="Last rebalance" value={timeAgo(a.lastRebalance)} />
                <Stat label="Cadence" value="weekly" />
                <Stat label="Vault AUM" value={money(a.navUsd)} />
                <Stat label="NAV / token" value={money(a.navPerToken)} />
              </div>
            </div>

            {/* performance — managed NAV vs. the frozen day-0 basket, from the daily snapshotter */}
            <NavChart points={navHistory.points as NavPoint[]} />

            {/* track record */}
            <div className="mt-6 rounded-3xl border border-hair bg-white px-6 py-6">
              <p className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Track record</p>
              {a.rebalances.length === 0 ? (
                <p className="text-[14px] text-muted">No rebalances recorded yet.</p>
              ) : (
                <div>
                  {a.rebalances.map((r) => {
                    const delta = r.navAfter - r.navBefore;
                    const held = Math.abs(delta) / Math.max(r.navBefore, 1e-9) < 1e-4;
                    return (
                      <div
                        key={r.txHash}
                        className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-hair py-3.5 last:border-0"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px]">
                            Rotated weights on momentum
                            <span className="ml-2 font-mono text-[11.5px] text-muted">rationale {short(r.rationale)}</span>
                          </p>
                          <p className="mt-0.5 font-mono text-[12px] text-muted">
                            {timeAgo(r.timestamp)} · NAV {money(r.navBefore)} → {money(r.navAfter)}{" "}
                            <span className={held ? "text-green-deep" : delta > 0 ? "text-green-deep" : "text-[#a23b2f]"}>
                              {held ? "· value-neutral" : delta > 0 ? "· up" : "· down"}
                            </span>
                          </p>
                        </div>
                        <a
                          href={`${EXPLORER}/tx/${r.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 font-mono text-[12.5px] text-green-deep"
                        >
                          {short(r.txHash)} ↗
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* guardrails */}
            <div className="mt-6 rounded-3xl border border-hair bg-white px-6 py-6">
              <p className="mb-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">The box it lives in</p>
              <div className="flex flex-wrap gap-2.5">
                <Rail>whitelist · {a.assetCount} assets</Rail>
                <Rail>turnover cap · {(a.turnoverCapBps / 100).toFixed(a.turnoverCapBps % 100 ? 1 : 0)}%</Rail>
                <Rail>slippage cap · {(a.slippageCapBps / 100).toFixed(a.slippageCapBps % 100 ? 1 : 0)}%</Rail>
                <Rail>cooldown · {a.cooldownSecs >= 86400 ? `${Math.round(a.cooldownSecs / 86400)}d` : `${Math.round(a.cooldownSecs / 3600)}h`}</Rail>
                <Rail good>no withdrawal path</Rail>
                <Rail good>redeem can&apos;t be paused</Rail>
              </div>
              <p className="mt-4 max-w-[64ch] text-[13px] leading-relaxed text-muted">
                Weights can shift within these limits; funds can&apos;t leave the vault except through
                your own redemption. The agent holds the <span className="font-mono text-[12px]">rebalancer</span> role
                and nothing else — no key, no keeper, no exit: it can never touch balances or pause redeem.
              </p>
            </div>

            <p className="mt-8 font-mono text-[11.5px] text-muted">
              vault{" "}
              <a href={`${EXPLORER}/address/${VAULT_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="text-green-deep">
                {short(VAULT_ADDRESS)} ↗
              </a>{" "}
              · mainnet
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function NavChart({ points }: { points: NavPoint[] }) {
  const latest = points[points.length - 1];
  const deltaPct = latest && latest.benchmark > 0 ? ((latest.managed - latest.benchmark) / latest.benchmark) * 100 : 0;
  const deltaLabel =
    Math.abs(deltaPct) < 0.005 ? "flat vs. hold" : `${deltaPct > 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(2)}% vs. hold`;

  return (
    <div className="mt-6 rounded-3xl border border-hair bg-white px-6 py-6">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Managed NAV vs. frozen basket</p>
        {points.length >= 2 ? (
          <span className={`font-mono text-[11px] ${deltaPct >= 0 ? "text-green-deep" : "text-[#a23b2f]"}`}>{deltaLabel}</span>
        ) : (
          <span className="font-mono text-[11px] text-muted">building</span>
        )}
      </div>

      {points.length < 2 ? (
        <div className="mt-5 flex h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hair bg-canvas/60 px-6 text-center">
          <p className="font-display text-[22px] font-semibold tnum">{latest ? money(latest.managed) : "—"}</p>
          <p className="max-w-[48ch] text-[12.5px] leading-relaxed text-muted">
            {points.length === 0 ? "The daily snapshot starts today." : `${points.length} daily snapshot so far.`} The
            managed line and its frozen day-0 benchmark grow from here — the public node keeps no
            history, so there is no back-fill and nothing invented.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-4 font-mono text-[11px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-3.5 bg-green" />Managed</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0 w-3.5 border-t border-dashed border-muted" />Buy-and-hold</span>
          </div>
          <NavPlot points={points} />
          <p className="mt-1 font-mono text-[10.5px] text-muted">
            {points[0].date} → {latest.date} · one snapshot/day
          </p>
        </>
      )}
    </div>
  );
}

function NavPlot({ points }: { points: NavPoint[] }) {
  const W = 800;
  const H = 168;
  const padX = 6;
  const padTop = 12;
  const padBot = 14;
  const vals = points.flatMap((p) => [p.managed, p.benchmark]);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  const mid = (lo + hi) / 2 || 1;
  const minRange = Math.abs(mid) * 0.01; // keep a near-flat line off the axis edge
  if (hi - lo < minRange) {
    lo = mid - minRange / 2;
    hi = mid + minRange / 2;
  }
  const x = (i: number) => padX + (i / (points.length - 1)) * (W - 2 * padX);
  const y = (v: number) => padTop + (1 - (v - lo) / (hi - lo)) * (H - padTop - padBot);
  const path = (key: "managed" | "benchmark") =>
    points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label="Managed NAV versus the frozen day-0 basket over time" className="mt-3">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={padX} x2={W - padX} y1={padTop + f * (H - padTop - padBot)} y2={padTop + f * (H - padTop - padBot)} stroke="var(--color-hair)" strokeWidth={1} />
      ))}
      <polyline points={path("benchmark")} fill="none" stroke="#8a8f8b" strokeWidth={1.6} strokeDasharray="4 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <polyline points={path("managed")} fill="none" stroke="#1EA84D" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={x(points.length - 1)} cy={y(last.managed)} r={3.2} fill="#1EA84D" />
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-hair px-6 py-4 last:border-b-0 sm:border-b-0">
      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 font-display text-[18px] font-semibold tnum">{value}</p>
    </div>
  );
}

function Rail({ children, good }: { children: React.ReactNode; good?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[12.5px] ${
        good ? "border-green/40 text-green-deep" : "border-hair text-muted"
      }`}
    >
      {good && (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M8 1.6 3.2 3.5v3.6c0 3 2 4.8 4.8 5.9 2.8-1.1 4.8-2.9 4.8-5.9V3.5L8 1.6Z" strokeLinejoin="round" />
        </svg>
      )}
      {children}
    </span>
  );
}
