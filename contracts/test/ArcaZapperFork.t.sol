// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ArcaZapper, IArcaVault, IZapRouter} from "../src/ArcaZapper.sol";
import {ArcaZapRouter} from "../src/ArcaZapRouter.sol";
import {IPoolManager, PoolKey, Currency} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice Fork test of the FULL zap path against the LIVE mainnet vault and LIVE Uniswap v4 pools:
///         USDG -> (exact-output buys of all five legs) -> vault.mint -> ARCI, and back out again.
///         This is the one-click UX proven end-to-end on real chain state.
///
///         Run:  RHC_FORK_URL=<rpc> forge test --match-contract ArcaZapperForkTest -vv
contract ArcaZapperForkTest is Test {
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant VAULT = 0x4504483Ea748e630A9368F44f0Ee5B4350462Db8; // live Arca Frontier

    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address internal constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;

    address internal owner = address(0x0FF1CE);
    address internal alice = address(0xA1A1);

    ArcaZapRouter internal zapRouter;
    ArcaZapper internal zapper;
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

        zapRouter = new ArcaZapRouter(IPoolManager(POOL_MANAGER), USDG, owner);
        vm.startPrank(owner);
        zapRouter.setPool(NVDA, _key(NVDA, 3000, 60));
        zapRouter.setPool(MSFT, _key(MSFT, 3000, 60));
        zapRouter.setPool(TSLA, _key(TSLA, 3000, 60));
        zapRouter.setPool(GOOGL, _key(GOOGL, 3000, 60));
        zapRouter.setPool(SPCX, _key(SPCX, 10000, 200)); // SPCX trades in the 1% pool
        vm.stopPrank();

        zapper = new ArcaZapper(IArcaVault(VAULT), IERC20(USDG), IZapRouter(address(zapRouter)));
    }

    modifier onlyOnFork() {
        if (!forkReady) return;
        _;
    }

    function _key(address stock, uint24 fee, int24 spacing) internal pure returns (PoolKey memory) {
        (address c0, address c1) = USDG < stock ? (USDG, stock) : (stock, USDG);
        return PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: fee,
            tickSpacing: spacing,
            hooks: address(0)
        });
    }

    /// deal() can't find USDG's balance slot (upgradeable proxy), so acquire REAL USDG the honest
    /// way: deal a stock token and sell it through the live pool — which also exercises exact-in.
    function _fundUsdg(address who, uint256 nvdaToSell) internal {
        deal(NVDA, who, nvdaToSell);
        vm.startPrank(who);
        IERC20(NVDA).approve(address(zapRouter), nvdaToSell);
        zapRouter.swapExactIn(NVDA, USDG, nvdaToSell, 0);
        vm.stopPrank();
    }

    /// The headline: pay USDG only, receive the live index token — one transaction, basket bought
    /// exact-output on live pools, vault stays fully backed, leftover USDG refunded.
    function testFork_zapMintOneClick() public onlyOnFork {
        uint256 shares = 2e17; // 0.2 index tokens ≈ $100 basket
        uint256 budget = 120e6; // $120 USDG budget (slippage + fees headroom)
        _fundUsdg(alice, 7e17); // sell 0.7 NVDA (~$145) for real USDG
        assertGe(IERC20(USDG).balanceOf(alice), budget, "funded enough USDG");
        uint256 startBal = IERC20(USDG).balanceOf(alice);

        vm.startPrank(alice);
        IERC20(USDG).approve(address(zapper), budget);
        uint256 spent = zapper.zapMint(shares, budget, alice);
        vm.stopPrank();

        // alice got the index (net of the 0.20% mint fee), paid roughly the basket's value
        uint256 expectShares = shares - (shares * 20) / 10_000;
        assertEq(IERC20(VAULT).balanceOf(alice), expectShares, "index tokens received");
        assertGt(spent, 90e6, "spent a sane amount for a ~$100 basket");
        assertLt(spent, 115e6, "cost bounded near oracle value");
        assertEq(IERC20(USDG).balanceOf(alice), startBal - spent, "leftover USDG refunded");

        // zapper keeps NOTHING — atomic, custody-free
        assertEq(IERC20(USDG).balanceOf(address(zapper)), 0, "no USDG dust");
        assertEq(IERC20(NVDA).balanceOf(address(zapper)), 0, "no stock dust");
        assertEq(IERC20(VAULT).balanceOf(address(zapper)), 0, "no share dust");

        // the LIVE vault is still fully backed after our mint
        (bool ok, bytes memory ret) = VAULT.staticcall(abi.encodeWithSignature("isFullyBacked()"));
        assertTrue(ok && abi.decode(ret, (bool)), "live vault fully backed");
    }

    /// Round trip: zap in with USDG, zap back out to USDG. The cost of the loop is just fees+impact.
    function testFork_zapRedeemRoundTrip() public onlyOnFork {
        uint256 shares = 2e17;
        uint256 budget = 120e6;
        _fundUsdg(alice, 7e17);

        vm.startPrank(alice);
        IERC20(USDG).approve(address(zapper), budget);
        zapper.zapMint(shares, budget, alice);

        uint256 held = IERC20(VAULT).balanceOf(alice);
        IERC20(VAULT).approve(address(zapper), held);
        uint256 got = zapper.zapRedeem(held, 80e6, alice); // accept >= $80 for ~$100 of stocks
        vm.stopPrank();

        assertGe(got, 80e6, "round trip returns most of the value");
        assertEq(IERC20(VAULT).balanceOf(alice), 0, "all shares redeemed");
        assertEq(IERC20(USDG).balanceOf(address(zapper)), 0, "no USDG dust");
        assertEq(IERC20(VAULT).balanceOf(address(zapper)), 0, "no share dust");
    }

    /// The budget guard is real: an impossible cap reverts the whole zap — nothing is spent or stuck.
    function testFork_zapMintRevertsOverBudget() public onlyOnFork {
        uint256 shares = 2e17;
        uint256 tinyBudget = 10e6; // $10 can't buy a ~$100 basket
        _fundUsdg(alice, 1e17); // ~$20 of real USDG
        uint256 startBal = IERC20(USDG).balanceOf(alice);
        assertGe(startBal, tinyBudget, "funded enough for the tiny budget");

        vm.startPrank(alice);
        IERC20(USDG).approve(address(zapper), tinyBudget);
        vm.expectRevert(); // MaxInExceeded from the router (or transfer shortfall) — atomically reverts
        zapper.zapMint(shares, tinyBudget, alice);
        vm.stopPrank();

        assertEq(IERC20(USDG).balanceOf(alice), startBal, "nothing spent on revert");
    }
}
