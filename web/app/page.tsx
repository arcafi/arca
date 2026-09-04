import { Landing } from "./components/Landing";
import { getVaultData, getLatestRebalance, getLedger } from "./lib/vault";

// live on-chain read every request (cheap, low traffic); keeps the numbers real
export const dynamic = "force-dynamic";

export default async function Home() {
  const [vault, rebalance, ledger] = await Promise.all([getVaultData(), getLatestRebalance(), getLedger()]);
  return <Landing vault={vault} rebalance={rebalance} ledger={ledger} />;
}
