// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ArcaVault} from "../src/ArcaVault.sol";
import {ArcaVaultTestBase, MockToken, MockOracle, MockRouter} from "./ArcaVault.t.sol";

// ===========================================================================
// Extra mint/redeem coverage
// ===========================================================================

contract ArcaVaultMintRedeemExtraTest is ArcaVaultTestBase {
    function setUp() public {
        _deployVault(0, 100, 5_000, DEFAULT_CAP);
    }

    function testMintCapExactBoundary() public {
        _mintShares(alice, DEFAULT_CAP);
        assertEq(vault.totalSupply(), DEFAULT_CAP);

        _fundAndApprove(alice, 1);
        vm.expectRevert(ArcaVault.CapExceeded.selector);
        vm.prank(alice);
        vault.mint(1, alice);
    }

    function testMintRevertsWithoutApproval() public {
        assetA.mint(alice, _required(1e18, UNIT_A));
        assetB.mint(alice, _required(1e18, UNIT_B));

        vm.expectRevert();
        vm.prank(alice);
        vault.mint(1e18, alice);
    }

    function testMintRevertsWithoutBalance() public {
        vm.startPrank(alice);
        assetA.approve(address(vault), type(uint256).max);
        assetB.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.expectRevert();
        vm.prank(alice);
        vault.mint(1e18, alice);
    }

    function testMintRevertsForZeroReceiver() public {
        _fundAndApprove(alice, 1e18);

        vm.expectRevert();
        vm.prank(alice);
        vault.mint(1e18, address(0));
    }

    function testMintToDifferentReceiverKeepsShareOwnership() public {
        _mintShares(alice, alice, 10e18);
        _mintShares(alice, bob, 20e18);

        assertEq(vault.balanceOf(alice), 10e18);
        assertEq(vault.balanceOf(bob), 20e18);
        assertEq(vault.totalSupply(), 30e18);
    }

    function testRedeemAfterShareTransfer() public {
        _mintShares(alice, 100e18);

        vm.prank(alice);
        assertTrue(IERC20(address(vault)).transfer(bob, 100e18));

        vm.prank(bob);
        vault.redeem(100e18, bob);
        assertEq(vault.totalSupply(), 0);
        assertEq(assetA.balanceOf(bob), 150e18);
        assertEq(assetB.balanceOf(bob), 250e18);
    }

    function testRedeemPartialByMultipleUsersKeepsBacking() public {
        _mintShares(alice, 100e18);
        _mintShares(bob, 200e18);
        assertEq(vault.totalSupply(), 300e18);

        vm.prank(alice);
        vault.redeem(50e18, alice);
        vm.prank(bob);
        vault.redeem(80e18, bob);
        assertTrue(vault.isFullyBacked());

        vm.prank(alice);
        vault.redeem(50e18, alice);
        vm.prank(bob);
        vault.redeem(120e18, bob);

        assertEq(vault.totalSupply(), 0);
        assertTrue(vault.isFullyBacked());
    }

    function testMintDoesNotUseOracle() public {
        oracleA.setAnswer(0);
        oracleB.setAnswer(0);

        _mintShares(alice, 10e18);

        vm.prank(alice);
        vault.redeem(10e18, alice);
    }

    function testShareTokenBasicErc20Ops() public {
        _mintShares(alice, 100e18);

        vm.prank(alice);
        IERC20(address(vault)).approve(bob, 40e18);
        vm.prank(bob);
        assertTrue(IERC20(address(vault)).transferFrom(alice, bob, 40e18));

        assertEq(vault.balanceOf(alice), 60e18);
        assertEq(vault.balanceOf(bob), 40e18);
        assertEq(IERC20(address(vault)).allowance(alice, bob), 0);
    }
}

// ===========================================================================
// Extra guardian coverage
// ===========================================================================

contract ArcaVaultGuardianExtraTest is ArcaVaultTestBase {
    function setUp() public {
        _deployVault(0, 100, 5_000, DEFAULT_CAP);
    }

    function testGuardianCanLowerCapBelowTotalSupply() public {
        _mintShares(alice, 500e18);

        vm.prank(guardian);
        vault.setSupplyCap(100e18);
        assertEq(vault.supplyCap(), 100e18);

        _fundAndApprove(alice, 1);
        vm.expectRevert(ArcaVault.CapExceeded.selector);
        vm.prank(alice);
        vault.mint(1, alice);

        vm.prank(alice);
        vault.redeem(500e18, alice);
        assertTrue(vault.isFullyBacked());
    }

    function testGuardianCannotBypassRedeem() public {
        _mintShares(alice, 100e18);

        vm.startPrank(guardian);
        vault.setMintPaused(true);
        vault.setSupplyCap(0);
        vault.setFeeRecipient(bob);
        vault.setRebalancer(address(0));
        vm.stopPrank();

        vm.prank(alice);
        vault.redeem(100e18, alice);
        assertEq(vault.totalSupply(), 0);
    }

    function testGuardianReplacementDoesNotAffectFeeShares() public {
        _deployVault(50, 100, 5_000, DEFAULT_CAP);
        _mintShares(alice, 100e18);
        uint256 feeBefore = vault.balanceOf(feeRecipient);
        assertEq(feeBefore, 5e17);

        vm.prank(guardian);
        vault.setFeeRecipient(bob);

        assertEq(vault.balanceOf(feeRecipient), feeBefore);
        assertEq(vault.balanceOf(bob), 0);
    }

    function testNonGuardianCannotCallSetters() public {
        vm.startPrank(alice);
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vault.setMintPaused(true);
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vault.setSupplyCap(1);
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vault.setFeeRecipient(bob);
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vault.setRebalancer(bob);
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vault.setGuardian(bob);
        vm.stopPrank();
    }

    function testGuardianCanSetSupplyCapToZero() public {
        vm.prank(guardian);
        vault.setSupplyCap(0);
        assertEq(vault.supplyCap(), 0);

        _fundAndApprove(alice, 1);
        vm.expectRevert(ArcaVault.CapExceeded.selector);
        vm.prank(alice);
        vault.mint(1, alice);
    }

    function testSetSupplyCapCannotExceedCeiling() public {
        vm.prank(guardian);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        vault.setSupplyCap(SUPPLY_CEILING + 1);
    }
}

// ===========================================================================
// Extra rebalance coverage
// ===========================================================================

contract ArcaVaultRebalanceExtraTest is ArcaVaultTestBase {
    event Rebalanced(address indexed by, bytes32 rationale, uint256 navBefore, uint256 navAfter);

    function setUp() public {
        _deployVault(0, 500, 10_000, DEFAULT_CAP);
    }

    function testRebalanceEmptyVaultSucceeds() public {
        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(new ArcaVault.Swap[](0), keccak256("noop"));
        assertEq(vault.lastRebalance(), block.timestamp);
    }

    function testNavZeroWhenVaultEmpty() public {
        assertEq(vault.nav(), 0);
    }

    function testRebalanceCooldownReenforcedAfterSuccess() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 10e18, 10e18), keccak256("first"));

        vm.expectRevert(ArcaVault.Cooldown.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 5e18, 5e18), keccak256("second"));

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 5e18, 5e18), keccak256("third"));
    }

    function testRebalanceMultipleSwapsAccumulateTurnover() public {
        _deployVault(0, 100, 2_000, DEFAULT_CAP);
        _mintShares(alice, 100e18);
        _seedRouter(assetA, 1_000e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);
        router.setRate(address(assetB), address(assetA), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](2);
        swaps[0] = ArcaVault.Swap(address(assetA), address(assetB), 60e18, 60e18);
        swaps[1] = ArcaVault.Swap(address(assetB), address(assetA), 60e18, 60e18);
        vm.expectRevert(ArcaVault.TurnoverTooHigh.selector);
        vm.prank(rebalancer);
        vault.rebalance(swaps, keccak256("too-much-combined"));
    }

    function testRebalanceZeroAmountSwapIsNoOp() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 0, 0), keccak256("zero"));

        assertEq(assetA.balanceOf(address(vault)), 150e18);
        assertEq(assetB.balanceOf(address(vault)), 250e18);
    }

    function testRebalanceRemovedRebalancerReverts() public {
        vm.prank(guardian);
        vault.setRebalancer(address(0));

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(alice);
        vm.expectRevert(ArcaVault.NotRebalancer.selector);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 1, 1), keccak256("x"));
    }

    function testRebalanceEmitsRationale() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectEmit(true, false, false, true);
        emit Rebalanced(rebalancer, keccak256("emit-me"), 400e18, 400e18);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 10e18, 10e18), keccak256("emit-me"));
    }

    function testRebalanceRoundTripPreservesUnits() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetA, 1_000e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);
        router.setRate(address(assetB), address(assetA), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 5e18, 5e18), keccak256("out"));

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetB), address(assetA), 5e18, 5e18), keccak256("back"));

        uint256[] memory units_ = vault.units();
        assertEq(units_[0], UNIT_A);
        assertEq(units_[1], UNIT_B);
        assertTrue(vault.isFullyBacked());
    }

    function testFuzzRebalanceNeutralRateAlwaysBalanced(uint96 rawAmount) public {
        _deployVault(0, 100, 10_000, DEFAULT_CAP);
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        uint256 amountIn = bound(uint256(rawAmount), 1, 150e18);
        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), amountIn, amountIn), keccak256("fuzz"));

        assertTrue(vault.isFullyBacked());
    }
}

// ===========================================================================
// Adversarial router: proves INV2 no-drain even if the router misbehaves
// ===========================================================================

contract EvilRouter {
    using SafeERC20 for IERC20;

    function swap(address tokenIn, address, uint256 amountIn, uint256) external returns (uint256) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn + 1);
        return 0;
    }
}

contract ArcaVaultAdversarialTest is ArcaVaultTestBase {
    EvilRouter internal evilRouter;

    function setUp() public {
        assetA = new MockToken("Stock A", "A", 18);
        assetB = new MockToken("Stock B", "B", 18);
        assetC = new MockToken("Stock C", "C", 18);
        oracleA = new MockOracle(1e8, 8);
        oracleB = new MockOracle(1e8, 8);
        evilRouter = new EvilRouter();

        address[] memory assets = _newAssets();
        uint256[] memory units_ = _newUnits();
        address[] memory oracles = _newOracles();
        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: SUPPLY_CEILING,
            supplyCap: DEFAULT_CAP,
            mintFeeBps: 0,
            maxSlippageBps: 10_000,
            maxTurnoverBps: 10_000,
            rebalanceCooldown: COOLDOWN,
            maxOracleAge: type(uint64).max,
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: rebalancer,
            feeRecipient: feeRecipient,
            router: address(evilRouter)
        });
        vault = new ArcaVault("Evil", "EVL", assets, units_, oracles, cfg);
    }

    function testEvilRouterCannotPullMoreThanAllowance() public {
        _mintShares(alice, 10e18);
        uint256 balABefore = assetA.balanceOf(address(vault));

        ArcaVault.Swap[] memory swaps = _oneSwap(address(assetA), address(assetB), 1e18, 0);
        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectRevert();
        vm.prank(rebalancer);
        vault.rebalance(swaps, keccak256("evil"));

        assertEq(assetA.balanceOf(address(vault)), balABefore);
        assertEq(assetA.allowance(address(vault), address(evilRouter)), 0);
    }
}

// ===========================================================================
// Mixed-decimal token support
// ===========================================================================

contract ArcaVaultMixedDecimalsTest is Test {
    uint256 internal constant UNIT_A6 = 100e6; // 100 units of a 6-decimal asset per 1e18 shares
    uint256 internal constant UNIT_B18 = 2e18; // 2 units of an 18-decimal asset per 1e18 shares

    address internal guardian = address(0xA11CE);
    address internal rebalancer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA1A1);

    MockToken internal assetA6;
    MockToken internal assetB18;
    MockOracle internal oracleA;
    MockOracle internal oracleB;
    MockRouter internal router;
    ArcaVault internal vault;

    function setUp() public {
        assetA6 = new MockToken("USDT-ish", "USDT", 6);
        assetB18 = new MockToken("Stock-ish", "STK", 18);
        oracleA = new MockOracle(1e8, 8);
        oracleB = new MockOracle(1e8, 8);
        router = new MockRouter();

        address[] memory assets = new address[](2);
        assets[0] = address(assetA6);
        assets[1] = address(assetB18);

        uint256[] memory units_ = new uint256[](2);
        units_[0] = UNIT_A6;
        units_[1] = UNIT_B18;

        address[] memory oracles = new address[](2);
        oracles[0] = address(oracleA);
        oracles[1] = address(oracleB);

        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: 1_000_000e18,
            supplyCap: 1_000e18,
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

        vault = new ArcaVault("Mixed", "MIX", assets, units_, oracles, cfg);
    }

    function testMixedDecimalMintAndRedeem() public {
        uint256 shares = 10e18;
        uint256 needA6 = (shares * UNIT_A6 + 1e18 - 1) / 1e18;
        uint256 needB18 = (shares * UNIT_B18 + 1e18 - 1) / 1e18;

        assetA6.mint(alice, needA6);
        assetB18.mint(alice, needB18);
        vm.startPrank(alice);
        assetA6.approve(address(vault), type(uint256).max);
        assetB18.approve(address(vault), type(uint256).max);
        vault.mint(shares, alice);
        vm.stopPrank();

        assertEq(assetA6.balanceOf(address(vault)), needA6);
        assertEq(assetB18.balanceOf(address(vault)), needB18);
        assertTrue(vault.isFullyBacked());

        vm.prank(alice);
        vault.redeem(shares, alice);
        assertEq(vault.totalSupply(), 0);
        assertEq(assetA6.balanceOf(alice), needA6);
        assertEq(assetB18.balanceOf(alice), needB18);
    }

    function testMixedDecimalAssetsAndUnitsGettersAreConsistent() public {
        address[] memory assets = vault.assets();
        uint256[] memory units_ = vault.units();
        assertEq(assets.length, units_.length);
        assertEq(units_[0], UNIT_A6);
        assertEq(units_[1], UNIT_B18);
    }
}

// ===========================================================================
// INV2 accounting invariant — proves no drain paths beyond mint/redeem/router
// ===========================================================================

contract ArcaVaultAccountingHandler {
    using SafeERC20 for IERC20;

    MockToken public immutable assetA;
    MockToken public immutable assetB;
    MockRouter public immutable router;
    ArcaVault public immutable vault;

    uint256 public depositedA;
    uint256 public depositedB;
    uint256 public redeemedA;
    uint256 public redeemedB;
    uint256 public swappedOutA;
    uint256 public swappedOutB;
    uint256 public swappedInA;
    uint256 public swappedInB;

    uint256 internal constant MAX_MINT_SHARES = 50e18;

    constructor(MockToken assetA_, MockToken assetB_, MockRouter router_, ArcaVault vault_) {
        assetA = assetA_;
        assetB = assetB_;
        router = router_;
        vault = vault_;

        assetA.approve(address(vault), type(uint256).max);
        assetB.approve(address(vault), type(uint256).max);
    }

    function mint(uint96 rawShares) external {
        uint256 shares = (uint256(rawShares) % MAX_MINT_SHARES) + 1;
        if (vault.totalSupply() + shares > vault.supplyCap()) return;

        uint256[] memory u = vault.units();
        uint256 needA = _ceilDiv(shares * u[0], 1e18);
        uint256 needB = _ceilDiv(shares * u[1], 1e18);

        assetA.mint(address(this), needA);
        assetB.mint(address(this), needB);
        vault.mint(shares, address(this));

        depositedA += needA;
        depositedB += needB;
    }

    function redeem(uint96 rawShares) external {
        uint256 balance = vault.balanceOf(address(this));
        if (balance == 0) return;

        uint256 shares = (uint256(rawShares) % balance) + 1;
        uint256[] memory u = vault.units();
        uint256 outA = (shares * u[0]) / 1e18;
        uint256 outB = (shares * u[1]) / 1e18;

        vault.redeem(shares, address(this));
        redeemedA += outA;
        redeemedB += outB;
    }

    function rebalanceAtoB(uint96 rawAmount) external {
        uint256 balA = assetA.balanceOf(address(vault));
        if (balA == 0) return;

        uint256 amountIn = (uint256(rawAmount) % balA) + 1;
        assetB.mint(address(router), amountIn);
        router.setRate(address(assetA), address(assetB), 10_000);

        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap(address(assetA), address(assetB), amountIn, amountIn);

        try vault.rebalance(swaps, keccak256(abi.encodePacked("a2b", rawAmount))) {
            swappedOutA += amountIn;
            swappedInB += amountIn;
        } catch {}
    }

    function rebalanceBtoA(uint96 rawAmount) external {
        uint256 balB = assetB.balanceOf(address(vault));
        if (balB == 0) return;

        uint256 amountIn = (uint256(rawAmount) % balB) + 1;
        assetA.mint(address(router), amountIn);
        router.setRate(address(assetB), address(assetA), 10_000);

        ArcaVault.Swap[] memory swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap(address(assetB), address(assetA), amountIn, amountIn);

        try vault.rebalance(swaps, keccak256(abi.encodePacked("b2a", rawAmount))) {
            swappedOutB += amountIn;
            swappedInA += amountIn;
        } catch {}
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return (a + b - 1) / b;
    }
}

contract ArcaVaultAccountingInvariantTest is Test {
    uint256 internal constant UNIT_A = 15e17;
    uint256 internal constant UNIT_B = 25e17;

    address internal guardian = address(0xA11CE);
    address internal feeRecipient = address(0xFEE);

    MockToken internal assetA;
    MockToken internal assetB;
    MockOracle internal oracleA;
    MockOracle internal oracleB;
    MockRouter internal router;
    ArcaVault internal vault;
    ArcaVaultAccountingHandler internal handler;

    function setUp() public {
        assetA = new MockToken("Stock A", "A", 18);
        assetB = new MockToken("Stock B", "B", 18);
        oracleA = new MockOracle(1e8, 8);
        oracleB = new MockOracle(1e8, 8);
        router = new MockRouter();

        address[] memory assets = new address[](2);
        assets[0] = address(assetA);
        assets[1] = address(assetB);

        uint256[] memory units_ = new uint256[](2);
        units_[0] = UNIT_A;
        units_[1] = UNIT_B;

        address[] memory oracles = new address[](2);
        oracles[0] = address(oracleA);
        oracles[1] = address(oracleB);

        ArcaVault.Config memory cfg = ArcaVault.Config({
            supplyCeiling: 1_000_000e18,
            supplyCap: 500e18,
            mintFeeBps: 0,
            maxSlippageBps: 10_000,
            maxTurnoverBps: 10_000,
            rebalanceCooldown: 0,
            maxOracleAge: type(uint64).max,
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: address(0),
            feeRecipient: feeRecipient,
            router: address(router)
        });
        vault = new ArcaVault("Arca Accounting", "ACC", assets, units_, oracles, cfg);

        handler = new ArcaVaultAccountingHandler(assetA, assetB, router, vault);

        vm.prank(guardian);
        vault.setRebalancer(address(handler));

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = ArcaVaultAccountingHandler.mint.selector;
        selectors[1] = ArcaVaultAccountingHandler.redeem.selector;
        selectors[2] = ArcaVaultAccountingHandler.rebalanceAtoB.selector;
        selectors[3] = ArcaVaultAccountingHandler.rebalanceBtoA.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantAccountingA() public {
        uint256 tracked = handler.depositedA() + handler.swappedInA() - handler.redeemedA() - handler.swappedOutA();
        assertEq(assetA.balanceOf(address(vault)), tracked);
    }

    function invariantAccountingB() public {
        uint256 tracked = handler.depositedB() + handler.swappedInB() - handler.redeemedB() - handler.swappedOutB();
        assertEq(assetB.balanceOf(address(vault)), tracked);
    }

    function invariantBackingHoldsUnderRebalance() public {
        assertTrue(vault.isFullyBacked());
    }
}
