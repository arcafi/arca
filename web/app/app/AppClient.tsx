"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type EIP1193Provider,
} from "viem";
import { Logo } from "../components/Logo";
import {
  CHAIN_ID,
  CHAIN_ID_HEX,
  EXPLORER,
  USDG_ADDRESS,
  USDG_DECIMALS,
  VAULT_ADDRESS,
  ZAPPER_ADDRESS,
  addChainParams,
  aggregatorAbi,
  erc20Abi,
  redeemPayout,
  requiredDeposit,
  rhcChain,
  vaultAbi,
  zapperAbi,
} from "../lib/appchain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

type AssetRow = {
  address: Address;
  symbol: string;
  unit: bigint;
  wallet: bigint;
  allowance: bigint;
  value: bigint; // USD (18-dec) that this asset contributes to backing ONE index token
};

type VaultState = {
  assets: AssetRow[];
  nav: bigint;
  supply: bigint;
  supplyCap: bigint;
  fullyBacked: boolean;
  mintPaused: boolean;
  mintFeeBps: number;
  shares: bigint; // user's index-token balance
  lastRebalance: number; // unix seconds
};

type TxItem = { label: string; hash: string; status: "pending" | "ok" | "fail" };

const fmt = (v: bigint, dp = 4) =>
  Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: dp });

const usd = (v: bigint, dp = 2) =>
  `$${Number(formatUnits(v, 18)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: dp })}`;

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

// muted, on-brand allocation colors (not a rainbow) — green family + earth tones
const ALLOC = ["#1EA84D", "#17191B", "#c98a2b", "#5f7a8a", "#b5623f", "#6b8f71", "#8a6d3b"];

export function AppClient() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [tab, setTab] = useState<"mint" | "redeem" | "zap">(ZAPPER_ADDRESS ? "zap" : "mint");
  const [zapDir, setZapDir] = useState<"in" | "out">("in");
  const [copiedUsdg, setCopiedUsdg] = useState(false);
  const [usdg, setUsdg] = useState<{ bal: bigint; allowance: bigint; shareAllowance: bigint } | null>(null);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadStale, setLoadStale] = useState(false);
  const actionRef = useRef<HTMLDivElement>(null);
  const disconnectedRef = useRef(false); // stay disconnected after an explicit disconnect
  const goToAction = (t: "mint" | "redeem") => {
    setTab(t);
    actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const eth = typeof window !== "undefined" ? window.ethereum : undefined;

  // Reads go through our same-origin proxy (-> Alchemy server-side): reliable regardless of the
  // wallet's own RPC config, no CORS, key never reaches the browser. The wallet only signs.
  const pub = useMemo(() => createPublicClient({ chain: rhcChain, transport: http("/api/rpc") }), []);
  const wallet = useMemo(
    () => (eth ? createWalletClient({ chain: rhcChain, transport: custom(eth) }) : null),
    [eth],
  );

  /* ---------- connection & chain ---------- */

  const refreshChain = useCallback(async () => {
    if (!eth) return;
    const id = (await eth.request({ method: "eth_chainId" })) as string;
    setChainOk(parseInt(id, 16) === CHAIN_ID);
  }, [eth]);

  const connect = useCallback(async () => {
    if (!eth) return;
    setErr(null);
    disconnectedRef.current = false;
    try {
      const accs = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (accs[0]) setAccount(accs[0] as Address);
      await refreshChain();
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [eth, refreshChain]);

  // UI-level disconnect: EIP-1193 has no true "disconnect", so we clear local state and stop
  // auto-reflecting the wallet until the user connects again.
  const disconnect = useCallback(() => {
    disconnectedRef.current = true;
    setAccount(null);
    setChainOk(false);
    setTxs([]);
  }, []);

  const switchChain = useCallback(async () => {
    if (!eth) return;
    setErr(null);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN_ID_HEX }],
      });
    } catch {
      // unknown chain → offer to add it
      try {
        await eth.request({ method: "wallet_addEthereumChain", params: [addChainParams] });
      } catch (e2) {
        setErr((e2 as Error).message);
      }
    }
    await refreshChain();
  }, [eth, refreshChain]);

  /* ---------- data ---------- */

  const load = useCallback(async (attempt = 0) => {
    if (!pub || !account || !chainOk) return;
    try {
      const [assets, units, nav, supply, cap, backed, paused, feeBps, shares, lastReb] = await Promise.all([
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "assets" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "units" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "nav" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "totalSupply" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "supplyCap" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "isFullyBacked" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "mintPaused" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "mintFeeBps" }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "balanceOf", args: [account] }),
        pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "lastRebalance" }),
      ]);
      const rows = await Promise.all(
        (assets as readonly Address[]).map(async (a, i): Promise<AssetRow> => {
          const unit = (units as readonly bigint[])[i];
          const [symbol, bal, allo, feed] = await Promise.all([
            pub.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }),
            pub.readContract({ address: a, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
            pub.readContract({ address: a, abi: erc20Abi, functionName: "allowance", args: [account, VAULT_ADDRESS] }),
            pub.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName: "oracleOf", args: [a] }),
          ]);
          // value backing one index token, exactly as the vault's _value(): unit * price / 10^feedDecimals
          let value = 0n;
          try {
            const [rd, dec] = await Promise.all([
              pub.readContract({ address: feed as Address, abi: aggregatorAbi, functionName: "latestRoundData" }),
              pub.readContract({ address: feed as Address, abi: aggregatorAbi, functionName: "decimals" }),
            ]);
            const answer = (rd as readonly bigint[])[1];
            if (answer > 0n) value = (unit * answer) / 10n ** BigInt(Number(dec));
          } catch {
            // a flaky feed read just leaves this asset's weight at 0 for this pass
          }
          return { address: a, symbol: symbol as string, unit, wallet: bal as bigint, allowance: allo as bigint, value };
        }),
      );
      setVault({
        assets: rows,
        nav: nav as bigint,
        supply: supply as bigint,
        supplyCap: cap as bigint,
        fullyBacked: backed as boolean,
        mintPaused: paused as boolean,
        mintFeeBps: Number(feeBps),
        shares: shares as bigint,
        lastRebalance: Number(lastReb as bigint),
      });
      if (ZAPPER_ADDRESS) {
        const [uBal, uAllo, sAllo] = await Promise.all([
          pub.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
          pub.readContract({
            address: USDG_ADDRESS,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, ZAPPER_ADDRESS],
          }),
          pub.readContract({
            address: VAULT_ADDRESS,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account, ZAPPER_ADDRESS],
          }),
        ]);
        setUsdg({ bal: uBal as bigint, allowance: uAllo as bigint, shareAllowance: sAllo as bigint });
      }
      setLoadStale(false);
    } catch {
      // background read hiccup (RPC blip): retry quietly, never paint a scary tx-style error
      if (attempt < 3) {
        setTimeout(() => load(attempt + 1), 1500 * (attempt + 1));
      } else {
        setLoadStale(true);
      }
    }
  }, [pub, account, chainOk]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!eth) return;
    const onAccounts = (accs: unknown) => {
      if (disconnectedRef.current) return; // honor an explicit disconnect until the user reconnects
      setAccount(((accs as string[])[0] as Address) ?? null);
    };
    const onChain = () => refreshChain();
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth, refreshChain]);

  /* ---------- amounts ---------- */

  const shares = useMemo(() => {
    try {
      const v = parseUnits((amount || "0").replace(",", "."), 18);
      return v > 0n ? v : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);

  const mintRows = useMemo(
    () =>
      vault?.assets.map((a) => {
        const need = requiredDeposit(shares, a.unit);
        return { ...a, need, enough: a.wallet >= need, approved: a.allowance >= need };
      }) ?? [],
    [vault, shares],
  );

  // the most index tokens the CURRENT tab can handle, from the user's real balances
  const maxShares = useMemo(() => {
    if (tab === "redeem" || (tab === "zap" && zapDir === "out")) return vault?.shares ?? 0n;
    if (tab === "zap" && zapDir === "in") {
      // affordable with the USDG balance, leaving room for the +2% spend cap (uses /103 so
      // the resulting maxIn stays under the balance even after rounding)
      const bv = vault?.assets.reduce((s, a) => s + a.value, 0n) ?? 0n;
      return usdg && bv > 0n ? (((usdg.bal * 100n) / 103n) * 10n ** 30n) / bv : 0n;
    }
    if (tab === "mint" && vault) {
      let m: bigint | null = null;
      for (const a of vault.assets) {
        if (a.unit === 0n) continue;
        const s = (a.wallet * 10n ** 18n) / a.unit; // shares this leg's wallet balance can back
        m = m === null || s < m ? s : m;
      }
      return m ?? 0n;
    }
    return 0n;
  }, [tab, zapDir, vault, usdg]);
  const allEnough = mintRows.every((r) => r.enough);
  const allApproved = mintRows.every((r) => r.approved);
  const feeShares = vault ? (shares * BigInt(vault.mintFeeBps)) / 10_000n : 0n;

  /* ---------- txs ---------- */

  const sendTx = useCallback(
    async (label: string, fn: () => Promise<`0x${string}`>) => {
      if (!pub) return;
      setBusy(label);
      setErr(null);
      try {
        const hash = await fn();
        setTxs((t) => [{ label, hash, status: "pending" as const }, ...t].slice(0, 6));
        const rcpt = await pub.waitForTransactionReceipt({ hash });
        setTxs((t) => t.map((x) => (x.hash === hash ? { ...x, status: rcpt.status === "success" ? "ok" : "fail" } : x)));
        await load();
      } catch (e) {
        setErr((e as Error).message.split("\n")[0]);
      } finally {
        setBusy(null);
      }
    },
    [pub, load],
  );

  const approve = (row: AssetRow & { need: bigint }) =>
    sendTx(`Approve ${row.symbol}`, () =>
      wallet!.writeContract({
        address: row.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [VAULT_ADDRESS, row.need],
        account: account!,
        chain: rhcChain,
      }),
    );

  const doMint = () =>
    sendTx(`Mint ${fmt(shares)} `, () =>
      wallet!.writeContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "mint",
        args: [shares, account!],
        account: account!,
        chain: rhcChain,
      }),
    );

  const doRedeem = () =>
    sendTx(`Redeem ${fmt(shares)} `, () =>
      wallet!.writeContract({
        address: VAULT_ADDRESS,
        abi: vaultAbi,
        functionName: "redeem",
        args: [shares, account!],
        account: account!,
        chain: rhcChain,
      }),
    );

  /* ---------- zap (USDG <-> index, one click) ---------- */

  // oracle value of ONE index token (18-dec USD) — same math the vault's nav() uses
  const basketValue18 = useMemo(() => vault?.assets.reduce((s, a) => s + a.value, 0n) ?? 0n, [vault]);
  // estimated USDG (6 dec) to buy / receive for `shares`
  const zapEstUsdg = useMemo(
    () => (basketValue18 > 0n ? (shares * basketValue18) / 10n ** BigInt(36 - USDG_DECIMALS) : 0n),
    [shares, basketValue18],
  );
  const zapMaxIn = (zapEstUsdg * 102n) / 100n; // +2% headroom for pool fees + impact
  const zapMinOut = (zapEstUsdg * 97n) / 100n; // accept -3% on the way out
  const usdgFmt = (v: bigint) =>
    Number(formatUnits(v, USDG_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });

  const approveUsdgZap = () =>
    sendTx("Approve USDG", () =>
      wallet!.writeContract({
        address: USDG_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [ZAPPER_ADDRESS as Address, zapMaxIn],
        account: account!,
        chain: rhcChain,
      }),
    );

  const doZapMint = () =>
    sendTx(`Zap in ${fmt(shares)} `, () =>
      wallet!.writeContract({
        address: ZAPPER_ADDRESS as Address,
        abi: zapperAbi,
        functionName: "zapMint",
        args: [shares, zapMaxIn, account!],
        account: account!,
        chain: rhcChain,
      }),
    );

  const approveSharesZap = () =>
    sendTx("Approve index", () =>
      wallet!.writeContract({
        address: VAULT_ADDRESS,
        abi: erc20Abi,
        functionName: "approve",
        args: [ZAPPER_ADDRESS as Address, shares],
        account: account!,
        chain: rhcChain,
      }),
    );

  const doZapRedeem = () =>
    sendTx(`Zap out ${fmt(shares)} `, () =>
      wallet!.writeContract({
        address: ZAPPER_ADDRESS as Address,
        abi: zapperAbi,
        functionName: "zapRedeem",
        args: [shares, zapMinOut, account!],
        account: account!,
        chain: rhcChain,
      }),
    );

  /* ---------- ui ---------- */

  const pill =
    "rounded-full bg-ink px-5 py-2.5 font-display text-[14px] font-medium text-canvas transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0";

  const gate = !eth ? (
    <Gate title="No wallet detected">
      Arca reaches Robinhood Chain through your wallet. Install MetaMask (or any
      EIP-1193 wallet), then reload.
    </Gate>
  ) : !account ? (
    <Gate title="Connect to launch">
      Buy the entire 5-stock index with USDG in one click — or mint and redeem in-kind if you
      already hold the stocks. Live on Robinhood Chain mainnet; a guided 3-step flow begins once you connect.
      <button onClick={connect} className={`${pill} mt-6`}>
        Connect wallet
      </button>
      {err && <ErrLine msg={err} />}
    </Gate>
  ) : !chainOk ? (
    <Gate title="Wrong network">
      Arca lives on Robinhood Chain <b>mainnet</b> (chain 4663). Switch networks — or let your wallet
      add it for you.
      <button onClick={switchChain} className={`${pill} mt-6`}>
        Switch to Robinhood Chain
      </button>
      {err && <ErrLine msg={err} />}
    </Gate>
  ) : null;

  return (
    <div className="min-h-screen text-ink">
      <AppHeader
        hasWallet={!!eth}
        account={account}
        chainOk={chainOk}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      <div className="mx-auto max-w-[880px] px-6 pt-12 pb-6">
        <h1 className="font-display text-[clamp(1.7rem,3.2vw,2.2rem)] font-semibold tracking-[-0.02em]">
          Mint and redeem, straight from the vault.
        </h1>
        <p className="mt-2 max-w-[58ch] text-[14.5px] leading-relaxed text-muted">
          Pay in USDG and hold the full 5-stock index in a single click — the zapper buys the basket
          and mints in one atomic step. Want full control? Mint and redeem in-kind, straight from the vault.
        </p>
      </div>

      {gate ?? (
        <div className="mx-auto max-w-[880px] px-6 pb-24">
          {/* vault header */}
      <div className="mb-6 rounded-3xl border border-hair bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green" />
            </span>
            <span className="font-display text-[16px] font-semibold">Arca Frontier · mainnet</span>
          </div>
          <a
            href={`${EXPLORER}/address/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[12px] text-green-deep"
          >
            {VAULT_ADDRESS.slice(0, 6)}…{VAULT_ADDRESS.slice(-4)} ↗
          </a>
        </div>
        {vault && (
          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="Your index tokens" value={fmt(vault.shares)} />
            <Metric label="NAV / token" value={vault.supply > 0n ? `$${fmt((vault.nav * 10n ** 18n) / vault.supply, 2)}` : "—"} />
            <Metric label="Total supply" value={fmt(vault.supply)} />
            <Metric label="Backing" value={vault.fullyBacked ? "Fully backed ✓" : "—"} good={vault.fullyBacked} />
          </div>
        )}
        {loadStale && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-[#c98a2b]/30 bg-[#c98a2b]/[0.06] px-3.5 py-2 font-mono text-[12px] text-[#9a6a1f]">
            <span>network hiccup — figures may be stale</span>
            <button onClick={() => load()} className="rounded-md border border-[#9a6a1f]/30 px-2.5 py-1 transition-colors hover:border-[#9a6a1f]/60">
              refresh
            </button>
          </div>
        )}
      </div>

      {/* your position — the holder's live view: what they own, that it's being managed, that it's redeemable */}
      {vault && vault.shares > 0n && (
        <PositionCard vault={vault} onAdd={() => goToAction("mint")} onRedeem={() => goToAction("redeem")} />
      )}

      {/* action card */}
      <div ref={actionRef} className="rounded-3xl border border-hair bg-white p-6">
        <div className="mb-5 flex gap-1 rounded-full border border-hair bg-canvas p-1 font-display text-[14px] font-medium">
          {((ZAPPER_ADDRESS ? ["zap", "mint", "redeem"] : ["mint", "redeem"]) as ("mint" | "redeem" | "zap")[]).map(
            (t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-full px-4 py-2 capitalize transition-colors ${
                  tab === t ? "bg-ink text-canvas" : "text-muted hover:text-ink"
                }`}
              >
                {t === "zap" ? "Zap · USDG" : t}
              </button>
            ),
          )}
        </div>

        {tab === "zap" && (
          <div className="mb-4 flex gap-1 rounded-2xl border border-hair bg-canvas p-1 font-mono text-[12px]">
            {(
              [
                ["in", "Buy with USDG"],
                ["out", "Sell to USDG"],
              ] as const
            ).map(([d, label]) => (
              <button
                key={d}
                onClick={() => setZapDir(d)}
                className={`flex-1 rounded-xl px-3 py-1.5 transition-colors ${
                  zapDir === d ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* start-here stepper — live checkmarks driven by the user's actual on-chain state */}
        {tab === "zap" && zapDir === "in" && vault && vault.shares === 0n && (
          <div className="mb-5 overflow-hidden rounded-2xl border border-green/30 bg-green/[0.04]">
            <div className="border-b border-green/20 px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-green-deep">
              New here? Three steps
            </div>
            {(
              [
                {
                  n: 1,
                  done: !!usdg && usdg.bal > 0n,
                  title: "Get USDG on Robinhood Chain",
                  body: (
                    <>
                      Swap ETH → USDG on{" "}
                      <a
                        href="https://app.uniswap.org/swap"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-b border-green text-ink"
                      >
                        Uniswap
                      </a>{" "}
                      (network: Robinhood Chain).{" "}
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(USDG_ADDRESS);
                          setCopiedUsdg(true);
                          setTimeout(() => setCopiedUsdg(false), 1500);
                        }}
                        className="rounded-md border border-ink/20 px-1.5 py-0.5 font-mono text-[10.5px] transition-colors hover:border-ink/50"
                      >
                        {copiedUsdg ? "copied ✓" : "copy USDG address"}
                      </button>
                    </>
                  ),
                },
                {
                  n: 2,
                  done: !!usdg && zapMaxIn > 0n && usdg.allowance >= zapMaxIn,
                  title: "Pick an amount, approve once",
                  body: <>Fractions are fine — 0.1 token is a real position. Approving lets the zapper spend your USDG, capped at the shown max.</>,
                },
                {
                  n: 3,
                  done: false,
                  title: "Zap in — one transaction",
                  body: <>The zapper buys all five stocks and mints your index token atomically. Unspent USDG comes straight back.</>,
                },
              ] as const
            ).map((s, i, arr) => {
              const active = !s.done && arr.slice(0, i).every((p) => p.done);
              return (
                <div
                  key={s.n}
                  className={`flex gap-3 border-b border-green/10 px-4 py-3 last:border-0 ${
                    s.done ? "opacity-50" : active ? "" : "opacity-60"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full font-mono text-[10.5px] ${
                      s.done ? "bg-green text-white" : active ? "bg-ink text-canvas" : "border border-hair text-muted"
                    }`}
                  >
                    {s.done ? "✓" : s.n}
                  </span>
                  <span>
                    <span className="block font-display text-[13.5px] font-semibold">{s.title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-relaxed text-muted">{s.body}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <label className="mb-1 block font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          Index tokens to {tab === "zap" ? (zapDir === "in" ? "buy" : "sell") : tab}
        </label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="1.0"
          className="w-full rounded-2xl border border-hair bg-canvas px-4 py-3 font-mono text-[20px] tnum outline-none transition-colors focus:border-green"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-muted">
            {basketValue18 > 0n ? (
              <>1 index token ≈ {usd(basketValue18)} — fractions are fine</>
            ) : (
              <>each token is backed by the full 5-stock basket</>
            )}
          </span>
          <span className="flex gap-1.5">
            {maxShares > 0n
              ? (
                  [
                    ["25%", 25n],
                    ["50%", 50n],
                    ["75%", 75n],
                    ["Max", 100n],
                  ] as const
                ).map(([label, p]) => (
                  <button
                    key={label}
                    onClick={() => setAmount(formatUnits((maxShares * p) / 100n, 18))}
                    className="rounded-md border border-hair px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-ink/40 hover:text-ink"
                  >
                    {label}
                  </button>
                ))
              : (["0.1", "0.25", "0.5", "1"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setAmount(p)}
                    className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                      amount === p
                        ? "border-green text-green-deep"
                        : "border-hair text-muted hover:border-ink/40 hover:text-ink"
                    }`}
                  >
                    {p}
                  </button>
                ))}
          </span>
        </div>

        {vault && shares > 0n && tab === "zap" && (
          <div className="mt-5 overflow-hidden rounded-2xl border border-hair">
            <div className="border-b border-hair bg-canvas px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              One transaction — the zapper {zapDir === "in" ? "buys" : "sells"} the whole basket on Uniswap
            </div>
            <div className="flex items-center justify-between border-b border-hair/60 px-4 py-3">
              <span className="font-mono text-[13px] text-muted">
                {zapDir === "in" ? "Estimated cost" : "Estimated receive"}
              </span>
              <span className="font-mono text-[13.5px] tnum">{usdgFmt(zapEstUsdg)} USDG</span>
            </div>
            <div className="flex items-center justify-between border-b border-hair/60 px-4 py-3">
              <span className="font-mono text-[13px] text-muted">
                {zapDir === "in" ? "Max spend (rest refunded)" : "Minimum accepted"}
              </span>
              <span className="font-mono text-[13.5px] tnum">
                {usdgFmt(zapDir === "in" ? zapMaxIn : zapMinOut)} USDG
              </span>
            </div>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-mono text-[13px] text-muted">Your USDG</span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-[13.5px] tnum">{usdg ? usdgFmt(usdg.bal) : "—"}</span>
                {zapDir === "in" && usdg && usdg.bal < zapMaxIn && (
                  <span className="rounded-md bg-[#a23b2f]/10 px-2 py-0.5 font-mono text-[10.5px] text-[#a23b2f]">
                    insufficient
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {vault && shares > 0n && tab !== "zap" && (
          <div className="mt-5 overflow-hidden rounded-2xl border border-hair">
            <div className="border-b border-hair bg-canvas px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
              {tab === "mint" ? "You deposit (rounded up, in the vault's favor)" : "You receive (rounded down)"}
            </div>
            {(tab === "mint" ? mintRows : vault.assets).map((a) => {
              const row = a as AssetRow & { need?: bigint; enough?: boolean; approved?: boolean };
              const amt = tab === "mint" ? row.need! : redeemPayout(shares, a.unit);
              return (
                <div key={a.address} className="flex items-center justify-between border-b border-hair/60 px-4 py-3 last:border-0">
                  <span className="font-mono text-[13px]">{a.symbol}</span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-[13.5px] tnum">{fmt(amt, 6)}</span>
                    {tab === "mint" &&
                      (!row.enough ? (
                        <span className="rounded-md bg-[#a23b2f]/10 px-2 py-0.5 font-mono text-[10.5px] text-[#a23b2f]">
                          insufficient
                        </span>
                      ) : row.approved ? (
                        <span className="rounded-md bg-green/10 px-2 py-0.5 font-mono text-[10.5px] text-green-deep">
                          approved
                        </span>
                      ) : (
                        <button
                          onClick={() => approve(row as AssetRow & { need: bigint })}
                          disabled={busy !== null}
                          className="rounded-md border border-ink/20 px-2.5 py-1 font-mono text-[10.5px] transition-colors hover:border-ink/50 disabled:opacity-40"
                        >
                          {busy === `Approve ${a.symbol}` ? "approving…" : "approve"}
                        </button>
                      ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {tab === "mint" && vault && shares > 0n && feeShares > 0n && (
          <p className="mt-3 font-mono text-[12px] text-muted">
            mint fee {vault.mintFeeBps / 100}% → you receive {fmt(shares - feeShares)} index tokens
          </p>
        )}
        {tab === "redeem" && vault && (
          <p className="mt-3 font-mono text-[12px] text-muted">
            balance: {fmt(vault.shares)} — redemption is always on; no admin can pause it
          </p>
        )}

        <div className="mt-5">
          {tab === "mint" ? (
            <button
              onClick={doMint}
              disabled={busy !== null || shares === 0n || !allEnough || !allApproved || vault?.mintPaused}
              className={`${pill} w-full`}
            >
              {vault?.mintPaused
                ? "Minting is paused"
                : busy?.startsWith("Mint")
                  ? "Minting…"
                  : !allEnough
                    ? "Insufficient basket balance"
                    : !allApproved
                      ? "Approve all assets first"
                      : "Mint"}
            </button>
          ) : tab === "redeem" ? (
            <button
              onClick={doRedeem}
              disabled={busy !== null || shares === 0n || (vault ? shares > vault.shares : true)}
              className={`${pill} w-full`}
            >
              {busy?.startsWith("Redeem") ? "Redeeming…" : vault && shares > vault.shares ? "Exceeds balance" : "Redeem in-kind"}
            </button>
          ) : zapDir === "in" ? (
            usdg && usdg.allowance < zapMaxIn ? (
              <button
                onClick={approveUsdgZap}
                disabled={busy !== null || shares === 0n || vault?.mintPaused || usdg.bal < zapMaxIn}
                className={`${pill} w-full`}
              >
                {busy === "Approve USDG"
                  ? "Approving…"
                  : usdg.bal < zapMaxIn
                    ? "Insufficient USDG"
                    : `Approve ${usdgFmt(zapMaxIn)} USDG`}
              </button>
            ) : (
              <button
                onClick={doZapMint}
                disabled={busy !== null || shares === 0n || vault?.mintPaused || (usdg ? usdg.bal < zapMaxIn : true)}
                className={`${pill} w-full`}
              >
                {vault?.mintPaused
                  ? "Minting is paused"
                  : busy?.startsWith("Zap in")
                    ? "Zapping…"
                    : usdg && usdg.bal < zapMaxIn
                      ? "Insufficient USDG"
                      : "Zap in — one click"}
              </button>
            )
          ) : usdg && usdg.shareAllowance < shares ? (
            <button
              onClick={approveSharesZap}
              disabled={busy !== null || shares === 0n || (vault ? shares > vault.shares : true)}
              className={`${pill} w-full`}
            >
              {busy === "Approve index" ? "Approving…" : "Approve index tokens"}
            </button>
          ) : (
            <button
              onClick={doZapRedeem}
              disabled={busy !== null || shares === 0n || (vault ? shares > vault.shares : true)}
              className={`${pill} w-full`}
            >
              {busy?.startsWith("Zap out")
                ? "Zapping…"
                : vault && shares > vault.shares
                  ? "Exceeds balance"
                  : "Zap out to USDG"}
            </button>
          )}
        </div>

        {err && <ErrLine msg={err} />}

        {tab === "mint" && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            Minting draws the exact stock-token basket from your wallet — hold the five constituents
            on Robinhood Chain first{ZAPPER_ADDRESS ? ", or switch to the Zap tab to pay in USDG only" : " (e.g. via a DEX)"}.
            These are real assets; watch the amounts.
          </p>
        )}
        {tab === "zap" && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            The zapper is atomic periphery: it {zapDir === "in"
              ? "buys the exact basket on Uniswap and mints in the same transaction — any unspent USDG comes straight back"
              : "redeems your basket and sells it on Uniswap in the same transaction"}. It custodies
            nothing between transactions and holds no special powers over the vault.
          </p>
        )}
      </div>

      {/* tx log */}
      {txs.length > 0 && (
        <div className="mt-6 rounded-3xl border border-hair bg-white p-5">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">Recent transactions</p>
          {txs.map((t) => (
            <a
              key={t.hash}
              href={`${EXPLORER}/tx/${t.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between border-b border-hair/60 py-2.5 font-mono text-[12.5px] last:border-0"
            >
              <span>{t.label}</span>
              <span
                className={
                  t.status === "ok" ? "text-green-deep" : t.status === "fail" ? "text-[#a23b2f]" : "text-muted"
                }
              >
                {t.status === "pending" ? "pending…" : t.status === "ok" ? "confirmed ✓" : "failed ✕"}{" "}
                {t.hash.slice(0, 8)}… ↗
              </span>
            </a>
          ))}
        </div>
      )}
        </div>
      )}
    </div>
  );
}

/* ---------- the holder's position ---------- */

function PositionCard({ vault, onAdd, onRedeem }: { vault: VaultState; onAdd: () => void; onRedeem: () => void }) {
  const positionValue = vault.supply > 0n ? (vault.shares * vault.nav) / vault.supply : 0n;
  const sharePct = vault.supply > 0n ? Number((vault.shares * 1_000_000n) / vault.supply) / 10000 : 0;
  const total = vault.assets.reduce((s, a) => s + a.value, 0n);
  const weights = vault.assets.map((a, i) => ({
    symbol: a.symbol,
    pct: total > 0n ? Number((a.value * 10000n) / total) / 100 : 0,
    color: ALLOC[i % ALLOC.length],
  }));

  return (
    <div className="mb-6 overflow-hidden rounded-3xl border border-hair bg-white">
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <div>
          <p className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">Your position</p>
          <p className="mt-0.5 font-display text-[15px] font-semibold">Arca Frontier</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-green/10 px-3 py-1.5 font-mono text-[11px] text-green-deep">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-green opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green" />
          </span>
          actively managed
        </span>
      </div>

      <div className="px-6 pb-5">
        <div className="font-display text-[34px] font-semibold leading-none tracking-tight tnum">{usd(positionValue)}</div>
        <p className="mt-2 font-mono text-[12.5px] text-muted tnum">
          {fmt(vault.shares)} index tokens · {sharePct.toFixed(2)}% of the vault
        </p>
      </div>

      <div className="border-t border-hair px-6 py-5">
        <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">What you hold right now</p>
        <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-md">
          {weights.map((w) => (
            <div key={w.symbol} style={{ width: `${w.pct}%`, background: w.color }} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-[12px] text-muted tnum">
          {weights.map((w) => (
            <span key={w.symbol} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[3px]" style={{ background: w.color }} />
              {w.symbol} {w.pct.toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hair px-6 py-4">
        <span className="inline-flex items-center gap-2 text-[13.5px] text-muted">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.9M13 2.2v2.6h-2.6" />
          </svg>
          Last rebalance · {timeAgo(vault.lastRebalance)}
        </span>
        <a href="/agent" className="font-mono text-[12px] text-green-deep">
          managed by the agent · weekly →
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair bg-canvas px-6 py-4">
        <span className="inline-flex items-center gap-2 text-[12.5px] text-green-deep">
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 1.6 3.2 3.5v3.6c0 3 2 4.8 4.8 5.9 2.8-1.1 4.8-2.9 4.8-5.9V3.5L8 1.6Z" />
            <path d="M5.9 8 7.4 9.5 10.4 6.4" />
          </svg>
          Fully backed · manager can&apos;t withdraw
        </span>
        <div className="flex gap-2">
          <button
            onClick={onAdd}
            className="rounded-full bg-ink px-4 py-2 font-display text-[13px] font-medium text-canvas transition-transform hover:-translate-y-px"
          >
            + Add
          </button>
          <button
            onClick={onRedeem}
            className="rounded-full border border-hair bg-white px-4 py-2 font-display text-[13px] font-medium transition-colors hover:border-ink/30"
          >
            Redeem
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- little pieces ---------- */

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={`mt-1 font-mono text-[18px] font-medium tnum ${good ? "text-green-deep" : ""}`}>{value}</div>
    </div>
  );
}

function AppHeader({
  hasWallet,
  account,
  chainOk,
  onConnect,
  onDisconnect,
}: {
  hasWallet: boolean;
  account: Address | null;
  chainOk: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const link =
    "rounded-full border border-hair bg-white px-4 py-2 font-display text-[13.5px] font-medium text-ink transition-colors hover:border-ink/30";
  const dot = chainOk ? "bg-green" : "bg-[#c98a2b]";
  return (
    <div className="sticky top-0 z-40 border-b border-hair bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between px-4 py-3.5 sm:px-6">
        <a href="/" className="flex items-center gap-2 font-display text-[16px] font-semibold tracking-tight">
          <Logo className="h-5 w-auto" />
          Arca
          <span className="ml-1 hidden rounded-md bg-green/10 px-1.5 py-0.5 font-mono text-[10.5px] font-normal uppercase tracking-[0.1em] text-green-deep sm:inline-block">
            app · mainnet
          </span>
        </a>
        <div className="flex items-center gap-2">
          {account ? (
            <div className="relative">
              <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-3 py-2 font-mono text-[12.5px] text-ink transition-colors hover:border-ink/30"
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className={`absolute inline-flex h-full w-full rounded-full ${dot} opacity-60 motion-safe:animate-ping`} />
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
                </span>
                {account.slice(0, 6)}…{account.slice(-4)}
                <span className="text-[10px] text-muted">▾</span>
              </button>
              {open && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
                  <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-[220px] overflow-hidden rounded-2xl border border-hair bg-white shadow-[0_20px_60px_-24px_rgba(23,25,27,0.3)]">
                    <div className="border-b border-hair px-4 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                        Connected{chainOk ? "" : " · wrong network"}
                      </p>
                      <p className="mt-0.5 font-mono text-[12.5px] text-ink">
                        {account.slice(0, 8)}…{account.slice(-6)}
                      </p>
                    </div>
                    <a
                      href={`${EXPLORER}/address/${account}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink transition-colors hover:bg-ink/[0.03]"
                    >
                      View on explorer ↗
                    </a>
                    <button
                      onClick={() => {
                        onDisconnect();
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 border-t border-hair px-4 py-2.5 text-left text-[13px] text-[#a23b2f] transition-colors hover:bg-[#a23b2f]/[0.05]"
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : hasWallet ? (
            <button
              onClick={onConnect}
              className="rounded-full bg-ink px-4 py-2 font-display text-[13.5px] font-medium text-canvas transition-transform hover:-translate-y-px"
            >
              Connect wallet
            </button>
          ) : null}
          <a href="/docs" className={link}>
            Docs
          </a>
          <a href="/" className={`group inline-flex items-center gap-2 ${link}`}>
            <span aria-hidden className="text-green-deep transition-transform group-hover:-translate-x-0.5">
              ←
            </span>
            Back to site
          </a>
        </div>
      </div>
    </div>
  );
}

function Gate({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[560px] px-6 pb-24">
      <div className="rounded-3xl border border-hair bg-white p-8 text-center">
        <Logo className="mx-auto h-8 w-auto" />
        <h1 className="mt-4 font-display text-[24px] font-semibold tracking-tight">{title}</h1>
        <div className="mt-3 text-[14.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return (
    <p className="mt-3 break-words rounded-xl bg-[#a23b2f]/[0.06] px-3 py-2 font-mono text-[12px] text-[#a23b2f]">
      {msg}
    </p>
  );
}
