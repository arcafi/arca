// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockToken} from "./ArcaVault.t.sol";
import {MockV4PoolManager} from "./mocks/MockV4PoolManager.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {Currency, PoolKey} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice Unit tests for the Uniswap v4 router adapter against a faithful mock PoolManager.
///         Validates the unlock/swap/settle/take accounting + multi-hop chaining. Real RHC pool
///         behaviour must still be fork-tested before mainnet.
contract ArcaUniV4RouterTest is Test {
    MockV4PoolManager pm;
    ArcaUniV4Router router;
    MockToken nvda;
    MockToken usd;
    MockToken amd;

    address owner = address(0xF1DE5);

    function setUp() public {
        pm = new MockV4PoolManager();
        router = new ArcaUniV4Router(pm, owner);
        nvda = new MockToken("NVDA", "NVDA", 18);
        usd = new MockToken("USD", "USD", 18);
        amd = new MockToken("AMD", "AMD", 18);
    }

    // ---- helpers ----

    function _key(address a, address b) internal pure returns (PoolKey memory k) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        k = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: address(0)
        });
    }

    /// @dev register a one-way rate for swapping `from`->`to` through the pool, in 1e18 fixed point
    function _pool(address from, address to, uint256 outPerInE18) internal returns (ArcaUniV4Router.Hop memory h) {
        PoolKey memory k = _key(from, to);
        bool zeroForOne = from < to;
        if (zeroForOne) {
            pm.setRate(k, outPerInE18, 0);
        } else {
            pm.setRate(k, 0, outPerInE18);
        }
        h = ArcaUniV4Router.Hop({key: k, zeroForOne: zeroForOne});
    }

    // ---- tests ----

    function test_singleHop_directPool() public {
        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](1);
        hops[0] = _pool(address(nvda), address(amd), 3e18); // 1 NVDA -> 3 AMD
        vm.prank(owner);
        router.setRoute(address(nvda), address(amd), hops);

        amd.mint(address(pm), 1_000_000e18); // pool reserves to pay out
        nvda.mint(address(this), 100e18);
        IERC20(address(nvda)).approve(address(router), 10e18);

        uint256 out = router.swap(address(nvda), address(amd), 10e18, 29e18);

        assertEq(out, 30e18, "expected 10*3");
        assertEq(amd.balanceOf(address(this)), 30e18, "vault got AMD");
        assertEq(nvda.balanceOf(address(pm)), 10e18, "pool got NVDA");
    }

    function test_twoHops_routedViaQuote() public {
        // NVDA -> USD (1:200) -> AMD (1 USD : 0.00625 AMD) => 10 NVDA -> 2000 USD -> 12.5 AMD
        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](2);
        hops[0] = _pool(address(nvda), address(usd), 200e18);
        hops[1] = _pool(address(usd), address(amd), 6.25e15);
        vm.prank(owner);
        router.setRoute(address(nvda), address(amd), hops);

        amd.mint(address(pm), 1_000_000e18); // only final output needs reserves; USD nets internally
        nvda.mint(address(this), 100e18);
        IERC20(address(nvda)).approve(address(router), 10e18);

        uint256 out = router.swap(address(nvda), address(amd), 10e18, 12e18);

        assertEq(out, 12.5e18, "expected 12.5 AMD");
        assertEq(amd.balanceOf(address(this)), 12.5e18);
        assertEq(nvda.balanceOf(address(pm)), 10e18);
        assertEq(usd.balanceOf(address(pm)), 0, "no intermediate USD moved");
    }

    function test_slippage_reverts() public {
        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](1);
        hops[0] = _pool(address(nvda), address(amd), 3e18);
        vm.prank(owner);
        router.setRoute(address(nvda), address(amd), hops);

        amd.mint(address(pm), 1_000_000e18);
        nvda.mint(address(this), 100e18);
        IERC20(address(nvda)).approve(address(router), 10e18);

        vm.expectRevert(ArcaUniV4Router.SlippageTooHigh.selector);
        router.swap(address(nvda), address(amd), 10e18, 31e18); // demands 31, gets 30
    }

    function test_noRoute_reverts() public {
        nvda.mint(address(this), 100e18);
        IERC20(address(nvda)).approve(address(router), 10e18);
        vm.expectRevert(ArcaUniV4Router.NoRoute.selector);
        router.swap(address(nvda), address(amd), 10e18, 0);
    }

    function test_setRoute_onlyOwner() public {
        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](1);
        hops[0] = _pool(address(nvda), address(amd), 3e18);
        vm.prank(address(0xBAD));
        vm.expectRevert(ArcaUniV4Router.NotOwner.selector);
        router.setRoute(address(nvda), address(amd), hops);
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(ArcaUniV4Router.OnlyPoolManager.selector);
        router.unlockCallback("");
    }

    function test_routeLength_and_overwrite() public {
        ArcaUniV4Router.Hop[] memory one = new ArcaUniV4Router.Hop[](1);
        one[0] = _pool(address(nvda), address(amd), 3e18);
        vm.prank(owner);
        router.setRoute(address(nvda), address(amd), one);
        assertEq(router.routeLength(address(nvda), address(amd)), 1);

        ArcaUniV4Router.Hop[] memory two = new ArcaUniV4Router.Hop[](2);
        two[0] = _pool(address(nvda), address(usd), 200e18);
        two[1] = _pool(address(usd), address(amd), 6.25e15);
        vm.prank(owner);
        router.setRoute(address(nvda), address(amd), two);
        assertEq(router.routeLength(address(nvda), address(amd)), 2, "overwritten, not appended");
    }
}
