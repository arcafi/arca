// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {IPoolManager, PoolKey, Currency} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice Fork test with the REAL Uniswap v4 router, REAL Chainlink feeds, and REAL <stock>/USDG pools
///         on Robinhood Chain (4663). Proves the wired PoolKeys actually execute against live liquidity
///         and the vault stays fully backed (INV1) through an on-chain rebalance — the thing MockRouter
///         cannot prove. Frontier v2 hub = USDG; NVDA & MSFT both trade in a 0.3% / spacing-60 USDG pool.
///
///         Run:  RHC_FORK_URL=<rpc> forge test --match-contract ArcaFrontierRouterForkTest -vv
///         Auto-skips when RHC_FORK_URL is empty so CI/newcomers aren't blocked.
contract ArcaFrontierRouterForkTest is Test {
    // infra (verified on-chain 22 Jul 2026)
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    // Frontier v2 legs used here + their Chainlink feeds
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address internal constant MSFT_FEED = 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E;
    // both NVDA/USDG and MSFT/USDG are the 0.3% / spacing-60 pool, hookless
    uint24 internal constant FEE = 3000;
    int24 internal constant SP = 60;
    address internal constant HOOKS = address(0);

    // ~$100 per leg at ~$206 NVDA / ~$396 MSFT
    uint256 internal constant UNIT_NVDA = 484800000000000000;
    uint256 internal constant UNIT_MSFT = 252270000000000000;

    address internal owner = address(0x0FF1CE);
    address internal guardian = address(0xA11CE);
    address internal rebalancer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA1A1);

    ArcaUniV4Router internal router;
    ArcaVault internal vault;
    bool internal forkReady;

    function setUp() public {
        string memory rpc = vm.envOr("RHC_FORK_URL", string(""));
        if (bytes(rpc).length == 0) {
            forkReady = false;
            return;
        }
        vm.createSelectFork(rpc);
        forkReady = true;
        assertEq(block.chainid, 4663, "expected Robinhood Chain (4663)");

        router = new ArcaUniV4Router(IPoolManager(POOL_MANAGER), owner);
        vm.startPrank(owner);
        router.setRoute(NVDA, MSFT, _viaUsdg(NVDA, MSFT));
        router.setRoute(MSFT, NVDA, _viaUsdg(MSFT, NVDA));
        vm.stopPrank();

        address[] memory assets = new address[](2);
        assets[0] = NVDA;
        assets[1] = MSFT;
        uint256[] memory units_ = new uint256[](2);
        units_[0] = UNIT_NVDA;
        units_[1] = UNIT_MSFT;
        address[] memory oracles = new address[](2);
        oracles[0] = NVDA_FEED;
        oracles[1] = MSFT_FEED;

        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: 1_000_000e18,
            supplyCap: 10_000e18,
            mintFeeBps: 0,
            maxSlippageBps: 100, // 1% portfolio-level
            maxTurnoverBps: 5_000, // 50% per rebalance
            rebalanceCooldown: 1 days,
            maxOracleAge: type(uint64).max, // don't fail on weekend-stale feeds in the fork
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: rebalancer,
            feeRecipient: feeRecipient,
            router: address(router)
        });
        vault = new ArcaVault("Arca Frontier v2 Fork", "ARCI-FORK", assets, units_, oracles, cfg);
    }

    modifier onlyOnFork() {
        if (!forkReady) return;
        _;
    }

    // --- route construction (mirrors DeployArcaFrontier: hop through USDG, min/max currency order) ---

    function _hop(address from, address to) internal pure returns (ArcaUniV4Router.Hop memory h) {
        (address c0, address c1) = from < to ? (from, to) : (to, from);
        h = ArcaUniV4Router.Hop({
            key: PoolKey({
                currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: FEE, tickSpacing: SP, hooks: HOOKS
            }),
            zeroForOne: from < to
        });
    }

    function _viaUsdg(address from, address to) internal pure returns (ArcaUniV4Router.Hop[] memory hops) {
        hops = new ArcaUniV4Router.Hop[](2);
        hops[0] = _hop(from, USDG);
        hops[1] = _hop(USDG, to);
    }

    function _mint(uint256 shares) internal {
        uint256 needN = _ceil(shares * UNIT_NVDA, 1e18);
        uint256 needM = _ceil(shares * UNIT_MSFT, 1e18);
        deal(NVDA, alice, needN);
        deal(MSFT, alice, needM);
        vm.startPrank(alice);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        IERC20(MSFT).approve(address(vault), type(uint256).max);
        vault.mint(shares, alice);
        vm.stopPrank();
    }

    // --- tests ---

    /// nav reads the REAL Chainlink feeds; vault is fully backed after an in-kind mint.
    function testFork_navFromRealFeeds() public onlyOnFork {
        _mint(4e18);
        assertTrue(vault.isFullyBacked(), "backed after mint");
        assertGt(vault.nav(), 0, "nav from live feeds > 0");
    }

    /// The headline: a real NVDA->MSFT rebalance through live USDG pools keeps the vault fully backed,
    /// moves the balances the expected direction, recomputes units, and stays within the nav slippage guard.
    function testFork_realRebalanceStaysBacked() public onlyOnFork {
        _mint(4e18);

        uint256 nvdaBefore = IERC20(NVDA).balanceOf(address(vault));
        uint256 msftBefore = IERC20(MSFT).balanceOf(address(vault));
        uint256 navBefore = vault.nav();

        uint256 sellNvda = nvdaBefore / 5; // ~20% of the NVDA leg -> small turnover
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: NVDA, tokenOut: MSFT, amountIn: sellNvda, minOut: 0});

        vm.prank(rebalancer);
        vault.rebalance(swaps, bytes32("fork:NVDA->MSFT"));

        // balances moved the expected direction, and the leg was actually swapped on-chain
        assertEq(IERC20(NVDA).balanceOf(address(vault)), nvdaBefore - sellNvda, "NVDA leg reduced by amountIn");
        assertGt(IERC20(MSFT).balanceOf(address(vault)), msftBefore, "MSFT leg grew from the swap");

        // INV1: units mirror real balances -> still fully backed
        assertTrue(vault.isFullyBacked(), "fully backed after rebalance");
        uint256[] memory u = vault.units();
        assertLt(u[0], UNIT_NVDA, "NVDA unit fell");
        assertGt(u[1], UNIT_MSFT, "MSFT unit rose");

        // portfolio value must not drop beyond the 1% guard (small turnover -> tiny impact)
        uint256 navAfter = vault.nav();
        assertGe(navAfter * 10_000, navBefore * (10_000 - 100), "nav within slippage guard");
    }

    /// The slippage backstop fires on-chain: an impossible minOut makes the router revert, so a bad
    /// rebalance cannot settle. Proves the vault's guardrails are real against live pools.
    function testFork_rebalanceRevertsOnUnmetMinOut() public onlyOnFork {
        _mint(4e18);
        uint256 sellNvda = IERC20(NVDA).balanceOf(address(vault)) / 5;

        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: NVDA, tokenOut: MSFT, amountIn: sellNvda, minOut: 1_000_000e18});

        vm.prank(rebalancer);
        vm.expectRevert(ArcaUniV4Router.SlippageTooHigh.selector);
        vault.rebalance(swaps, bytes32("fork:bad-minout"));
    }

    function _ceil(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }
}
