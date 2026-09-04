// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ArcaVault} from "../src/ArcaVault.sol";
import {MockOracle, MockRouter} from "./ArcaVault.t.sol";

/// @notice Fork tests against Robinhood Chain (chain 4663).
///         Run with:  RHC_FORK_URL=<alchemy or public rpc> forge test --match-contract ArcaVaultRhcForkTest -vv
///         Tests are auto-skipped when RHC_FORK_URL is empty so CI/newcomers aren't blocked.
contract ArcaVaultRhcForkTest is Test {
    // Verified 17 Jul 2026 on chain 4663 (see research/konsep-Arca.md lampiran).
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant AMD = 0x86923f96303D656E4aa86D9d42D1e57ad2023fdC;

    uint256 internal constant UNIT_NVDA = 15e17; // 1.5 NVDA per share
    uint256 internal constant UNIT_AMD = 25e17; // 2.5 AMD per share

    address internal guardian = address(0xA11CE);
    address internal rebalancer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA1A1);
    address internal bob = address(0xB0B0);

    MockOracle internal oracleNvda;
    MockOracle internal oracleAmd;
    MockRouter internal router;
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

        // Real chain sanity — assert we forked what we think we forked.
        assertEq(block.chainid, 4663, "expected Robinhood Chain (4663)");
        assertEq(IERC20Metadata(NVDA).decimals(), 18, "NVDA decimals");
        assertEq(IERC20Metadata(AMD).decimals(), 18, "AMD decimals");

        oracleNvda = new MockOracle(1e8, 8); // oracle is only used by rebalance/nav, not mint/redeem
        oracleAmd = new MockOracle(1e8, 8);
        router = new MockRouter();

        address[] memory assets = new address[](2);
        assets[0] = NVDA;
        assets[1] = AMD;

        uint256[] memory units_ = new uint256[](2);
        units_[0] = UNIT_NVDA;
        units_[1] = UNIT_AMD;

        address[] memory oracles = new address[](2);
        oracles[0] = address(oracleNvda);
        oracles[1] = address(oracleAmd);

        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: 1_000_000e18,
            supplyCap: 10_000e18,
            mintFeeBps: 0,
            maxSlippageBps: 100,
            maxTurnoverBps: 5_000,
            rebalanceCooldown: 1 days,
            maxOracleAge: type(uint64).max,
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: rebalancer,
            feeRecipient: feeRecipient,
            router: address(router)
        });

        vault = new ArcaVault("Arca Frontier Fork", "FRONTIER-FORK", assets, units_, oracles, cfg);
    }

    modifier onlyOnFork() {
        if (!forkReady) return;
        _;
    }

    /// Sanity: the RPC actually put us on chain 4663 with real tokens.
    function testFork_chainAndAssets() public onlyOnFork {
        assertEq(block.chainid, 4663);
        assertEq(IERC20Metadata(NVDA).symbol(), "NVDA");
        assertEq(IERC20Metadata(AMD).symbol(), "AMD");
        assertGt(IERC20Metadata(NVDA).totalSupply(), 0);
        assertGt(IERC20Metadata(AMD).totalSupply(), 0);
    }

    /// End-to-end mint + partial redeem + full redeem against real token contracts.
    function testFork_mintRedeemInKindRoundTrip() public onlyOnFork {
        uint256 shares = 4e18; // 4 shares → 6 NVDA + 10 AMD in-kind

        uint256 needNvda = _ceilDiv(shares * UNIT_NVDA, 1e18);
        uint256 needAmd = _ceilDiv(shares * UNIT_AMD, 1e18);

        deal(NVDA, alice, needNvda);
        deal(AMD, alice, needAmd);
        assertEq(IERC20(NVDA).balanceOf(alice), needNvda);
        assertEq(IERC20(AMD).balanceOf(alice), needAmd);

        vm.startPrank(alice);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        IERC20(AMD).approve(address(vault), type(uint256).max);
        vault.mint(shares, alice);
        vm.stopPrank();

        assertEq(vault.balanceOf(alice), shares);
        assertEq(IERC20(NVDA).balanceOf(address(vault)), needNvda);
        assertEq(IERC20(AMD).balanceOf(address(vault)), needAmd);
        assertEq(IERC20(NVDA).balanceOf(alice), 0);
        assertEq(IERC20(AMD).balanceOf(alice), 0);
        assertTrue(vault.isFullyBacked());

        // Partial redeem → floor amounts to bob.
        vm.prank(alice);
        vault.redeem(1e18, bob);
        assertEq(IERC20(NVDA).balanceOf(bob), UNIT_NVDA);
        assertEq(IERC20(AMD).balanceOf(bob), UNIT_AMD);
        assertTrue(vault.isFullyBacked());

        // Full redeem — vault empties, alice recovers the rest.
        vm.prank(alice);
        vault.redeem(3e18, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(IERC20(NVDA).balanceOf(address(vault)), 0);
        assertEq(IERC20(AMD).balanceOf(address(vault)), 0);
        assertEq(IERC20(NVDA).balanceOf(alice), needNvda - UNIT_NVDA);
        assertEq(IERC20(AMD).balanceOf(alice), needAmd - UNIT_AMD);
    }

    /// Real tokens follow ERC20 spec: transfers with insufficient balance MUST revert.
    /// Proves the vault will not silently succeed if a token misbehaves later.
    function testFork_mintRevertsWhenUserBalanceInsufficient() public onlyOnFork {
        uint256 shares = 1e18;
        uint256 needNvda = _ceilDiv(shares * UNIT_NVDA, 1e18);

        // Only give NVDA; AMD balance stays zero.
        deal(NVDA, alice, needNvda);

        vm.startPrank(alice);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        IERC20(AMD).approve(address(vault), type(uint256).max);
        vm.expectRevert();
        vault.mint(shares, alice);
        vm.stopPrank();
    }

    /// Redeem must keep working under real-token semantics even with mint frozen and
    /// the rebalancer removed — the "agent dead, funds safe" property from the spec.
    function testFork_redeemLivenessUnderLockdown() public onlyOnFork {
        uint256 shares = 2e18;
        uint256 needNvda = _ceilDiv(shares * UNIT_NVDA, 1e18);
        uint256 needAmd = _ceilDiv(shares * UNIT_AMD, 1e18);

        deal(NVDA, alice, needNvda);
        deal(AMD, alice, needAmd);

        vm.startPrank(alice);
        IERC20(NVDA).approve(address(vault), type(uint256).max);
        IERC20(AMD).approve(address(vault), type(uint256).max);
        vault.mint(shares, alice);
        vm.stopPrank();

        vm.startPrank(guardian);
        vault.setMintPaused(true);
        vault.setRebalancer(address(0));
        vault.setSupplyCap(0);
        vm.stopPrank();

        vm.prank(alice);
        vault.redeem(shares, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(IERC20(NVDA).balanceOf(alice), needNvda);
        assertEq(IERC20(AMD).balanceOf(alice), needAmd);
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a + b - 1) / b;
    }
}

interface IERC20Metadata is IERC20 {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}
