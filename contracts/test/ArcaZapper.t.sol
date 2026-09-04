// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcaVaultTestBase, MockToken} from "./ArcaVault.t.sol";
import {ArcaZapper, IZapRouter, IArcaVault} from "../src/ArcaZapper.sol";

/// Mock venue: swaps USDG <-> stock at a settable USDG-per-stock rate (1e18 = par).
/// Holds inventory of both sides so it can pay either direction.
contract MockZapRouter is IZapRouter {
    using SafeERC20 for IERC20;

    address public immutable usdg;
    mapping(address => uint256) public rate; // USDG per 1 stock, 1e18-scaled; 0 => par

    constructor(address usdg_) {
        usdg = usdg_;
    }

    function setRate(address stock, uint256 r) external {
        rate[stock] = r;
    }

    function _r(address stock) internal view returns (uint256) {
        uint256 r = rate[stock];
        return r == 0 ? 1e18 : r;
    }

    // buy EXACTLY amountOut of stock (tokenOut) using USDG (tokenIn)
    function swapExactOut(address tokenIn, address tokenOut, uint256 amountOut, uint256 maxIn)
        external
        returns (uint256 amountIn)
    {
        amountIn = (amountOut * _r(tokenOut)) / 1e18;
        require(amountIn <= maxIn, "maxIn");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    // sell EXACTLY amountIn of stock (tokenIn) for USDG (tokenOut)
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut)
    {
        amountOut = (amountIn * _r(tokenIn)) / 1e18;
        require(amountOut >= minOut, "minOut");
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}

contract ArcaZapperTest is ArcaVaultTestBase {
    MockToken internal usdg;
    MockZapRouter internal zrouter;
    ArcaZapper internal zapper;

    // 1 share needs 1.5 A + 2.5 B; at par that is 4 USDG.
    uint256 internal constant COST_PER_SHARE = 4e18;

    function setUp() public {
        _deployVault(0, 500, 5000, DEFAULT_CAP); // no mint fee => clean math
        usdg = new MockToken("Global Dollar", "USDG", 18);
        zrouter = new MockZapRouter(address(usdg));
        zapper = new ArcaZapper(IArcaVault(address(vault)), IERC20(address(usdg)), IZapRouter(address(zrouter)));

        // seed the venue: stock inventory to sell to the zapper, USDG to buy back on redeem
        assetA.mint(address(zrouter), 1_000e18);
        assetB.mint(address(zrouter), 1_000e18);
        usdg.mint(address(zrouter), 1_000e18);
    }

    function _fundUsdg(address who, uint256 amount) internal {
        usdg.mint(who, amount);
        vm.prank(who);
        usdg.approve(address(zapper), amount);
    }

    function test_zapMint_buysExactBasket_refundsLeftover_backsVault() public {
        _fundUsdg(alice, 5e18);
        vm.prank(alice);
        uint256 spent = zapper.zapMint(1e18, 5e18, alice);

        assertEq(spent, COST_PER_SHARE, "spent 1.5 + 2.5 USDG");
        assertEq(vault.balanceOf(alice), 1e18, "alice holds the index token");
        assertEq(usdg.balanceOf(alice), 5e18 - COST_PER_SHARE, "unspent USDG refunded");

        // zapper is left holding nothing
        assertEq(usdg.balanceOf(address(zapper)), 0, "no USDG stuck");
        assertEq(assetA.balanceOf(address(zapper)), 0, "no stock A dust");
        assertEq(assetB.balanceOf(address(zapper)), 0, "no stock B dust");

        // vault backed exactly by the basket for 1 share
        assertEq(assetA.balanceOf(address(vault)), 15e17, "vault holds 1.5 A");
        assertEq(assetB.balanceOf(address(vault)), 25e17, "vault holds 2.5 B");
        assertTrue(vault.isFullyBacked(), "fully backed");
    }

    function test_zapMint_revertsWhenBasketExceedsBudget() public {
        zrouter.setRate(address(assetA), 4e18); // A now costs 4x => 1.5 A = 6 USDG > 5 budget
        _fundUsdg(alice, 5e18);
        vm.prank(alice);
        vm.expectRevert(bytes("maxIn"));
        zapper.zapMint(1e18, 5e18, alice);
    }

    function test_zapRedeem_sellsBasket_forUsdg() public {
        _fundUsdg(alice, 20e18);
        vm.startPrank(alice);
        zapper.zapMint(2e18, 20e18, alice);

        vault.approve(address(zapper), 1e18);
        uint256 out = zapper.zapRedeem(1e18, 0, alice);
        vm.stopPrank();

        assertEq(out, COST_PER_SHARE, "1 share -> 4 USDG at par");
        assertEq(vault.balanceOf(alice), 1e18, "1 share still held");
    }

    function test_zapRedeem_revertsBelowMinOut() public {
        _fundUsdg(alice, 10e18);
        vm.startPrank(alice);
        zapper.zapMint(1e18, 10e18, alice);
        vault.approve(address(zapper), 1e18);
        vm.expectRevert(abi.encodeWithSelector(ArcaZapper.SlippageExceeded.selector, COST_PER_SHARE, 100e18));
        zapper.zapRedeem(1e18, 100e18, alice);
        vm.stopPrank();
    }

    function test_zapMint_revertsZeroShares() public {
        _fundUsdg(alice, 1e18);
        vm.prank(alice);
        vm.expectRevert(ArcaZapper.ZeroShares.selector);
        zapper.zapMint(0, 1e18, alice);
    }
}
