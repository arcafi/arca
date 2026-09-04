// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {MockToken, MockOracle, MockRouter} from "./ArcaVault.t.sol";

/// @notice Full-lifecycle tests on the REAL Arca Frontier basket (6 AI stock tokens),
///         with realistic prices — the other suites use a 2-asset toy basket.
contract ArcaVaultRealBasketTest is Test {
    string[6] internal SYM = ["NVDA", "AMD", "MU", "PLTR", "GOOGL", "SPCX"];
    // 8-decimal USD prices, roughly live values
    int256[6] internal PRICE =
        [int256(207e8), int256(518e8), int256(888e8), int256(133e8), int256(372e8), int256(132e8)];
    // per-1e18-share units (arbitrary positive weights)
    uint256[6] internal UNIT =
        [uint256(3e16), uint256(2e16), uint256(1e16), uint256(5e16), uint256(4e16), uint256(6e16)];

    MockToken[6] internal tok;
    MockOracle[6] internal orc;
    MockRouter internal router;
    ArcaVault internal vault;

    address internal guardian = address(0xA11CE);
    address internal rebalancer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA1);
    address internal bob = address(0xB2);

    event Mint(address indexed from, address indexed to, uint256 shares, uint256 fee);
    event Redeem(address indexed from, address indexed to, uint256 shares);
    event Rebalanced(address indexed by, bytes32 rationale, uint256 navBefore, uint256 navAfter);

    function setUp() public {
        _deploy(30); // 0.30% fee
    }

    function _deploy(uint16 feeBps) internal {
        address[] memory a = new address[](6);
        uint256[] memory u = new uint256[](6);
        address[] memory o = new address[](6);
        router = new MockRouter();
        for (uint256 i; i < 6; ++i) {
            tok[i] = new MockToken(SYM[i], SYM[i], 18);
            orc[i] = new MockOracle(PRICE[i], 8);
            a[i] = address(tok[i]);
            u[i] = UNIT[i];
            o[i] = address(orc[i]);
        }
        ArcaVault.Config memory c = ArcaVault.Config({
            supplyCeiling: 1_000_000e18,
            supplyCap: 1_000e18,
            mintFeeBps: feeBps,
            maxSlippageBps: 100, // 1%
            maxTurnoverBps: 5000, // 50%
            rebalanceCooldown: 1 days,
            maxOracleAge: type(uint64).max,
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: rebalancer,
            feeRecipient: feeRecipient,
            router: address(router)
        });
        vault = new ArcaVault("Arca Frontier", "FRONTIER", a, u, o, c);
    }

    function _required(uint256 shares, uint256 unit) internal pure returns (uint256) {
        return (shares * unit + 1e18 - 1) / 1e18; // ceil
    }

    function _fund(address who, uint256 shares) internal {
        vm.startPrank(who);
        for (uint256 i; i < 6; ++i) {
            uint256 amt = _required(shares, UNIT[i]);
            tok[i].mint(who, amt);
            tok[i].approve(address(vault), amt);
        }
        vm.stopPrank();
    }

    // --- mint / redeem ---

    function testMintPullsWholeSixAssetBasket() public {
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);

        uint256 fee = (10e18 * 30) / 10_000;
        assertEq(vault.balanceOf(alice), 10e18 - fee);
        assertEq(vault.balanceOf(feeRecipient), fee);
        assertEq(vault.totalSupply(), 10e18);
        for (uint256 i; i < 6; ++i) {
            assertEq(tok[i].balanceOf(address(vault)), _required(10e18, UNIT[i]));
        }
        assertTrue(vault.isFullyBacked());
    }

    function testRedeemReturnsWholeSixAssetBasket() public {
        _fund(alice, 10e18);
        vm.startPrank(alice);
        vault.mint(10e18, alice);
        uint256 shares = vault.balanceOf(alice);
        vault.redeem(shares, alice);
        vm.stopPrank();
        for (uint256 i; i < 6; ++i) {
            assertEq(tok[i].balanceOf(alice), (shares * UNIT[i]) / 1e18); // floor back to alice
        }
        assertTrue(vault.isFullyBacked());
    }

    function testMintEmitsEvent() public {
        _fund(alice, 5e18);
        uint256 fee = (5e18 * 30) / 10_000;
        vm.expectEmit(true, true, false, true, address(vault));
        emit Mint(alice, alice, 5e18, fee);
        vm.prank(alice);
        vault.mint(5e18, alice);
    }

    function testRedeemEmitsEvent() public {
        _fund(alice, 5e18);
        vm.startPrank(alice);
        vault.mint(5e18, alice);
        uint256 shares = vault.balanceOf(alice);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Redeem(alice, alice, shares);
        vault.redeem(shares, alice);
        vm.stopPrank();
    }

    function testRedeemToDifferentReceiver() public {
        _fund(alice, 8e18);
        vm.startPrank(alice);
        vault.mint(8e18, alice);
        uint256 shares = vault.balanceOf(alice);
        vault.redeem(shares, bob);
        vm.stopPrank();
        for (uint256 i; i < 6; ++i) {
            assertEq(tok[i].balanceOf(bob), (shares * UNIT[i]) / 1e18);
            assertEq(tok[i].balanceOf(alice), 0);
        }
    }

    // --- fee boundaries ---

    function testZeroFeeMintsEverythingToUser() public {
        _deploy(0);
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);
        assertEq(vault.balanceOf(alice), 10e18);
        assertEq(vault.balanceOf(feeRecipient), 0);
    }

    function testMaxFeeBoundary() public {
        _deploy(50); // 0.50% hard cap
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);
        uint256 fee = (10e18 * 50) / 10_000;
        assertEq(vault.balanceOf(feeRecipient), fee);
        assertEq(vault.balanceOf(alice), 10e18 - fee);
    }

    // --- nav ---

    function testNavAggregatesSixOraclePrices() public {
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);
        uint256 expected;
        for (uint256 i; i < 6; ++i) {
            uint256 bal = tok[i].balanceOf(address(vault));
            expected += (bal * uint256(PRICE[i])) / 1e8;
        }
        assertEq(vault.nav(), expected);
    }

    // --- rebalance ---

    function testRebalanceValueNeutralRecomputesUnitsAndKeepsBacking() public {
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);

        // swap some NVDA (idx0, $207) into GOOGL (idx4, $372) at the price ratio => value neutral
        uint256 amountIn = tok[0].balanceOf(address(vault)) / 2;
        uint256 rate = (uint256(PRICE[0]) * 10_000) / uint256(PRICE[4]); // out = in * pIn/pOut
        router.setRate(address(tok[0]), address(tok[4]), rate);
        // seed router with GOOGL so it can pay out
        tok[4].mint(address(router), 1_000e18);

        uint256 navBefore = vault.nav();
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: address(tok[0]), tokenOut: address(tok[4]), amountIn: amountIn, minOut: 0});

        vm.warp(block.timestamp + 1 days);
        vm.prank(rebalancer);
        vault.rebalance(swaps, keccak256("momentum: rotate NVDA->GOOGL"));

        assertTrue(vault.isFullyBacked());
        // units now reflect new balances
        uint256[] memory u = vault.units();
        uint256 supply = vault.totalSupply();
        for (uint256 i; i < 6; ++i) {
            assertEq(u[i], (tok[i].balanceOf(address(vault)) * 1e18) / supply);
        }
        // value preserved within slippage tolerance
        assertGe(vault.nav() * 10_000, navBefore * (10_000 - 100));
    }

    function testRebalanceEmitsRationale() public {
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);
        vm.warp(block.timestamp + 1 days);
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](0);
        vm.expectEmit(true, false, false, false, address(vault));
        emit Rebalanced(rebalancer, keccak256("noop"), 0, 0);
        vm.prank(rebalancer);
        vault.rebalance(swaps, keccak256("noop"));
    }

    function testRebalanceRevertsForNonWhitelistedAssetInSixBasket() public {
        MockToken evil = new MockToken("EVIL", "EVIL", 18);
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: address(tok[0]), tokenOut: address(evil), amountIn: 1, minOut: 0});
        vm.warp(block.timestamp + 1 days);
        vm.prank(rebalancer);
        vm.expectRevert(ArcaVault.NotWhitelisted.selector);
        vault.rebalance(swaps, bytes32(0));
    }

    // --- liveness / guardian ---

    function testRedeemWorksWhenMintPausedAndRebalancerZeroed() public {
        _fund(alice, 10e18);
        vm.prank(alice);
        vault.mint(10e18, alice);
        vm.startPrank(guardian);
        vault.setMintPaused(true);
        vault.setRebalancer(address(0));
        vm.stopPrank();

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice); // must still work
        assertEq(vault.balanceOf(alice), 0);
    }

    function testMultiUserMintRedeemKeepsBacking() public {
        _fund(alice, 12e18);
        _fund(bob, 7e18);
        vm.prank(alice);
        vault.mint(12e18, alice);
        vm.prank(bob);
        vault.mint(7e18, bob);
        assertTrue(vault.isFullyBacked());

        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        vault.redeem(bobShares, bob);
        assertTrue(vault.isFullyBacked());

        uint256 aliceHalf = vault.balanceOf(alice) / 2;
        vm.prank(alice);
        vault.redeem(aliceHalf, alice);
        assertTrue(vault.isFullyBacked());
    }

    // --- fuzz ---

    function testFuzzMintSixAssetKeepsBacking(uint256 shares) public {
        shares = bound(shares, 1e12, 1_000e18);
        _fund(alice, shares);
        vm.prank(alice);
        vault.mint(shares, alice);
        assertTrue(vault.isFullyBacked());
        for (uint256 i; i < 6; ++i) {
            assertGe(tok[i].balanceOf(address(vault)), (vault.totalSupply() * UNIT[i]) / 1e18);
        }
    }

    function testFuzzMintRedeemRoundTripSixAsset(uint256 shares) public {
        shares = bound(shares, 1e15, 1_000e18);
        _fund(alice, shares);
        vm.startPrank(alice);
        vault.mint(shares, alice);
        vault.redeem(vault.balanceOf(alice), alice);
        vm.stopPrank();
        assertTrue(vault.isFullyBacked());
    }
}
