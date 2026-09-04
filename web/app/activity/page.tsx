import type { Metadata } from "next";
import { Logo } from "../components/Logo";
import { EXPLORER, VAULT_ADDRESS } from "../lib/appchain";
import { getActivity, getHolders, getVaultData } from "../lib/vault";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Arca Activity — every transaction, live",
  description:
    "The live public ledger of the Arca index: every zap, mint, redeem and rebalance, each with the wallet behind it, read straight from on-chain events.",
};

const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

const KIND_STYLE: Record<string, string> = {
  "Zap in": "bg-green/10 text-green-deep",
  Mint: "bg-green/10 text-green-deep",
  "Zap out": "bg-[#a23b2f]/10 text-[#a23b2f]",
  Redeem: "bg-[#a23b2f]/10 text-[#a23b2f]",
  Rebalance: "bg-ink/[0.06] text-ink",
};

export default async function ActivityPage() {
  const [rows, { holders, count }, vault] = await Promise.all([getActivity(), getHolders(), getVaultData()]);

  const stats: [string, string][] = [
    ["TVL", vault ? money(vault.navUsd) : "—"],
    ["Tokens outstanding", vault ? vault.supply.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"],
    ["Holders", String(count)],
    ["Transactions", String(rows.length)],
  ];

  return (
    <div className="min-h-screen text-ink">
      {/* top bar */}
      <div className="sticky top-0 z-40 border-b border-hair bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between px-4 py-3.5 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
            <Logo className="h-5 w-auto" />
            Arca
            <span className="ml-1 hidden rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted sm:inline-block">
              activity
            </span>
          </a>
          <div className="flex items-center gap-2">
            <a
              href="/app"
              className="rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium transition-colors hover:border-ink/30"
            >
              Open app
            </a>
            <a
              href="/"
              className="group inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium transition-colors hover:border-ink/30"
            >
              <span aria-hidden className="text-green-deep transition-transform group-hover:-translate-x-0.5">←</span>
              Back to site
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1000px] px-6 pt-12 pb-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-green-deep">The public ledger, live</p>
        <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] font-bold leading-[1.05] tracking-tight">
          Every transaction. Every wallet. On the record.
        </h1>
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-muted">
          This page is not a database — every row below is read live, straight from the vault&apos;s and
          zapper&apos;s own on-chain events. Don&apos;t trust it: click any row and verify it on the explorer.
        </p>

        {/* stats */}
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-2xl border border-hair bg-white px-5 py-4">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{k}</p>
              <p className="mt-1 font-display text-[22px] font-semibold tnum">{v}</p>
            </div>
          ))}
        </div>

        {/* activity feed */}
        <h2 className="mt-12 font-display text-[20px] font-semibold">Activity</h2>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-hair bg-white">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="border-b border-hair font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
                <th className="px-5 py-3 font-normal">Action</th>
                <th className="px-5 py-3 font-normal">Wallet</th>
                <th className="px-5 py-3 text-right font-normal">Index tokens</th>
                <th className="px-5 py-3 text-right font-normal">USDG</th>
                <th className="px-5 py-3 text-right font-normal">When</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-[13.5px] text-muted">
                    No activity yet — the first transaction will appear here, straight from the chain.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.txHash}-${r.kind}`} className="border-b border-hair/60 last:border-0">
                  <td className="px-5 py-3">
                    <a
                      href={`${EXPLORER}/tx/${r.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`inline-block rounded-md px-2 py-0.5 font-mono text-[11.5px] ${KIND_STYLE[r.kind]}`}
                    >
                      {r.kind} ↗
                    </a>
                  </td>
                  <td className="px-5 py-3">
                    <a
                      href={`${EXPLORER}/address/${r.wallet}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-b border-green/50 font-mono text-[12.5px] text-ink"
                    >
                      {short(r.wallet)}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12.5px] tnum">
                    {r.kind === "Rebalance" ? "—" : r.tokens.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12.5px] tnum">
                    {r.usdg !== undefined ? money(r.usdg) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12px] text-muted">{timeAgo(r.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* holders */}
        <h2 className="mt-12 font-display text-[20px] font-semibold">Holders</h2>
        <p className="mt-2 text-[13.5px] text-muted">
          Derived from the index token&apos;s own Transfer events — {count} wallet{count === 1 ? "" : "s"} currently
          hold{count === 1 ? "s" : ""} the index.
        </p>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-hair bg-white">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="border-b border-hair font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
                <th className="px-5 py-3 font-normal">#</th>
                <th className="px-5 py-3 font-normal">Wallet</th>
                <th className="px-5 py-3 text-right font-normal">Index tokens</th>
                <th className="px-5 py-3 text-right font-normal">Share</th>
              </tr>
            </thead>
            <tbody>
              {holders.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-[13.5px] text-muted">
                    No holders yet.
                  </td>
                </tr>
              )}
              {holders.map((h, i) => (
                <tr key={h.address} className="border-b border-hair/60 last:border-0">
                  <td className="px-5 py-3 font-mono text-[12px] text-muted">{i + 1}</td>
                  <td className="px-5 py-3">
                    <a
                      href={`${EXPLORER}/address/${h.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-b border-green/50 font-mono text-[12.5px] text-ink"
                    >
                      {short(h.address)}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12.5px] tnum">
                    {h.balance.toLocaleString("en-US", { maximumFractionDigits: 6 })}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12.5px] tnum">{h.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 font-mono text-[12px] text-muted">
          vault{" "}
          <a
            href={`${EXPLORER}/address/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="border-b border-green text-ink"
          >
            {short(VAULT_ADDRESS)} ↗
          </a>{" "}
          · mainnet · refreshes on every visit
        </p>
      </div>
    </div>
  );
}
