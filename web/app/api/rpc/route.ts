import { NextRequest, NextResponse } from "next/server";

// Server-side JSON-RPC proxy for reads: keeps the Alchemy key out of the browser bundle and
// avoids CORS / flaky wallet RPCs. Writes still go through the user's wallet.
// Tries each upstream in order; one transient 429/5xx from Alchemy shouldn't surface to the UI.
const UPSTREAMS = [
  process.env.RHC_MAINNET_RPC,
  "https://rpc.mainnet.chain.robinhood.com",
].filter(Boolean) as string[];

export async function POST(req: NextRequest) {
  const body = await req.text();
  for (let round = 0; round < 2; round++) {
    for (const rpc of UPSTREAMS) {
      try {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
        });
        if (res.ok) {
          return new NextResponse(await res.text(), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
      } catch {
        // fall through to the next upstream / round
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return NextResponse.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "upstream RPC unreachable" } },
    { status: 502 },
  );
}
