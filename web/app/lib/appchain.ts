/* Client-side chain config + ABIs for the /app page (viem, wallet-provider transport). */

export const CHAIN_ID = 4663;
export const CHAIN_ID_HEX = "0x1237"; // 4663
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const VAULT_ADDRESS = "0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628" as const;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

// One-click zap (USDG <-> index), deployed 22 Jul 2026. Zap tab hides itself if ever emptied.
// Arca zapper — redeploying; empty string hides the Zap tab until the new one is live
export const ZAPPER_ADDRESS = "" as `0x${string}` | "";
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;

export const rhcChain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
} as const;

/** Params for wallet_addEthereumChain when the wallet doesn't know the chain yet. */
export const addChainParams: {
  chainId: `0x${string}`;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
} = {
  chainId: CHAIN_ID_HEX as `0x${string}`,
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [RPC_URL],
  blockExplorerUrls: [EXPLORER],
};

export const vaultAbi = [
  { type: "function", name: "assets", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
  { type: "function", name: "units", stateMutability: "view", inputs: [], outputs: [{ type: "uint256[]" }] },
  { type: "function", name: "nav", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isFullyBacked", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "mintPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "mintFeeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "supplyCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lastRebalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
  {
    type: "function",
    name: "oracleOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const zapperAbi = [
  {
    type: "function",
    name: "zapMint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "maxUsdgIn", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "spent", type: "uint256" }],
  },
  {
    type: "function",
    name: "zapRedeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "minUsdgOut", type: "uint256" },
      { name: "to", type: "address" },
    ],
    outputs: [{ name: "usdgOut", type: "uint256" }],
  },
] as const;

/** Chainlink feed — enough to price each asset the way the vault's own _value() does. */
export const aggregatorAbi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
] as const;

/** ceil(shares * unit / 1e18) — mirrors the vault's deposit rounding exactly. */
export const requiredDeposit = (shares: bigint, unit: bigint) => (shares * unit + 10n ** 18n - 1n) / 10n ** 18n;
/** floor(shares * unit / 1e18) — what redeem pays out. */
export const redeemPayout = (shares: bigint, unit: bigint) => (shares * unit) / 10n ** 18n;
