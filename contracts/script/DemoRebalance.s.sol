// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {MockV4PoolManager} from "../test/mocks/MockV4PoolManager.sol";
import {Currency, PoolKey} from "../src/interfaces/IUniswapV4Minimal.sol";

/// @notice TESTNET demo: the agent rotates the basket — trim AMD, add NVDA — through the mock v4 pool.
///         One-off wiring (pool rate + route + reserves) then one value-neutral rebalance. The backing
///         invariant must hold before AND after. Addresses are the DeployArcaTestnet output on 46630.
contract DemoRebalance is Script {
    ArcaVault constant VAULT = ArcaVault(0xbbc3297beb20e8eD59db8d6DbB9FcC1A35b19fef);
    ArcaUniV4Router constant ROUTER = ArcaUniV4Router(0xbf8F1434d35D68CD3db1183a50B4084D2529a6a1);
    MockV4PoolManager constant PM = MockV4PoolManager(0xDcd709b2e6fD72A2bdf28257AeF88a7bfd35B92c);
    address constant AMD = 0xb49B043F574a5C923Abe7010A8952A7EB14fe6c5;
    address constant NVDA = 0xd87486c0B0669c641b07607102089Beb2b0461C9;

    // value-neutral: 1 AMD ($493.90) ~= 2.435449 NVDA ($202.80) at the mock oracle prices
    uint256 constant AMD_PER_NVDA_RATE = 2435449000000000000;

    function run() external {
        console2.log("== BEFORE ==");
        console2.log("fullyBacked:", VAULT.isFullyBacked());
        console2.log("vault AMD :", IERC20(AMD).balanceOf(address(VAULT)));
        console2.log("vault NVDA:", IERC20(NVDA).balanceOf(address(VAULT)));

        vm.startBroadcast();

        (address c0, address c1) = AMD < NVDA ? (AMD, NVDA) : (NVDA, AMD);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: address(0)
        });
        bool zeroForOne = AMD < NVDA; // AMD is currency0 => AMD->NVDA is zeroForOne

        // 1) price the mock pool value-neutral, 2) fund it with NVDA, 3) register AMD->NVDA route
        if (zeroForOne) PM.setRate(key, AMD_PER_NVDA_RATE, 0);
        else PM.setRate(key, 0, AMD_PER_NVDA_RATE);
        IERC20(NVDA).transfer(address(PM), 1 ether);
        ArcaUniV4Router.Hop[] memory hops = new ArcaUniV4Router.Hop[](1);
        hops[0] = ArcaUniV4Router.Hop({key: key, zeroForOne: zeroForOne});
        ROUTER.setRoute(AMD, NVDA, hops);

        // 4) the agent's call: trim 0.05 AMD into NVDA
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: AMD, tokenOut: NVDA, amountIn: 0.05 ether, minOut: 0.12 ether});
        VAULT.rebalance(swaps, keccak256("demo: NVDA momentum > AMD"));

        vm.stopBroadcast();

        console2.log("== AFTER ==");
        console2.log("fullyBacked:", VAULT.isFullyBacked());
        console2.log("vault AMD :", IERC20(AMD).balanceOf(address(VAULT)));
        console2.log("vault NVDA:", IERC20(NVDA).balanceOf(address(VAULT)));
        console2.log("NAV:", VAULT.nav());
    }
}
