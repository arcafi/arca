import { H1, H2, P, Callout, Table, Code, Mono } from "../ui";

const EXPLORER = "https://robinhoodchain.blockscout.com";
const TESTNET_EXPLORER = "https://explorer.testnet.chain.robinhood.com";
const VAULT = "0x04f4F5b8572d0b925557BE9F42C92B9Edce9F628";
const ROUTER = "0x107d393006494fce1C325e67507d33011239997f";

const A = ({ path, base = EXPLORER, children }: { path: string; base?: string; children: React.ReactNode }) => (
  <a
    href={`${base}/${path}`}
    target="_blank"
    rel="noopener noreferrer"
    className="border-b border-green font-mono text-[12.5px] text-ink"
  >
    {children}
  </a>
);
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

export default function Contracts() {
  return (
    <article>
      <H1 kicker="Docs · live records">Contracts &amp; addresses</H1>

      <P>
        Every record below is live on Robinhood Chain <b>mainnet</b> (chain id <Mono>4663</Mono>,
        explorer <Mono>robinhoodchain.blockscout.com</Mono>). Don&apos;t trust these docs — verify
        each row against the chain; every one links straight to it.
      </P>

      <H2 id="vault">The live vault — Arca Frontier</H2>
      <Table
        head={["Contract", "Address"]}
        rows={[
          [
            <span key="v"><b>ArcaVault</b> — &quot;Arca Frontier&quot; (ARCI)</span>,
            <A key="va" path={`address/${VAULT}`}>{short(VAULT)} ↗</A>,
          ],
          [
            <span key="r"><b>ArcaUniV4Router</b> — Uniswap v4 swap adapter</span>,
            <A key="ra" path={`address/${ROUTER}`}>{short(ROUTER)} ↗</A>,
          ],
          [
            <span key="z"><b>ArcaZapper</b> — one-click USDG in/out (periphery, no vault powers)</span>,
            <A key="za" path="address/0x1942E2548bf262343be39fdFafa02508af567938">{short("0x1942E2548bf262343be39fdFafa02508af567938")} ↗</A>,
          ],
          [
            <span key="zr"><b>ArcaZapRouter</b> — exact-out/in v4 adapter for the zapper</span>,
            <A key="zra" path="address/0xc7445Ade2A05dd38C27bE5F3c5628c956bb52cef">{short("0xc7445Ade2A05dd38C27bE5F3c5628c956bb52cef")} ↗</A>,
          ],
        ]}
      />

      <H2 id="basket">The basket — real Robinhood stock tokens</H2>
      <P>
        Five names, picked by on-chain liquidity checks (two-way Uniswap v4 depth against USDG
        within ~1% of oracle) so the agent can rebalance every leg permissionlessly.
      </P>
      <Table
        head={["Stock", "Token", "Chainlink feed"]}
        rows={[
          ["NVIDIA (NVDA)", <A key="1" path="address/0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC">{short("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC")} ↗</A>, <A key="1f" path="address/0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15">{short("0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15")} ↗</A>],
          ["Microsoft (MSFT)", <A key="2" path="address/0xe93237C50D904957Cf27E7B1133b510C669c2e74">{short("0xe93237C50D904957Cf27E7B1133b510C669c2e74")} ↗</A>, <A key="2f" path="address/0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E">{short("0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E")} ↗</A>],
          ["Tesla (TSLA)", <A key="3" path="address/0x322F0929c4625eD5bAd873c95208D54E1c003b2d">{short("0x322F0929c4625eD5bAd873c95208D54E1c003b2d")} ↗</A>, <A key="3f" path="address/0x4A1166a659A55625345e9515b32adECea5547C38">{short("0x4A1166a659A55625345e9515b32adECea5547C38")} ↗</A>],
          ["Alphabet (GOOGL)", <A key="4" path="address/0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3">{short("0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3")} ↗</A>, <A key="4f" path="address/0xF6f373a037c30F0e5010d854385cA89185AE638b">{short("0xF6f373a037c30F0e5010d854385cA89185AE638b")} ↗</A>],
          ["SpaceX (SPCX)", <A key="5" path="address/0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa">{short("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa")} ↗</A>, <A key="5f" path="address/0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb">{short("0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb")} ↗</A>],
        ]}
      />

      <H2 id="proof">The proven loop — rehearsal receipts (testnet)</H2>
      <P>
        Ahead of mainnet, the same contract suite ran the full loop on RHC testnet (chain
        46630) with real testnet stock tokens. The receipts stay public:
      </P>
      <Table
        head={["Operation", "What happened", "Transaction"]}
        rows={[
          [
            <b key="m">Mint</b>,
            "deposited the basket → minted 1 index token, fully backed",
            <A key="mt" base={TESTNET_EXPLORER} path="tx/0x4f8a9a416df7e71d9ac0b8b518a063197a740c1ac5c9e8aaf6b46865e32f90df">{short("0x4f8a9a416df7e71d9ac0b8b518a063197a740c1ac5c9e8aaf6b46865e32f90df")} ↗</A>,
          ],
          [
            <b key="rb">Rebalance</b>,
            "agent rotated weights through its policy gate; fully backed before and after",
            <A key="rbt" base={TESTNET_EXPLORER} path="tx/0xa02e4de859ce1ac7507d5a31ef18d4ebf1cae7534e3e37398c30d362fde4debc">{short("0xa02e4de859ce1ac7507d5a31ef18d4ebf1cae7534e3e37398c30d362fde4debc")} ↗</A>,
          ],
          [
            <b key="rd">Redeem</b>,
            "burned 0.5 index token → all stocks returned in-kind, one tx",
            <A key="rdt" base={TESTNET_EXPLORER} path="tx/0xb5efff6a5e72fdaea677d07c057e94d0ef2debeb4c30403191b7a79fdb0ba98f">{short("0xb5efff6a5e72fdaea677d07c057e94d0ef2debeb4c30403191b7a79fdb0ba98f")} ↗</A>,
          ],
        ]}
      />

      <H2 id="verify">Verify it yourself</H2>
      <P>With Foundry&apos;s <Mono>cast</Mono> against any RHC mainnet RPC:</P>
      <Code>{`# is one token still fully backed by the basket?
cast call ${VAULT} "isFullyBacked()(bool)" --rpc-url https://rpc.mainnet.chain.robinhood.com

# portfolio value (USD, 18 decimals) and supply
cast call ${VAULT} "nav()(uint256)"         --rpc-url https://rpc.mainnet.chain.robinhood.com
cast call ${VAULT} "totalSupply()(uint256)" --rpc-url https://rpc.mainnet.chain.robinhood.com

# what the vault actually holds (e.g. NVDA)
cast call 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC \\
  "balanceOf(address)(uint256)" ${VAULT} \\
  --rpc-url https://rpc.mainnet.chain.robinhood.com`}</Code>

      <Callout title="Source">
        Contract source is verified on the explorer, and the full repo — contracts, tests, deploy
        scripts — is public on{" "}
        <a href="https://github.com/Arca/Arca" target="_blank" rel="noopener noreferrer" className="border-b border-green text-ink">
          GitHub
        </a>.
      </Callout>
    </article>
  );
}
