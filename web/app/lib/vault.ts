import { createPublicClient, decodeEventLog, http, formatUnits } from "viem";

// RHC mainnet (4663). Override with RHC_MAINNET_RPC (e.g. Alchemy) in prod.
const RPC = process.env.RHC_MAINNET_RPC ?? "https://rpc.mainnet.chain.robinhood.com";
export const VAULT_ADDRESS = "0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628" as const;

const rhcChain = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const client = createPublicClient({ chain: rhcChain, transport: http(RPC) });

const vaultAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "nav", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isFullyBacked", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "assets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "rebalancer", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "lastRebalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "rebalanceCooldown", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  { type: "function", name: "maxTurnoverBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "maxSlippageBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
] as const;

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type Holding = { symbol: string; balance: number };
export type VaultData = {
  name: string;
  symbol: string;
  navUsd: number;
  navPerShare: number;
  supply: number;
  fullyBacked: boolean;
  holdings: Holding[];
} | null;

export async function getVaultData(): Promise<VaultData> {
  try {
    const read = <T,>(functionName: (typeof vaultAbi)[number]["name"]) =>
      client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName }) as Promise<T>;

    const [name, symbol, nav, supply, backed, assets] = await Promise.all([
      read<string>("name"),
      read<string>("symbol"),
      read<bigint>("nav"),
      read<bigint>("totalSupply"),
      read<boolean>("isFullyBacked"),
      read<readonly `0x${string}`[]>("assets"),
    ]);

    const holdings = await Promise.all(
      assets.map(async (a): Promise<Holding> => {
        const [sym, bal] = await Promise.all([
          client.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
          client.readContract({
            address: a,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [VAULT_ADDRESS],
          }) as Promise<bigint>,
        ]);
        return { symbol: sym, balance: Number(formatUnits(bal, 18)) };
      }),
    );

    const navUsd = Number(formatUnits(nav, 18));
    const supplyN = Number(formatUnits(supply, 18));
    return {
      name,
      symbol,
      navUsd,
      supply: supplyN,
      navPerShare: supplyN > 0 ? navUsd / supplyN : 0,
      fullyBacked: backed,
      holdings,
    };
  } catch {
    return null; // graceful: page renders without the live panel if the RPC is unreachable
  }
}

/* ---------- latest rebalance, read from the on-chain event ---------- */

const rebalancedEvent = {
  type: "event",
  name: "Rebalanced",
  inputs: [
    { name: "by", type: "address", indexed: true },
    { name: "rationale", type: "bytes32", indexed: false },
    { name: "navBefore", type: "uint256", indexed: false },
    { name: "navAfter", type: "uint256", indexed: false },
  ],
} as const;

// keccak256("Rebalanced(address,bytes32,uint256,uint256)") — topic0 for the receipt-scan fallback
const REBALANCED_TOPIC = "0xcf986d19c22854be6987b1926a0867c513f4b216f16c38b5fc864c783c7030b9";

// the vault deployed at mainnet block 16,109,827; scanning from just before keeps the
// getLogs range bounded while still catching every event, past and future.
const REBALANCE_SCAN_FROM = 54_470_457n;

// The public RHC RPC allows wide-range eth_getLogs; the Alchemy endpoint we use for
// contract reads caps it at a 10-block range on the free tier. So we scan the event on
// the public RPC, and fall back to reading a known rebalance tx's receipt on the main
// RPC (getTransactionReceipt has no range limit). Either path reads values live off-chain.
const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const publicClient = createPublicClient({ chain: rhcChain, transport: http(PUBLIC_RPC, { timeout: 5_000 }) });

// pointer to the newest known rebalance, used only by the fallback path; the agent bumps
// this (env override) after each run. Empty until the first mainnet rebalance lands.
const KNOWN_REBALANCE_TX = (process.env.LATEST_REBALANCE_TX ?? "") as `0x${string}`;

export type LatestRebalance = {
  by: `0x${string}`;
  rationale: `0x${string}`; // bytes32 keccak commitment of the agent's note — tamper-proof, not human text
  navBefore: number;
  navAfter: number;
  txHash: `0x${string}`;
  timestamp: number; // unix seconds
} | null;

async function toRebalance(
  rpc: typeof client,
  args: { by?: `0x${string}`; rationale?: `0x${string}`; navBefore?: bigint; navAfter?: bigint },
  txHash: `0x${string}`,
  blockNumber: bigint,
): Promise<LatestRebalance> {
  const { by, rationale, navBefore, navAfter } = args;
  if (by === undefined || rationale === undefined || navBefore === undefined || navAfter === undefined) return null;
  const block = await rpc.getBlock({ blockNumber });
  return {
    by,
    rationale,
    navBefore: Number(formatUnits(navBefore, 18)),
    navAfter: Number(formatUnits(navAfter, 18)),
    txHash,
    timestamp: Number(block.timestamp),
  };
}

export async function getLatestRebalance(): Promise<LatestRebalance> {
  // 1) preferred: scan the event on the public RPC (truly dynamic, full range)
  try {
    const logs = await publicClient.getLogs({
      address: VAULT_ADDRESS,
      event: rebalancedEvent,
      fromBlock: REBALANCE_SCAN_FROM,
      toBlock: "latest",
    });
    if (logs.length > 0) {
      const last = logs[logs.length - 1]; // ascending — the last one is newest
      const r = await toRebalance(publicClient, last.args, last.transactionHash, last.blockNumber);
      if (r) return r;
    }
  } catch {
    // fall through to the receipt path
  }

  // 2) fallback: decode the known rebalance tx's receipt on the main RPC (no range limit)
  if (!KNOWN_REBALANCE_TX) return null; // no mainnet rebalance pinned yet
  try {
    const receipt = await client.getTransactionReceipt({ hash: KNOWN_REBALANCE_TX });
    const log = receipt.logs.find(
      (l) => l.address.toLowerCase() === VAULT_ADDRESS.toLowerCase() && l.topics[0] === REBALANCED_TOPIC,
    );
    if (!log) return null;
    const decoded = decodeEventLog({ abi: [rebalancedEvent], data: log.data, topics: log.topics });
    return await toRebalance(client, decoded.args, KNOWN_REBALANCE_TX, receipt.blockNumber);
  } catch {
    return null; // graceful: the card falls back to a static explorer link
  }
}

/* ---------- the ledger: real Mint / Redeem / Rebalanced activity ---------- */

const mintEvent = {
  type: "event",
  name: "Mint",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "shares", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
} as const;

const redeemEvent = {
  type: "event",
  name: "Redeem",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "shares", type: "uint256", indexed: false },
  ],
} as const;

export type LedgerRow = {
  type: "Mint" | "Redeem" | "Rebalance";
  title: string;
  detail: string;
  txHash: `0x${string}`;
  timestamp: number;
};

const tokenPhrase = (v: bigint) => {
  const s = Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `${s} index token${s === "1" ? "" : "s"}`;
};

export async function getLedger(limit = 6): Promise<LedgerRow[]> {
  try {
    const [mints, redeems, rebals] = await Promise.all([
      publicClient.getLogs({ address: VAULT_ADDRESS, event: mintEvent, fromBlock: REBALANCE_SCAN_FROM, toBlock: "latest" }),
      publicClient.getLogs({ address: VAULT_ADDRESS, event: redeemEvent, fromBlock: REBALANCE_SCAN_FROM, toBlock: "latest" }),
      publicClient.getLogs({ address: VAULT_ADDRESS, event: rebalancedEvent, fromBlock: REBALANCE_SCAN_FROM, toBlock: "latest" }),
    ]);

    type Raw = { kind: "Mint" | "Redeem" | "Rebalance"; block: bigint; logIndex: number; txHash: `0x${string}`; row: Omit<LedgerRow, "timestamp"> };
    const raw: Raw[] = [];
    for (const l of mints) {
      raw.push({
        kind: "Mint",
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        txHash: l.transactionHash,
        row: { type: "Mint", title: "Holder minted", detail: `Deposited the basket → minted ${tokenPhrase(l.args.shares ?? 0n)}, fully backed`, txHash: l.transactionHash },
      });
    }
    for (const l of redeems) {
      raw.push({
        kind: "Redeem",
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        txHash: l.transactionHash,
        row: { type: "Redeem", title: "Holder redeemed in-kind", detail: `Burned ${tokenPhrase(l.args.shares ?? 0n)} → took the underlying stocks back, one tx`, txHash: l.transactionHash },
      });
    }
    for (const l of rebals) {
      const nb = Number(formatUnits(l.args.navBefore ?? 0n, 18));
      const na = Number(formatUnits(l.args.navAfter ?? 0n, 18));
      const held = Math.abs(na - nb) / Math.max(nb, 1e-9) < 1e-4;
      raw.push({
        kind: "Rebalance",
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        txHash: l.transactionHash,
        row: { type: "Rebalance", title: "Agent rotated the basket", detail: `Rotated weights on momentum · NAV $${nb.toFixed(2)} → $${na.toFixed(2)}${held ? " · value-neutral" : ""}`, txHash: l.transactionHash },
      });
    }

    raw.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : Number(b.block - a.block)));
    const top = raw.slice(0, limit);
    const blocks = await Promise.all(top.map((r) => publicClient.getBlock({ blockNumber: r.block })));
    return top.map((r, i) => ({ ...r.row, timestamp: Number(blocks[i].timestamp) }));
  } catch {
    return [];
  }
}

/* ---------- the agent console: identity, live status, track record, guardrails ---------- */

export type RebalanceRow = {
  txHash: `0x${string}`;
  timestamp: number;
  navBefore: number;
  navAfter: number;
  rationale: `0x${string}`;
};

export type AgentData = {
  rebalancer: `0x${string}`;
  lastRebalance: number; // unix seconds
  cooldownSecs: number;
  turnoverCapBps: number;
  slippageCapBps: number;
  navUsd: number;
  navPerToken: number;
  assetCount: number;
  fullyBacked: boolean;
  rebalances: RebalanceRow[]; // newest first
} | null;

export async function getAgentData(): Promise<AgentData> {
  try {
    const read = <T,>(functionName: (typeof vaultAbi)[number]["name"]) =>
      client.readContract({ address: VAULT_ADDRESS, abi: vaultAbi, functionName }) as Promise<T>;
    const [rebalancer, last, cooldown, turnover, slippage, nav, supply, backed, assets] = await Promise.all([
      read<`0x${string}`>("rebalancer"),
      read<bigint>("lastRebalance"),
      read<bigint>("rebalanceCooldown"),
      read<number>("maxTurnoverBps"),
      read<number>("maxSlippageBps"),
      read<bigint>("nav"),
      read<bigint>("totalSupply"),
      read<boolean>("isFullyBacked"),
      read<readonly `0x${string}`[]>("assets"),
    ]);

    // full track record — via the public RPC, since Alchemy's free tier caps getLogs to 10 blocks
    let rebalances: RebalanceRow[] = [];
    try {
      const logs = await publicClient.getLogs({
        address: VAULT_ADDRESS,
        event: rebalancedEvent,
        fromBlock: REBALANCE_SCAN_FROM,
        toBlock: "latest",
      });
      rebalances = await Promise.all(
        logs.map(async (l) => {
          const block = await publicClient.getBlock({ blockNumber: l.blockNumber });
          return {
            txHash: l.transactionHash,
            timestamp: Number(block.timestamp),
            navBefore: Number(formatUnits(l.args.navBefore ?? 0n, 18)),
            navAfter: Number(formatUnits(l.args.navAfter ?? 0n, 18)),
            rationale: (l.args.rationale ?? "0x") as `0x${string}`,
          };
        }),
      );
      rebalances.reverse(); // newest first
    } catch {
      // leave the track record empty; live status + guardrails still render
    }

    const navUsd = Number(formatUnits(nav, 18));
    const supplyN = Number(formatUnits(supply, 18));
    return {
      rebalancer,
      lastRebalance: Number(last),
      cooldownSecs: Number(cooldown),
      turnoverCapBps: Number(turnover),
      slippageCapBps: Number(slippage),
      navUsd,
      navPerToken: supplyN > 0 ? navUsd / supplyN : 0,
      assetCount: assets.length,
      fullyBacked: backed,
      rebalances,
    };
  } catch {
    return null;
  }
}

/* ---------- the activity page: who transacted, live from events ---------- */

export const ZAPPER = "0x351C442B70706D1208516BBda63ae9955Fda665e" as const;

const transferEvent = {
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
} as const;

const zapMintEvent = {
  type: "event",
  name: "ZapMint",
  inputs: [
    { name: "caller", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "shares", type: "uint256", indexed: false },
    { name: "usdgSpent", type: "uint256", indexed: false },
  ],
} as const;

const zapRedeemEvent = {
  type: "event",
  name: "ZapRedeem",
  inputs: [
    { name: "caller", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "shares", type: "uint256", indexed: false },
    { name: "usdgOut", type: "uint256", indexed: false },
  ],
} as const;

export type ActivityRow = {
  kind: "Zap in" | "Mint" | "Zap out" | "Redeem" | "Rebalance";
  wallet: `0x${string}`; // who acted (zap caller / mint sender / redeemer / rebalancer)
  tokens: number; // index tokens moved (0 for rebalance)
  usdg?: number; // USDG paid/received when the zapper was used
  txHash: `0x${string}`;
  timestamp: number;
};

export type VaultStats = {
  holders: number;
  txCount: number;
  supply: number;
  navUsd: number;
};

/** Every mint/redeem/zap/rebalance, newest first, with the acting wallet — the public ledger. */
export async function getActivity(limit = 60): Promise<ActivityRow[]> {
  try {
    const range = { fromBlock: REBALANCE_SCAN_FROM, toBlock: "latest" } as const;
    const [mints, redeems, rebals, zapIns, zapOuts] = await Promise.all([
      publicClient.getLogs({ address: VAULT_ADDRESS, event: mintEvent, ...range }),
      publicClient.getLogs({ address: VAULT_ADDRESS, event: redeemEvent, ...range }),
      publicClient.getLogs({ address: VAULT_ADDRESS, event: rebalancedEvent, ...range }),
      publicClient.getLogs({ address: ZAPPER, event: zapMintEvent, ...range }),
      publicClient.getLogs({ address: ZAPPER, event: zapRedeemEvent, ...range }),
    ]);

    // a zap tx also emits the vault's Mint/Redeem — keep the richer zap row for those hashes
    const zapHashes = new Set([...zapIns, ...zapOuts].map((l) => l.transactionHash));

    type Raw = { row: Omit<ActivityRow, "timestamp">; block: bigint; logIndex: number };
    const raw: Raw[] = [];
    for (const l of zapIns) {
      raw.push({
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        row: {
          kind: "Zap in",
          wallet: (l.args.caller ?? "0x") as `0x${string}`,
          tokens: Number(formatUnits(l.args.shares ?? 0n, 18)),
          usdg: Number(formatUnits(l.args.usdgSpent ?? 0n, 6)),
          txHash: l.transactionHash,
        },
      });
    }
    for (const l of zapOuts) {
      raw.push({
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        row: {
          kind: "Zap out",
          wallet: (l.args.caller ?? "0x") as `0x${string}`,
          tokens: Number(formatUnits(l.args.shares ?? 0n, 18)),
          usdg: Number(formatUnits(l.args.usdgOut ?? 0n, 6)),
          txHash: l.transactionHash,
        },
      });
    }
    for (const l of mints) {
      if (zapHashes.has(l.transactionHash)) continue;
      raw.push({
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        row: {
          kind: "Mint",
          wallet: (l.args.from ?? "0x") as `0x${string}`,
          tokens: Number(formatUnits(l.args.shares ?? 0n, 18)),
          txHash: l.transactionHash,
        },
      });
    }
    for (const l of redeems) {
      if (zapHashes.has(l.transactionHash)) continue;
      raw.push({
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        row: {
          kind: "Redeem",
          wallet: (l.args.from ?? "0x") as `0x${string}`,
          tokens: Number(formatUnits(l.args.shares ?? 0n, 18)),
          txHash: l.transactionHash,
        },
      });
    }
    for (const l of rebals) {
      raw.push({
        block: l.blockNumber,
        logIndex: l.logIndex ?? 0,
        row: {
          kind: "Rebalance",
          wallet: (l.args.by ?? "0x") as `0x${string}`,
          tokens: 0,
          txHash: l.transactionHash,
        },
      });
    }

    raw.sort((a, b) => (a.block === b.block ? b.logIndex - a.logIndex : Number(b.block - a.block)));
    const top = raw.slice(0, limit);
    const uniqueBlocks = [...new Set(top.map((r) => r.block))];
    const stamps = new Map(
      await Promise.all(
        uniqueBlocks.map(async (b) => {
          const blk = await publicClient.getBlock({ blockNumber: b });
          return [b, Number(blk.timestamp)] as const;
        }),
      ),
    );
    return top.map((r) => ({ ...r.row, timestamp: stamps.get(r.block) ?? 0 }));
  } catch {
    return [];
  }
}

export type HolderRow = { address: `0x${string}`; balance: number; pct: number };

/** Current holders, derived from the index token's own Transfer events (mint/burn included). */
export async function getHolders(top = 25): Promise<{ holders: HolderRow[]; count: number }> {
  try {
    const logs = await publicClient.getLogs({
      address: VAULT_ADDRESS,
      event: transferEvent,
      fromBlock: REBALANCE_SCAN_FROM,
      toBlock: "latest",
    });
    const zero = "0x0000000000000000000000000000000000000000";
    const bal = new Map<string, bigint>();
    for (const l of logs) {
      const from = (l.args.from ?? zero).toLowerCase();
      const to = (l.args.to ?? zero).toLowerCase();
      const v = l.args.value ?? 0n;
      if (from !== zero) bal.set(from, (bal.get(from) ?? 0n) - v);
      if (to !== zero) bal.set(to, (bal.get(to) ?? 0n) + v);
    }
    const positive = [...bal.entries()].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1));
    const total = positive.reduce((s, [, v]) => s + v, 0n);
    const holders = positive.slice(0, top).map(([a, v]) => ({
      address: a as `0x${string}`,
      balance: Number(formatUnits(v, 18)),
      pct: total > 0n ? Number((v * 10_000n) / total) / 100 : 0,
    }));
    return { holders, count: positive.length };
  } catch {
    return { holders: [], count: 0 };
  }
}
