// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {MockV4PoolManager} from "../test/mocks/MockV4PoolManager.sol";
import {Currency, PoolKey} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice TESTNET demo on the REAL-asset vault: agent trims AMD, adds TSLA — real RHC testnet stock
///         tokens — through the mock v4 pool. Value-neutral, backing invariant holds before & after.
contract DemoRebalanceReal is Script {
    ArcaVault constant VAULT = ArcaVault(0x1Fb3f8c9569bd45D1D7b9417Cb7aDa64D7552A94);
    ArcaUniV4Router constant ROUTER = ArcaUniV4Router(0xBa8DbbE3C24B38ea48acc2d530331aD8aFc90998);
    MockV4PoolManager constant PM = MockV4PoolManager(0xdACf1CF9F336695C508f3325E7eF536CCd9dAF77);
    address constant AMD = 0x71178BAc73cBeb415514eB542a8995b82669778d;
    address constant TSLA = 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E;

    // value-neutral: 1 AMD ($494) ~= 1.148837 TSLA ($430)
    uint256 constant AMD_TO_TSLA_RATE = 1148837000000000000;

    function run() external {
        console2.log("== BEFORE ==  fullyBacked:", VAULT.isFullyBacked());
        console2.log("vault AMD :", IERC20(AMD).balanceOf(address(VAULT)));
        console2.log("vault TSLA:", IERC20(TSLA).balanceOf(address(VAULT)));

        vm.startBroadcast();

        (address c0, address c1) = AMD < TSLA ? (AMD, TSLA) : (TSLA, AMD);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: address(0)
        });
        bool zeroForOne = AMD < TSLA;

        if (zeroForOne) PM.setRate(key, AMD_TO_TSLA_RATE, 0);
        else PM.setRate(key, 0, AMD_TO_TSLA_RATE);
        IERC20(TSLA).transfer(address(PM), 1 ether); // fund the pool so it can pay TSLA out

        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](1);
        hops[0] = ArcaUniV4Router.Hop({key: key, zeroForOne: zeroForOne});
        ROUTER.setRoute(AMD, TSLA, hops);

        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: AMD, tokenOut: TSLA, amountIn: 0.05 ether, minOut: 0.056 ether});
        VAULT.rebalance(swaps, keccak256("demo: TSLA momentum > AMD"));

        vm.stopBroadcast();

        console2.log("== AFTER ==  fullyBacked:", VAULT.isFullyBacked());
        console2.log("vault AMD :", IERC20(AMD).balanceOf(address(VAULT)));
        console2.log("vault TSLA:", IERC20(TSLA).balanceOf(address(VAULT)));
        console2.log("NAV:", VAULT.nav());
    }
}
