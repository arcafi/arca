// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {IPoolManager, PoolKey, Currency} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice Deploys the Arca Frontier basket (6 AI/semi stocks) + its Uniswap v4 router adapter on
///         Robinhood Chain, then wires every asset<->asset swap route through a common quote currency.
///
/// All RHC-specific addresses come from env (see script/DEPLOY.md) so nothing is hardcoded to guesses.
/// Missing/zero values revert loudly, listing what still needs filling. Run:
///   forge script script/DeployArcaFrontier.s.sol:DeployArcaFrontier \
///     --rpc-url $RHC_RPC --private-key $PK --broadcast
///
/// Note: mint/redeem go live the moment the vault is deployed. Routes only matter once the agent
/// starts rebalancing, so a partial deploy (no routes) is still a usable product.
contract DeployArcaFrontier is Script {
    function run() external {
        // Basket symbols, comma-separated. Default = the verified five (SPCX added once its token lists).
        string[] memory syms = vm.envOr("ARCA_SYMBOLS", ",", _defaultSyms());

        // --- shared / infra addresses ---
        address poolManager = vm.envAddress("ARCA_POOL_MANAGER"); // RHC Uniswap v4 PoolManager
        address quote = vm.envAddress("ARCA_QUOTE"); // USDG — the quote each stock has v4 liquidity against
        address owner = vm.envAddress("ARCA_OWNER"); // router owner (sets routes)

        // --- per-asset (token + Chainlink aggregator + initial unit per 1e18 shares) ---
        uint256 n = syms.length;
        address[] memory tokens = new address[](n);
        address[] memory oracles = new address[](n);
        uint256[] memory units = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            tokens[i] = vm.envAddress(_v(syms[i], "TOKEN"));
            oracles[i] = vm.envAddress(_v(syms[i], "ORACLE"));
            units[i] = vm.envUint(_v(syms[i], "UNIT"));
        }

        // --- vault guardrails / roles ---
        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: vm.envUint("ARCA_SUPPLY_CEILING"),
            supplyCap: vm.envUint("ARCA_SUPPLY_CAP"),
            mintFeeBps: uint16(vm.envUint("ARCA_MINT_FEE_BPS")),
            maxSlippageBps: uint16(vm.envUint("ARCA_MAX_SLIPPAGE_BPS")),
            maxTurnoverBps: uint16(vm.envUint("ARCA_MAX_TURNOVER_BPS")),
            rebalanceCooldown: uint64(vm.envUint("ARCA_REBALANCE_COOLDOWN")),
            maxOracleAge: uint64(vm.envUint("ARCA_MAX_ORACLE_AGE")),
            sequencerUptimeFeed: vm.envOr("ARCA_SEQUENCER_FEED", address(0)),
            guardian: vm.envAddress("ARCA_GUARDIAN"),
            rebalancer: vm.envAddress("ARCA_REBALANCER"),
            feeRecipient: vm.envAddress("ARCA_FEE_RECIPIENT"),
            router: address(0) // set after router is deployed
        });

        // per-stock v4 pool params for its <stock>/quote pool — each stock's USDG pool can use a
        // different fee tier (e.g. SPCX is 1% while NVDA/MSFT/TSLA/GOOGL are 0.3%). hooks shared.
        address poolHooks = vm.envOr("ARCA_POOL_HOOKS", address(0));
        uint24[] memory poolFees = new uint24[](n);
        int24[] memory poolSpacings = new int24[](n);
        for (uint256 i; i < n; ++i) {
            poolFees[i] = uint24(vm.envOr(_v(syms[i], "POOLFEE"), uint256(3000)));
            poolSpacings[i] = int24(int256(vm.envOr(_v(syms[i], "POOLSPACING"), uint256(60))));
        }

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();

        // Router starts owned by the broadcaster so route wiring below succeeds, then ownership
        // moves to ARCA_OWNER — unless ARCA_OWNER is the zero address, in which case the deployer
        // stays owner (owner == deployer). Deploying it directly with `owner` would make setRoute
        // revert whenever the deployer key differs from the owner address.
        ArcaUniV4Router router = new ArcaUniV4Router(IPoolManager(poolManager), broadcaster);
        cfg.router = address(router);

        ArcaVault vault = new ArcaVault("Arca Frontier", "ARCI", tokens, units, oracles, cfg);

        // Routes are only needed once the agent rebalances. Wire them when pool params are confirmed;
        // mint/redeem are live without them. Set ARCA_WIRE_ROUTES=true to wire at deploy time.
        if (vm.envOr("ARCA_WIRE_ROUTES", false)) {
            _wireRoutesViaQuote(router, tokens, quote, poolFees, poolSpacings, poolHooks);
        }

        if (owner != address(0) && owner != broadcaster) router.transferOwnership(owner);

        vm.stopBroadcast();

        console2.log("ArcaUniV4Router:", address(router));
        console2.log("ArcaVault (Frontier):", address(vault));
    }

    /// @dev register a<->b routes for every ordered pair, hopping through the quote currency.
    function _wireRoutesViaQuote(
        ArcaUniV4Router router,
        address[] memory tokens,
        address quote,
        uint24[] memory fees,
        int24[] memory spacings,
        address hooks
    ) internal {
        for (uint256 i; i < tokens.length; ++i) {
            for (uint256 j; j < tokens.length; ++j) {
                if (i == j) continue;
                // hop through the quote hub: leg i uses stock-i's pool, leg j uses stock-j's pool.
                ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](2);
                hops[0] = _hop(tokens[i], quote, fees[i], spacings[i], hooks);
                hops[1] = _hop(quote, tokens[j], fees[j], spacings[j], hooks);
                router.setRoute(tokens[i], tokens[j], hops);
            }
        }
    }

    function _hop(address from, address to, uint24 fee, int24 spacing, address hooks)
        internal
        pure
        returns (ArcaUniV4Router.Hop memory)
    {
        (address c0, address c1) = from < to ? (from, to) : (to, from);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: fee, tickSpacing: spacing, hooks: hooks
        });
        return ArcaUniV4Router.Hop({key: key, zeroForOne: from < to});
    }

    function _v(string memory sym, string memory field) internal pure returns (string memory) {
        return string.concat("ARCA_", sym, "_", field);
    }

    function _defaultSyms() internal pure returns (string[] memory s) {
        s = new string[](5);
        s[0] = "NVDA";
        s[1] = "MSFT";
        s[2] = "TSLA";
        s[3] = "GOOGL";
        s[4] = "SPCX";
    }
}
