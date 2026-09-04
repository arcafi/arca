// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaUniV4Router} from "../src/ArcaUniV4Router.sol";
import {IPoolManager} from "../src/interfaces/IUniswapV4Minimal.sol";
import {MockV4PoolManager} from "../test/mocks/MockV4PoolManager.sol";
import {MockStockOracle} from "./mocks/MockStockOracle.sol";

/// @notice Deploy Arca on RHC testnet (46630) backed by the REAL Robinhood testnet stock tokens the
///         deployer already holds (TSLA/AMD/AMZN/NFLX/PLTR — verified `uiMultiplier()==1e18`). Testnet
///         has no Chainlink stock feeds, so oracles are settable MockStockOracle seeded to realistic
///         prices; the mint/redeem/backing all run on genuine testnet stock tokens. Deployer mints 1 share.
contract DeployArcaTestnetReal is Script {
    struct Asset {
        string sym;
        address token; // real RH testnet stock token
        int256 price8; // seed price for the mock oracle (8-dec USD)
        uint256 unit; // backing per 1e18 shares (~$100/leg)
    }

    function run() external {
        address me = msg.sender;

        Asset[] memory a = new Asset[](5);
        a[0] = Asset("TSLA", 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E, 430_00000000, 232600000000000000);
        a[1] = Asset("AMD", 0x71178BAc73cBeb415514eB542a8995b82669778d, 494_00000000, 202400000000000000);
        a[2] = Asset("AMZN", 0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02, 220_00000000, 454500000000000000);
        a[3] = Asset("NFLX", 0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93, 1200_00000000, 83300000000000000);
        a[4] = Asset("PLTR", 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0, 132_00000000, 757600000000000000);

        uint256 n = a.length;
        address[] memory tokens = new address[](n);
        address[] memory oracles = new address[](n);
        uint256[] memory units = new uint256[](n);

        vm.startBroadcast();

        for (uint256 i; i < n; ++i) {
            oracles[i] =
                address(new MockStockOracle(a[i].price8, 8, string.concat(a[i].sym, " / USD (testnet mock feed)")));
            tokens[i] = a[i].token;
            units[i] = a[i].unit;
        }

        MockV4PoolManager pm = new MockV4PoolManager();
        ArcaUniV4Router router = new ArcaUniV4Router(IPoolManager(address(pm)), me);

        ArcaVault vault = new ArcaVault(
            "Arca Frontier (testnet, real assets)",
            "ARCIr",
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

        // mint 1 share using the REAL testnet stock tokens the deployer holds
        for (uint256 i; i < n; ++i) {
            IERC20(tokens[i]).approve(address(vault), type(uint256).max);
        }
        vault.mint(1 ether, me);

        vm.stopBroadcast();

        console2.log("ArcaVault (real assets):", address(vault));
        console2.log("ArcaUniV4Router:", address(router));
        console2.log("PoolManager (mock):", address(pm));
        console2.log("shares held by deployer:", vault.balanceOf(me));
        console2.log("fullyBacked:", vault.isFullyBacked());
        for (uint256 i; i < n; ++i) {
            console2.log(a[i].sym, "backing in vault:", IERC20(tokens[i]).balanceOf(address(vault)));
        }
    }
}
