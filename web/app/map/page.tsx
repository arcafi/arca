import type { Metadata } from "next";
import { Logo } from "../components/Logo";
import map from "../data/liquidity-map.json";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RHC Stock Liquidity Map — which tokenized stocks actually trade",
  description:
    "A live, on-chain map of real Uniswap v4 liquidity for tokenized stocks on Robinhood Chain. Most never truly trade — see the ones that do, verifiable by anyone.",
};

type Stock = {
  sym: string;
  name: string;
  token: string;
  status: "tradeable" | "thin" | "dead" | "none";
  twoWay: string;
  impact10: number | null;
  spread: number | null;
  fee: number | null;
};

const EXPLORER = "https://robinhoodchain.blockscout.com";

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

const STATUS_LABEL: Record<string, string> = { tradeable: "tradeable", thin: "thin", dead: "dead", none: "no pool" };
const STATUS_STYLE: Record<string, string> = {
  tradeable: "bg-green/10 text-green-deep",
  thin: "bg-[#b8860b]/12 text-[#8a6d15]",
  dead: "bg-[#a23b2f]/10 text-[#a23b2f]",
  none: "bg-ink/[0.06] text-muted",
};
const fee = (f: number | null) => (f == null ? "—" : `${(f / 10000).toFixed(2)}%`);
const pct = (n: number | null) => (n == null ? "revert" : `${n > 0 ? "+" : ""}${n}%`);

export default function MapPage() {
  const stocks = map.stocks as Stock[];
  const s = map.summary as { total: number; tradeable: number; thin: number; dead: number; none: number };

  return (
    <div className="min-h-screen text-ink">
      <div className="sticky top-0 z-40 border-b border-hair bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between px-4 py-3.5 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
            <Logo className="h-5 w-auto" />
            Arca
            <span className="ml-1 hidden rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-muted sm:inline-block">
              liquidity map
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

      <div className="mx-auto max-w-[1040px] px-6 pt-12 pb-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-green-deep">Quoted on-chain · refreshed daily</p>
        <h1 className="mt-3 font-display text-[clamp(28px,5vw,44px)] font-bold leading-[1.05] tracking-tight">
          A listing isn&apos;t liquidity.
        </h1>
        <p className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-muted">
          Robinhood Chain lists dozens of tokenized stocks — but a token existing doesn&apos;t mean you can trade it.
          For each one we quote a real Uniswap v4 swap against USDG and hold the pool price against its Chainlink oracle:
          which carry genuine two-way depth, which are paper-thin, which are pure mirage. Depth here shifts fast, so
          we re-quote it daily. Don&apos;t trust the table — every number reproduces with a single{" "}
          <code className="rounded bg-ink/[0.05] px-1 py-0.5 font-mono text-[12.5px]">cast</code> call.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Checked", String(s.total), "text-ink"],
              ["Tradeable", String(s.tradeable), "text-green-deep"],
              ["Thin", String(s.thin), "text-[#8a6d15]"],
              ["Dead / no pool", String(s.dead + s.none), "text-[#a23b2f]"],
            ] as const
          ).map(([k, v, c]) => (
            <div key={k} className="rounded-2xl border border-hair bg-white px-5 py-4">
              <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">{k}</p>
              <p className={`mt-1 font-display text-[24px] font-semibold tnum ${c}`}>{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[11.5px] text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-green" />Tradeable · deep two-way</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#b8860b]" />Thin · one side only</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#a23b2f]" />Dead / mispriced / no pool</span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-hair bg-white">
          <table className="w-full min-w-[680px] text-left">
            <thead>
              <tr className="border-b border-hair font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
                <th className="px-5 py-3 font-normal">Stock</th>
                <th className="px-5 py-3 font-normal">2-way depth</th>
                <th className="px-5 py-3 text-right font-normal">impact @ $10k</th>
                <th className="px-5 py-3 text-right font-normal">pool vs oracle</th>
                <th className="px-5 py-3 font-normal">venue</th>
                <th className="px-5 py-3 font-normal">status</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((r) => (
                <tr key={r.sym} className={`border-b border-hair/60 last:border-0 ${r.status === "dead" || r.status === "none" ? "opacity-55" : ""}`}>
                  <td className="px-5 py-3">
                    <a href={`${EXPLORER}/address/${r.token}`} target="_blank" rel="noopener noreferrer" className="group inline-flex items-baseline gap-2">
                      <span className="font-mono text-[13px] font-bold">{r.sym}</span>
                      <span className="text-[12px] text-muted group-hover:text-ink">{r.name}</span>
                    </a>
                  </td>
                  <td className="px-5 py-3 font-mono text-[12.5px] text-muted">{r.twoWay}</td>
                  <td className={`px-5 py-3 text-right font-mono text-[12.5px] tnum ${r.status === "tradeable" ? "text-green-deep" : r.impact10 == null ? "text-[#a23b2f]" : "text-muted"}`}>
                    {pct(r.impact10)}
                  </td>
                  <td className="px-5 py-3 text-right font-mono text-[12.5px] tnum text-muted">
                    {r.spread == null ? "—" : `${r.spread > 0 ? "+" : ""}${r.spread}%`}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-muted">{r.fee == null ? "—" : `Uniswap v4 · ${fee(r.fee)}`}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${STATUS_STYLE[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 rounded-2xl border border-hair bg-canvas px-5 py-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Verify any row yourself</p>
          <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-relaxed text-[#3b3f42]">{`# $10k of USDG -> how much NVDA? a revert means the pool is a mirage.
cast call 0x8dc178efb8111bb0973dd9d722ebeff267c98f94 \\
  "quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)" \\
  "((0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,3000,60,0x0000000000000000000000000000000000000000),true,10000000000,0x)" \\
  --rpc-url https://rpc.mainnet.chain.robinhood.com
# -> 46976534127289052879  (~46.98 NVDA for $10k · 18 decimals)`}</pre>
        </div>

        <p className="mt-6 font-mono text-[12px] text-muted">
          {s.tradeable} of {s.total} tokenized stocks have real two-way depth · quoted vs USDG on Uniswap v4 ·
          updated {timeAgo(map.updated)} · an{" "}
          <a href="/" className="border-b border-green text-ink">Arca</a> utility — the tradeable names are the ones we
          index.
        </p>
      </div>
    </div>
  );
}
