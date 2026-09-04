// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {IPoolManager} from "../src/interfaces/IUniswapV4Minimal.sol";
import {MockV4PoolManager} from "../test/mocks/MockV4PoolManager.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";
import {MockStockOracle} from "./mocks/MockStockOracle.sol";

/// @notice Deploy a SELF-CONTAINED Arca Frontier on RHC testnet (46630), where RH's real stock tokens
///         and Chainlink feeds don't exist. Stands up mock stock tokens + mock oracles + a mock v4
///         PoolManager, then the REAL ArcaUniV4Router + ArcaVault on top, and smoke-mints one share.
///         Same system as mainnet, with fakes for the mainnet-only assets. Deployer plays every role.
///
///   forge script script/DeployArcaTestnet.s.sol:DeployArcaTestnet --rpc-url <testnet> --private-key $PK --broadcast
contract DeployArcaTestnet is Script {
    struct Sym {
        string sym;
        int256 price8; // 8-decimal USD price for the mock feed
        uint256 unit; // backing per 1e18 shares (18-dec)
    }

    function run() external {
        address me = msg.sender; // deployer = owner/guardian/rebalancer/feeRecipient for the demo

        Sym[] memory basket = new Sym[](5);
        basket[0] = Sym("NVDA", 202_79625000, 493100000000000000); // ~0.4931 NVDA
        basket[1] = Sym("AMD", 493_89930000, 202500000000000000); // ~0.2025 AMD
        basket[2] = Sym("MU", 844_15490000, 118500000000000000); // ~0.1185 MU
        basket[3] = Sym("PLTR", 131_69235000, 759400000000000000); // ~0.7594 PLTR
        basket[4] = Sym("GOOGL", 346_61500000, 288500000000000000); // ~0.2885 GOOGL

        uint256 n = basket.length;
        address[] memory tokens = new address[](n);
        address[] memory oracles = new address[](n);
        uint256[] memory units = new uint256[](n);

        vm.startBroadcast();

        for (uint256 i; i < n; ++i) {
            MockStockToken t = new MockStockToken(basket[i].sym, basket[i].sym, 18);
            MockStockOracle o = new MockStockOracle(basket[i].price8, 8, string.concat(basket[i].sym, " / USD (mock)"));
            t.mint(me, 1_000_000 ether); // fund deployer so it can mint shares
            tokens[i] = address(t);
            oracles[i] = address(o);
            units[i] = basket[i].unit;
        }

        MockV4PoolManager pm = new MockV4PoolManager();
        ArcaUniV4Router router = new ArcaUniV4Router(IPoolManager(address(pm)), me);

        ArcaVault vault = new ArcaVault(
            "Arca Frontier (testnet)",
            "ARCI-t",
            tokens,
            units,
            oracles,
            ArcaVault.Config({
                supplyCeiling: 1_000_000 ether,
                supplyCap: 100_000 ether,
                mintFeeBps: 20,
                maxSlippageBps: 100,
                maxTurnoverBps: 5000,
                rebalanceCooldown: 1 hours,
                maxOracleAge: type(uint64).max,
                sequencerUptimeFeed: address(0),
                guardian: me,
                rebalancer: me,
                feeRecipient: me,
                router: address(router)
            })
        );

        // smoke test: mint 1 share end-to-end
        for (uint256 i; i < n; ++i) {
            IERC20(tokens[i]).approve(address(vault), type(uint256).max);
        }
        vault.mint(1 ether, me);

        vm.stopBroadcast();

        console2.log("PoolManager (mock):", address(pm));
        console2.log("ArcaUniV4Router:  ", address(router));
        console2.log("ArcaVault:        ", address(vault));
        console2.log("shares held by deployer:", vault.balanceOf(me));
        for (uint256 i; i < n; ++i) {
            console2.log(basket[i].sym, "token", tokens[i]);
            console2.log(basket[i].sym, "oracle", oracles[i]);
        }
    }
}
