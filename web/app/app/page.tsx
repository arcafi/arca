import type { Metadata } from "next";
import { AppClient } from "./AppClient";

export const metadata: Metadata = {
  title: "Arca App — mint & redeem on Robinhood Chain",
  description: "Mint and redeem Arca's live index on Robinhood Chain mainnet.",
};

// The app is wallet-stateful end to end (header chip included), so it lives in one client tree.
export default function AppPage() {
  return <AppClient />;
}
