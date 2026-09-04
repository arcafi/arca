"use client";

import {
  motion,
  AnimatePresence,
  animate,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from "framer-motion";
import { Fragment, useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import type { VaultData, LatestRebalance, LedgerRow } from "../lib/vault";

const ease = [0.22, 1, 0.36, 1] as const;

/* ---------- real on-chain links (RHC mainnet 4663) ---------- */
const EXPLORER = "https://robinhoodchain.blockscout.com";
const VAULT = "0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628";
const LINKS = {
  github: "https://github.com/arcafi/arca",
  x: "https://x.com/arca_fi",
  docs: "/docs",
  vault: `${EXPLORER}/address/${VAULT}`,
};
const tx = (h: string) => `${EXPLORER}/tx/${h}`;
const REBALANCE_FALLBACK_TX = "";
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease } },
};
const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const chipPop: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.96 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, ease } },
};

/** each word rises out of its own mask, staggered. */
function SplitWords({
  words,
  className,
  delay = 0,
}: {
  words: { t: string; accent?: boolean }[];
  className?: string;
  delay?: number;
}) {
  return (
    <span className={className}>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-baseline">
            <motion.span
              initial={{ y: "115%", rotate: 5, opacity: 0 }}
              animate={delay >= 0 ? { y: 0, rotate: 0, opacity: 1 } : undefined}
              whileInView={delay < 0 ? { y: 0, rotate: 0, opacity: 1 } : undefined}
              viewport={delay < 0 ? { once: true, margin: "-80px" } : undefined}
              transition={{ duration: 0.9, ease, delay: Math.abs(delay) + i * 0.07 }}
              className={`inline-block origin-bottom-left ${w.accent ? "italic text-olive" : ""}`}
            >
              {w.t}
            </motion.span>
          </span>{" "}
        </Fragment>
      ))}
    </span>
  );
}

/* ---------- helpers ---------- */

function Ext({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isIn = useInView(ref, { once: true, margin: "-80px" });
  const reduce = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduce ? false : { opacity: 0, y: 20 }}
      animate={isIn ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, ease, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function CountUp({ to, prefix = "", decimals = 2 }: { to: number; prefix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const isIn = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!isIn) return;
    if (reduce) {
      setV(to);
      return;
    }
    const controls = animate(0, to, { duration: 1.1, ease, onUpdate: setV });
    return () => controls.stop();
  }, [isIn, to, reduce]);
  return (
    <span ref={ref} className="tnum">
      {prefix}
      {v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}

const Check = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className}>
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------- nav ---------- */

const NAV_LINKS: [string, string][] = [
  ["How it works", "#how"],
  ["Indexes", "#indexes"],
  ["Lore", "#lore"],
  ["Security", "#security"],
  ["Docs", "/docs"],
];

function Nav() {
  const [open, setOpen] = useState(false);
  return (
    <motion.nav
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease, delay: 0.1 }}
      className="fixed inset-x-0 top-4 z-50 flex justify-center px-4"
    >
      <div className="relative">
        <div className="flex items-center gap-1 rounded-full border border-hair/80 bg-canvas/80 px-2 py-2 shadow-[0_8px_30px_rgba(42,51,27,0.08)] backdrop-blur-md">
          <a href="#top" className="flex items-center gap-2 pl-2 pr-3 font-display text-[19px] font-semibold tracking-tight text-ink">
            <Logo className="h-6 w-auto text-olive" />
            arca
          </a>
          <div className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-3.5 py-2 text-[14.5px] text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
              >
                {label}
              </a>
            ))}
          </div>
          <a
            href="/app"
            className="ml-1 rounded-full bg-ink px-4 py-2 font-body text-[14.5px] font-medium text-canvas transition-transform hover:-translate-y-px"
          >
            Launch app
          </a>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="ml-0.5 flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors hover:bg-ink/[0.06] md:hidden"
          >
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              {open ? (
                <>
                  <path d="M5 5l10 10" />
                  <path d="M15 5L5 15" />
                </>
              ) : (
                <>
                  <path d="M3 6h14" />
                  <path d="M3 10h14" />
                  <path d="M3 14h14" />
                </>
              )}
            </svg>
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 -z-10 md:hidden"
                aria-hidden
              />
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease }}
                className="absolute left-1/2 top-[calc(100%+8px)] w-[min(88vw,320px)] -translate-x-1/2 rounded-3xl border border-hair/80 bg-canvas/95 p-2 shadow-[0_20px_60px_-24px_rgba(42,51,27,0.35)] backdrop-blur-md md:hidden"
              >
                {NAV_LINKS.map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className="block rounded-2xl px-4 py-3 font-body text-[15px] text-ink transition-colors hover:bg-ink/[0.05]"
                  >
                    {label}
                  </a>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.nav>
  );
}

/* ---------- hero ---------- */

function Hero({ rebalance }: { rebalance: LatestRebalance }) {
  return (
    <header id="top" className="grain relative overflow-hidden">
      {/* faint warm grid, fading into the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.6]"
        style={{
          backgroundImage:
            "linear-gradient(var(--color-hair) 1px, transparent 1px), linear-gradient(90deg, var(--color-hair) 1px, transparent 1px)",
          backgroundSize: "46px 46px",
          maskImage: "radial-gradient(120% 88% at 50% 0%, #000 38%, transparent 76%)",
          WebkitMaskImage: "radial-gradient(120% 88% at 50% 0%, #000 38%, transparent 76%)",
        }}
      />
      {/* soft olive light welling up from the floor of the box */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%]"
        style={{
          background:
            "radial-gradient(80% 100% at 50% 120%, color-mix(in srgb, var(--color-olive) 26%, transparent), transparent 70%)",
        }}
      />

      <HeroParallax>
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.p
            initial={{ opacity: 0, letterSpacing: "0.5em" }}
            animate={{ opacity: 1, letterSpacing: "0.2em" }}
            transition={{ duration: 1.1, ease, delay: 0.15 }}
            className="font-mono text-[12px] uppercase text-muted"
          >
            the vault that guards itself · on Robinhood Chain
          </motion.p>

          <h1 className="mx-auto mt-6 max-w-[15ch] font-display text-[clamp(2.9rem,7vw,5.4rem)] font-semibold leading-[1.0] tracking-[-0.025em]">
            <SplitWords
              delay={0.35}
              words={[{ t: "The" }, { t: "vault" }, { t: "that" }, { t: "guards", accent: true }, { t: "itself.", accent: true }]}
            />
          </h1>

          <motion.p variants={fadeUp} className="mx-auto mt-7 max-w-[54ch] text-[18px] leading-relaxed text-ink/75">
            Arca is a fully-backed stock index on Robinhood Chain. One token holds a whole basket
            of tokenized stocks. An autonomous agent rebalances it — and can never withdraw a cent.
            Don&apos;t trust; look inside.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/app"
              className="rounded-full bg-ink px-6 py-3 font-body text-[15px] font-medium text-canvas transition-transform hover:-translate-y-px"
            >
              Launch the app
            </a>
            <a
              href="#lore"
              className="rounded-full border border-ink/15 bg-canvas/60 px-6 py-3 font-body text-[15px] font-medium text-ink transition-colors hover:border-ink/40"
            >
              Read the lore
            </a>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-2 font-mono text-[12.5px] text-muted"
          >
            <span className="inline-flex items-center gap-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-olive opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-olive" />
              </span>
              live on mainnet
            </span>
            <span className="text-hair">·</span>
            <Ext
              href={LINKS.vault}
              className="inline-flex items-center gap-2 rounded-full border border-hair bg-canvas/70 px-3 py-1.5 transition-colors hover:border-ink/30"
            >
              vault <span className="text-ink">{short(VAULT)}</span>
              <span className="text-green-deep">↗</span>
            </Ext>
          </motion.div>
        </motion.div>

        <Receipt rebalance={rebalance} />

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6, duration: 0.8 }}
          className="mt-14 flex flex-col items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.22em] text-muted"
          aria-hidden
        >
          scroll
          <span className="relative h-9 w-px overflow-hidden bg-hair">
            <motion.span
              animate={{ y: ["-100%", "220%"] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute left-0 top-0 h-1/2 w-px bg-olive"
            />
          </span>
        </motion.div>
      </HeroParallax>
    </header>
  );
}

function HeroParallax({ children }: { children: React.ReactNode }) {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 0.1], [0, -40]);
  const opacity = useTransform(scrollYProgress, [0, 0.12], [1, 0.88]);
  return (
    <motion.div style={{ y, opacity }} className="relative mx-auto max-w-[980px] px-6 pt-44 pb-16 text-center">
      {children}
    </motion.div>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const usd = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/** The "latest rebalance" receipt — every field read straight from the on-chain event. */
function Receipt({ rebalance }: { rebalance: LatestRebalance }) {
  const delta = rebalance ? rebalance.navAfter - rebalance.navBefore : 0;
  const held = rebalance ? Math.abs(delta) / Math.max(rebalance.navBefore, 1e-9) < 1e-4 : false;
  const txHref = rebalance?.txHash
    ? tx(rebalance.txHash)
    : REBALANCE_FALLBACK_TX
      ? tx(REBALANCE_FALLBACK_TX)
      : LINKS.vault;

  const rows: [string, React.ReactNode, "up" | "dn" | "hold"][] = rebalance
    ? [
        [
          "Outcome",
          held ? "value-neutral · held flat" : `${delta > 0 ? "+" : "−"}${usd(Math.abs(delta)).slice(1)}`,
          held ? "up" : delta > 0 ? "up" : "dn",
        ],
        [
          "Vault NAV · at this rebalance",
          <span key="nav">
            {usd(rebalance.navBefore)} <span className="text-muted">→</span> {usd(rebalance.navAfter)}
          </span>,
          "hold",
        ],
        ["Rebalancer", short(rebalance.by), "hold"],
      ]
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease, delay: 0.55 }}
      className="mx-auto mt-14 max-w-[520px] overflow-hidden rounded-3xl border border-hair bg-cream-2/60 text-left shadow-[0_24px_60px_-30px_rgba(42,51,27,0.4)]"
    >
      <div className="flex items-start justify-between border-b border-hair px-6 py-4">
        <div>
          <span className="font-display text-[16px] font-semibold">Last rebalance · Arca Frontier</span>
          {rebalance && (
            <span className="mt-0.5 block font-mono text-[11px] text-muted">recorded {timeAgo(rebalance.timestamp)}</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em] text-green-deep">
          <Check className="h-3.5 w-3.5" />
          on-chain
        </span>
      </div>

      {rebalance ? (
        <>
          <p className="border-b border-hair px-6 py-3 text-[12.5px] leading-relaxed text-muted">
            A snapshot of the agent&apos;s last move, exactly as it hit the chain — not a live figure. It
            changes when the agent rebalances again, not when you mint or redeem.
          </p>
          <div className="border-b border-hair px-6 py-4 text-[13.5px] text-ink/80">
            <span className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
              Rationale · committed on-chain
            </span>
            <span className="font-mono text-[12.5px] text-ink">{short(rebalance.rationale)}</span>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              The agent&apos;s note is hashed into the event — tamper-proof, not editable after the fact.
            </p>
          </div>
          <div className="py-1.5">
            {rows.map(([k, v, dir], i) => (
              <motion.div
                key={k}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, ease, delay: 0.95 + i * 0.1 }}
                className="flex items-baseline justify-between border-b border-dashed border-hair px-6 py-3 last:border-0"
              >
                <span className="text-[13.5px] text-muted">{k}</span>
                <span
                  className={`font-mono text-[14px] tnum ${
                    dir === "up" ? "text-green-deep" : dir === "dn" ? "text-[#a2542f]" : "text-ink"
                  }`}
                >
                  {v}
                </span>
              </motion.div>
            ))}
          </div>
        </>
      ) : (
        <div className="border-b border-hair px-6 py-5 text-[13.5px] leading-relaxed text-muted">
          No rebalance on mainnet yet — the vault is freshly deployed. The agent&apos;s first move
          will appear here, straight from the on-chain event.
        </div>
      )}

      <div className="flex items-center justify-between bg-cream-2/70 px-6 py-3.5 font-mono text-[12px] text-muted">
        <span>mainnet · agent rebalancer</span>
        <Ext href={txHref} className="border-b border-olive text-ink">
          {rebalance ? "view tx ↗" : "view vault ↗"}
        </Ext>
      </div>
    </motion.div>
  );
}

/* ---------- lore ---------- */

function Lore() {
  return (
    <section id="lore" className="relative mx-auto max-w-[760px] px-6 py-28">
      <Reveal className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.22em] text-muted">
        the lore
      </Reveal>
      <Reveal delay={0.05}>
        <h2 className="text-center font-display text-[clamp(2rem,4.4vw,3.1rem)] font-medium leading-[1.08] tracking-[-0.02em]">
          <SplitWords
            delay={-0.05}
            words={[{ t: "The" }, { t: "box" }, { t: "was" }, { t: "never" }, { t: "the" }, { t: "problem." }]}
          />
          <span className="mt-1 block italic text-olive">The guard was.</span>
        </h2>
      </Reveal>

      <div className="mx-auto mt-12 max-w-[62ch] space-y-6 text-[17px] leading-[1.75] text-ink/80">
        <Reveal>
          <p>
            <span className="font-display text-[19px] italic text-olive">arca</span> — Latin for the
            strongbox, the chest where Rome kept what mattered. For as long as people have had something
            worth keeping, they built a box to keep it in — and then hired someone to guard the box.
          </p>
        </Reveal>
        <Reveal>
          <p>
            Every vault in history shared one quiet flaw: a human hand held the key. You never really
            trusted the vault. You trusted the person standing in front of it, and hoped they&apos;d still
            be honest tomorrow. Crypto was supposed to end this. Instead it rebuilt it, faster — a founder
            with the multisig, a team wallet with the supply, a manager who swears the funds are safe right
            up until the morning they aren&apos;t.
          </p>
        </Reveal>

        <Reveal>
          <blockquote className="border-l-2 border-olive/40 py-1 pl-6 font-display text-[22px] italic leading-[1.4] text-ink">
            The lock has no key. The custodian is the contract.
          </blockquote>
        </Reveal>

        <Reveal>
          <p>
            Arca is the vault that guards itself. A basket of real, tokenized stocks, sealed by code
            instead of a keeper. An agent can rearrange what&apos;s inside — swapping one holding for
            another as the market moves — but no hand, not the agent&apos;s and not ours, can reach in and
            take anything out.
          </p>
        </Reveal>
        <Reveal>
          <p>
            We started as <span className="font-medium text-ink">Fides</span> — Latin for <em>faith</em>.
            An honest name for a dishonest era, where everyone asks you to have faith in the team. But our
            whole thesis was the opposite of faith. So we kept the discipline and dropped the word. Fides
            was the promise; <span className="font-medium text-ink">Arca</span> is the proof.
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.05} className="mt-14 text-center">
        <p className="font-display text-[clamp(1.6rem,3.4vw,2.3rem)] italic leading-[1.2] text-olive">
          The door is glass.
        </p>
      </Reveal>
    </section>
  );
}

/* ---------- how it works ---------- */

function How() {
  const steps: [string, string, string][] = [
    ["01", "Deposit the basket", "Put in the underlying tokenized stocks and receive one token — your share of the whole index, backed 1:1."],
    ["02", "The agent rebalances", "An autonomous agent rotates the weights on schedule, swapping only within a fixed whitelist. It cannot withdraw, pause, or change the rules."],
    ["03", "Redeem, anytime", "Burn the token and get the basket back, in-kind, matched to exactly what the vault holds. No queue, no permission, no keeper to ask."],
  ];
  return (
    <section id="how" className="mx-auto max-w-[1120px] px-6 py-24">
      <Reveal className="mb-12 max-w-[24ch]">
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.02em]">
          <SplitWords delay={-0.05} words={[{ t: "One" }, { t: "token." }, { t: "A" }, { t: "whole" }, { t: "index,", accent: true }, { t: "sealed.", accent: true }]} />
        </h2>
      </Reveal>
      <div className="grid gap-px overflow-hidden rounded-3xl border border-hair bg-hair sm:grid-cols-3">
        {steps.map(([n, title, body], i) => (
          <Reveal key={n} delay={i * 0.08} className="bg-canvas">
            <div className="flex h-full flex-col p-7">
              <span className="font-mono text-[12px] tracking-[0.1em] text-olive">{n}</span>
              <h3 className="mt-5 font-display text-[20px] font-semibold tracking-tight">{title}</h3>
              <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink/70">{body}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1} className="mt-5 font-mono text-[12.5px] text-muted">
        every step emits an on-chain event —{" "}
        <a href="/map" className="border-b border-olive text-ink">reproduce any number yourself ↗</a>
      </Reveal>
    </section>
  );
}

function Ticker() {
  const syms = ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA", "AMD", "MU", "PLTR", "NFLX", "QQQ", "COIN", "MSTR"];
  const Row = ({ hidden }: { hidden?: boolean }) => (
    <div className="flex shrink-0 items-center" aria-hidden={hidden}>
      {syms.map((s) => (
        <span key={s} className="mx-6 inline-flex items-center gap-2.5 font-mono text-[13.5px] tracking-[0.02em] text-ink/70">
          <span className="h-1.5 w-1.5 rounded-full bg-olive/60" />${s}
        </span>
      ))}
    </div>
  );
  return (
    <section className="border-y border-hair bg-cream-2/50 py-6">
      <p className="mb-4 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
        Backed by real stock tokens on Robinhood Chain
      </p>
      <div className="marquee-mask overflow-hidden">
        <div className="flex w-max animate-marquee">
          <Row />
          <Row hidden />
        </div>
      </div>
    </section>
  );
}

function Baskets({ vault }: { vault: VaultData }) {
  const frontierHolds = vault?.holdings.length ? vault.holdings.map((h) => h.symbol) : ["NVDA", "MSFT", "TSLA", "GOOGL", "SPCX"];
  const cards = [
    {
      name: "Arca Frontier",
      sub: `${frontierHolds.length} tokenized stocks`,
      live: true,
      nav: vault?.navPerShare ?? null,
      backed: vault?.fullyBacked ?? true,
      holds: frontierHolds,
      href: "/app",
    },
    {
      name: "Arca Blue",
      sub: "Mega-cap core",
      live: false,
      nav: null,
      backed: false,
      holds: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
      href: "/docs",
    },
  ];
  return (
    <section id="indexes" className="mx-auto max-w-[1120px] px-6 py-24">
      <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-5">
        <h2 className="max-w-[18ch] font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.02em]">
          <SplitWords
            delay={-0.05}
            words={[{ t: "One" }, { t: "box" }, { t: "open." }, { t: "More", accent: true }, { t: "to", accent: true }, { t: "seal.", accent: true }]}
          />
        </h2>
        <p className="max-w-[46ch] text-[15px] text-muted">
          Each index is one token, backed 1:1 by the stocks it holds and rotated by the agent on
          schedule. Frontier is open now; Blue seals next.
        </p>
      </Reveal>

      <div className="grid gap-5 md:grid-cols-2">
        {cards.map((b, i) => (
          <Reveal key={b.name} delay={i * 0.08}>
            <motion.a
              href={b.href}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className={`group block rounded-3xl border border-hair p-6 transition-colors hover:border-olive/40 ${b.live ? "bg-cream-2/50" : "bg-cream-2/25"}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-display text-[22px] font-semibold tracking-tight">{b.name}</div>
                  <div className="mt-0.5 text-[13.5px] text-muted">{b.sub}</div>
                </div>
                {b.live ? (
                  <span className="rounded-full bg-olive/12 px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-green-deep">
                    ● live · mainnet
                  </span>
                ) : (
                  <span className="rounded-full border border-hair px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                    planned
                  </span>
                )}
              </div>

              {b.live ? (
                <div className="mt-5 flex items-baseline gap-3">
                  <span className="font-mono text-[30px] font-medium tracking-[-0.02em]">
                    {b.nav != null ? <CountUp to={b.nav} prefix="$" /> : "—"}
                  </span>
                  <span className="font-mono text-[13px] text-muted">NAV / token</span>
                  {b.backed && (
                    <span className="ml-auto inline-flex items-center gap-1 font-mono text-[12px] text-green-deep">
                      <Check className="h-3.5 w-3.5" />
                      fully backed
                    </span>
                  )}
                </div>
              ) : (
                <p className="mt-5 max-w-[42ch] text-[13.5px] leading-relaxed text-muted">
                  Launching after Frontier — same guarantees, a mega-cap basket.
                </p>
              )}

              <motion.div
                variants={container}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-60px" }}
                className="mt-5 flex flex-wrap gap-1.5"
              >
                {b.holds.map((h) => (
                  <motion.span
                    key={h}
                    variants={chipPop}
                    className={`rounded-md border border-hair px-2 py-1 font-mono text-[11.5px] ${b.live ? "text-ink/70" : "text-muted"}`}
                  >
                    {h}
                  </motion.span>
                ))}
              </motion.div>

              <div className="mt-5 flex items-center justify-between font-mono text-[12px] text-muted">
                <span>{b.live ? "momentum · weekly" : "mega-cap core"}</span>
                <span className="inline-flex items-center gap-1 font-medium text-ink">
                  {b.live ? "Open index" : "Read the docs"}
                  <span className="transition-transform group-hover:translate-x-0.5">↗</span>
                </span>
              </div>
            </motion.a>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Security() {
  const cells = [
    ["Redeem", "Always on"],
    ["Admin over funds", "None"],
    ["Custody", "In the contract"],
    ["Every decision", "On-chain"],
  ];
  return (
    <section id="security" className="mx-auto max-w-[1120px] px-6 pb-24">
      <Reveal>
        <div className="grain relative overflow-hidden rounded-[28px] bg-dark px-8 py-12 text-canvas sm:px-12">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
            <h2 className="max-w-[16ch] font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.02em] text-canvas">
              <SplitWords delay={-0.05} words={[{ t: "No" }, { t: "key." }, { t: "No" }, { t: "keeper." }, { t: "No", accent: true }, { t: "exit.", accent: true }]} />
            </h2>
            <p className="max-w-[44ch] text-[15px] text-[#c3c9ab]">
              The agent sets the weights. It never holds the keys. This isn&apos;t a pledge — it&apos;s
              what the code permits, and what it plainly forbids.
            </p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-dark-hair md:grid-cols-4">
            {cells.map(([lab, val], i) => (
              <div
                key={lab}
                className={`bg-dark px-5 py-6 ${i % 2 === 0 ? "border-r border-dark-hair" : ""} ${
                  i < 2 ? "border-b border-dark-hair" : ""
                } md:border-b-0 ${i < 3 ? "md:border-r" : ""} md:border-dark-hair`}
              >
                <div className="font-mono text-[11.5px] uppercase tracking-[0.08em] text-[#c3c9ab]">{lab}</div>
                <div className="mt-2 flex items-center gap-2 font-display text-[18px] font-medium">
                  <Check className="h-[15px] w-[15px] text-[#a7c06a]" />
                  {val}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 font-mono text-[12.5px] text-[#c3c9ab]">
            Agent&apos;s only powers:{" "}
            <b className="font-medium text-canvas">rebalance within a fixed whitelist</b>, capped slippage
            and turnover. It cannot withdraw, cannot pause your redemption, cannot change the rules after
            deploy.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <section id="ledger" className="mx-auto max-w-[1120px] px-6 pb-24">
      <Reveal className="mb-10 flex flex-wrap items-end justify-between gap-5">
        <h2 className="font-display text-[clamp(1.9rem,3.6vw,2.6rem)] font-medium leading-[1.08] tracking-[-0.02em]">
          <SplitWords delay={-0.05} words={[{ t: "The" }, { t: "ledger", accent: true }]} />
        </h2>
        <p className="max-w-[46ch] text-[15px] text-muted">
          Every move, on-chain and in order — read live from the vault&apos;s own Mint, Redeem, and
          Rebalanced events. Click any row to verify.{" "}
          <a href="/activity" className="whitespace-nowrap border-b border-olive font-medium text-ink">
            Full activity &amp; holders →
          </a>
        </p>
      </Reveal>

      {rows.length === 0 ? (
        <Reveal className="rounded-2xl border border-hair bg-cream-2/50 px-5 py-6 text-[14px] leading-relaxed text-muted">
          No activity on mainnet yet — the vault is freshly deployed. The first mint, redeem, and rebalance
          will appear here, read live from the vault&apos;s own events.
        </Reveal>
      ) : (
        <div className="relative pl-6">
          <motion.div
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 1.2, ease }}
            className="absolute left-[5px] top-2 bottom-2 w-px origin-top bg-hair"
          />
          {rows.map((f, i) => (
            <Reveal key={`${f.txHash}-${i}`} delay={i * 0.06} className="relative pb-6 last:pb-0">
              <span className="absolute -left-[23px] top-2 h-2.5 w-2.5 rounded-full border-2 border-canvas bg-olive" />
              <Ext
                href={tx(f.txHash)}
                className="block rounded-2xl border border-hair bg-cream-2/50 px-5 py-4 transition-colors hover:border-olive/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex items-baseline gap-2.5">
                    <span className="rounded-md bg-olive/12 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.06em] text-green-deep">
                      {f.type}
                    </span>
                    <b className="text-[14.5px] font-semibold">{f.title}</b>
                    <span className="font-mono text-[11.5px] text-muted">{timeAgo(f.timestamp)}</span>
                  </div>
                  <span className="font-mono text-[12px] text-green-deep">{short(f.txHash)} ↗</span>
                </div>
                <p className="mt-1.5 text-[13.5px] text-muted">{f.detail}</p>
              </Ext>
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}

function Footer() {
  const links: [string, string][] = [
    ["X", LINKS.x],
    ["Docs", LINKS.docs],
    ["Activity", "/activity"],
    ["Liquidity map", "/map"],
    ["Explorer", LINKS.vault],
    ["GitHub", LINKS.github],
  ];
  return (
    <footer className="border-t border-hair py-12">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-5 px-6">
        <div className="max-w-[60ch]">
          <div className="mb-3 flex items-center gap-2 font-display text-[17px] font-semibold">
            <Logo className="h-5 w-auto text-olive" />
            arca
          </div>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Arca is live on Robinhood Chain mainnet — vault figures and ledger entries are real on-chain
            reads. Underlying stock tokens are debt instruments of Robinhood Assets (Jersey) Ltd, not
            equity. Early-stage software; not investment advice.
          </p>
        </div>
        <div className="flex flex-wrap gap-5 font-mono text-[13px]">
          {links.map(([label, href]) =>
            href.startsWith("/") ? (
              <a key={label} href={href} className="text-muted transition-colors hover:text-ink">
                {label}
              </a>
            ) : (
              <Ext key={label} href={href} className="text-muted transition-colors hover:text-ink">
                {label}
              </Ext>
            ),
          )}
        </div>
      </div>
    </footer>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-2 font-mono text-[26px] font-medium tracking-[-0.02em] tnum">{value}</div>
    </div>
  );
}

function LiveVault({ data }: { data: VaultData }) {
  if (!data) return null;
  return (
    <section className="mx-auto max-w-[1120px] px-6 pb-6 pt-2">
      <Reveal>
        <div className="rounded-3xl border border-hair bg-cream-2/50 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hair pb-5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-olive opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-olive" />
              </span>
              <span className="font-display text-[16px] font-semibold">Live on mainnet · {data.name}</span>
            </div>
            <Ext href={LINKS.vault} className="font-mono text-[12.5px] text-green-deep">
              {short(VAULT)} ↗
            </Ext>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-7 py-7 sm:grid-cols-4">
            <Stat label="NAV / token" value={<CountUp to={data.navPerShare} prefix="$" />} />
            <Stat label="Total value" value={<CountUp to={data.navUsd} prefix="$" />} />
            <Stat label="Tokens outstanding" value={<CountUp to={data.supply} decimals={2} />} />
            <Stat
              label="Backing"
              value={
                data.fullyBacked ? (
                  <span className="inline-flex items-center gap-1.5 text-green-deep">
                    <Check className="h-4 w-4" />
                    <span className="font-display text-[20px]">Fully backed</span>
                  </span>
                ) : (
                  "—"
                )
              }
            />
          </div>

          <motion.div
            variants={container}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="flex flex-wrap gap-2 border-t border-hair pt-5"
          >
            <span className="mr-1 self-center font-mono text-[11px] uppercase tracking-[0.08em] text-muted">holds</span>
            {data.holdings.map((h) => (
              <motion.span
                key={h.symbol}
                variants={chipPop}
                whileHover={{ y: -2 }}
                className="rounded-lg border border-hair px-2.5 py-1.5 font-mono text-[12px]"
              >
                <span className="text-ink">{h.symbol}</span>{" "}
                <span className="tnum text-muted">{h.balance.toFixed(4)}</span>
              </motion.span>
            ))}
          </motion.div>
        </div>
      </Reveal>
    </section>
  );
}

export function Landing({
  vault,
  rebalance,
  ledger,
}: {
  vault: VaultData;
  rebalance: LatestRebalance;
  ledger: LedgerRow[];
}) {
  return (
    <main>
      <Nav />
      <Hero rebalance={rebalance} />
      <Ticker />
      <LiveVault data={vault} />
      <Lore />
      <How />
      <Baskets vault={vault} />
      <Security />
      <Ledger rows={ledger} />
      <Footer />
    </main>
  );
}
