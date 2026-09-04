// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcaVault} from "../src/ArcaVault.sol";

contract MockToken is ERC20 {
    uint8 private immutable _customDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _customDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _customDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOracle {
    int256 private _answer;
    uint8 private immutable _decimals;
    uint256 private _updatedAt;

    constructor(int256 answer_, uint8 decimals_) {
        _answer = answer_;
        _decimals = decimals_;
        _updatedAt = 1;
    }

    function setAnswer(int256 answer_) external {
        _answer = answer_;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (0, _answer, 0, _updatedAt, 0);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}

contract MockRouter {
    using SafeERC20 for IERC20;

    error InsufficientOutput();

    mapping(bytes32 => uint256) public rateBps;

    function setRate(address tokenIn, address tokenOut, uint256 rateBps_) external {
        rateBps[_pair(tokenIn, tokenOut)] = rateBps_;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256) {
        uint256 rate = rateBps[_pair(tokenIn, tokenOut)];
        if (rate == 0) rate = 10_000;

        uint256 amountOut = (amountIn * rate) / 10_000;
        if (amountOut < minOut) revert InsufficientOutput();

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
        return amountOut;
    }

    function _pair(address tokenIn, address tokenOut) private pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }
}

abstract contract ArcaVaultTestBase is Test {
    uint256 internal constant UNIT_A = 15e17;
    uint256 internal constant UNIT_B = 25e17;
    uint256 internal constant DEFAULT_CAP = 1_000e18;
    uint256 internal constant SUPPLY_CEILING = 1_000_000e18;
    uint64 internal constant COOLDOWN = 1 days;

    address internal guardian = address(0xA11CE);
    address internal rebalancer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    address internal alice = address(0xA1A1);
    address internal bob = address(0xB0B0);

    MockToken internal assetA;
    MockToken internal assetB;
    MockToken internal assetC;
    MockOracle internal oracleA;
    MockOracle internal oracleB;
    MockRouter internal router;
    ArcaVault internal vault;

    function _deployVault(uint16 mintFeeBps, uint16 maxSlippageBps, uint16 maxTurnoverBps, uint256 supplyCap)
        internal
        returns (ArcaVault deployed)
    {
        assetA = new MockToken("Stock A", "A", 18);
        assetB = new MockToken("Stock B", "B", 18);
        assetC = new MockToken("Stock C", "C", 18);
        oracleA = new MockOracle(1e8, 8);
        oracleB = new MockOracle(1e8, 8);
        router = new MockRouter();

        address[] memory assets = _newAssets();
        uint256[] memory units_ = _newUnits();
        address[] memory oracles = _newOracles();
        ArcaVault.Config memory cfg = _newConfig(mintFeeBps, maxSlippageBps, maxTurnoverBps, supplyCap);

        deployed = new ArcaVault("Arca Frontier Preview", "FRONTIER-PREVIEW", assets, units_, oracles, cfg);
        vault = deployed;
    }

    function _newConfig(uint16 mintFeeBps, uint16 maxSlippageBps, uint16 maxTurnoverBps, uint256 supplyCap)
        internal
        view
        returns (ArcaVault.Config memory cfg)
    {
        cfg = ArcaVault.Config({
            supplyCeiling: SUPPLY_CEILING,
            supplyCap: supplyCap,
            mintFeeBps: mintFeeBps,
            maxSlippageBps: maxSlippageBps,
            maxTurnoverBps: maxTurnoverBps,
            rebalanceCooldown: COOLDOWN,
            maxOracleAge: type(uint64).max,
            sequencerUptimeFeed: address(0),
            guardian: guardian,
            rebalancer: rebalancer,
            feeRecipient: feeRecipient,
            router: address(router)
        });
    }

    function _newAssets() internal view returns (address[] memory assets) {
        assets = new address[](2);
        assets[0] = address(assetA);
        assets[1] = address(assetB);
    }

    function _newUnits() internal pure returns (uint256[] memory units_) {
        units_ = new uint256[](2);
        units_[0] = UNIT_A;
        units_[1] = UNIT_B;
    }

    function _newOracles() internal view returns (address[] memory oracles) {
        oracles = new address[](2);
        oracles[0] = address(oracleA);
        oracles[1] = address(oracleB);
    }

    function _required(uint256 shares, uint256 unit) internal pure returns (uint256) {
        return (shares * unit + 1e18 - 1) / 1e18;
    }

    function _fundAndApprove(address owner, uint256 shares) internal {
        assetA.mint(owner, _required(shares, UNIT_A));
        assetB.mint(owner, _required(shares, UNIT_B));

        vm.startPrank(owner);
        assetA.approve(address(vault), type(uint256).max);
        assetB.approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    function _mintShares(address owner, uint256 shares) internal {
        _mintShares(owner, owner, shares);
    }

    function _mintShares(address owner, address to, uint256 shares) internal {
        _fundAndApprove(owner, shares);
        vm.prank(owner);
        vault.mint(shares, to);
    }

    function _seedRouter(MockToken token, uint256 amount) internal {
        token.mint(address(router), amount);
    }

    function _oneSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        pure
        returns (ArcaVault.Swap[] memory swaps)
    {
        swaps = new ArcaVault.Swap[](1);
        swaps[0] = ArcaVault.Swap({tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, minOut: minOut});
    }
}

contract ArcaVaultTest is ArcaVaultTestBase {
    function setUp() public {
        _deployVault(0, 100, 5_000, DEFAULT_CAP);
    }

    function testConstructorStoresConfig() public {
        assertEq(vault.name(), "Arca Frontier Preview");
        assertEq(vault.symbol(), "FRONTIER-PREVIEW");
        assertEq(vault.SUPPLY_CEILING(), SUPPLY_CEILING);
        assertEq(vault.supplyCap(), DEFAULT_CAP);
        assertEq(vault.mintFeeBps(), 0);
        assertEq(vault.maxSlippageBps(), 100);
        assertEq(vault.maxTurnoverBps(), 5_000);
        assertEq(vault.rebalanceCooldown(), COOLDOWN);
        assertEq(vault.guardian(), guardian);
        assertEq(vault.rebalancer(), rebalancer);
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(address(vault.router()), address(router));

        address[] memory assets = vault.assets();
        assertEq(assets.length, 2);
        assertEq(assets[0], address(assetA));
        assertEq(assets[1], address(assetB));
        assertTrue(vault.isAsset(address(assetA)));
        assertTrue(vault.isAsset(address(assetB)));
        assertFalse(vault.isAsset(address(assetC)));

        uint256[] memory units_ = vault.units();
        assertEq(units_[0], UNIT_A);
        assertEq(units_[1], UNIT_B);
        assertEq(address(vault.oracleOf(address(assetA))), address(oracleA));
        assertEq(address(vault.oracleOf(address(assetB))), address(oracleB));
    }

    function testConstructorRevertsForEmptyAssets() public {
        address[] memory assets = new address[](0);
        uint256[] memory units_ = new uint256[](0);
        address[] memory oracles = new address[](0);
        ArcaVault.Config memory cfg = _newConfig(0, 100, 5_000, DEFAULT_CAP);

        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", assets, units_, oracles, cfg);
    }

    function testConstructorRevertsForLengthMismatch() public {
        address[] memory assets = _newAssets();
        uint256[] memory units_ = new uint256[](1);
        units_[0] = UNIT_A;
        address[] memory oracles = _newOracles();

        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", assets, units_, oracles, _newConfig(0, 100, 5_000, DEFAULT_CAP));
    }

    function testConstructorRevertsForDuplicateAsset() public {
        address[] memory assets = _newAssets();
        assets[1] = assets[0];

        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", assets, _newUnits(), _newOracles(), _newConfig(0, 100, 5_000, DEFAULT_CAP));
    }

    function testConstructorRevertsForZeroAssetUnitOrOracle() public {
        address[] memory assets = _newAssets();
        assets[0] = address(0);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", assets, _newUnits(), _newOracles(), _newConfig(0, 100, 5_000, DEFAULT_CAP));

        uint256[] memory units_ = _newUnits();
        units_[0] = 0;
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), units_, _newOracles(), _newConfig(0, 100, 5_000, DEFAULT_CAP));

        address[] memory oracles = _newOracles();
        oracles[0] = address(0);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), oracles, _newConfig(0, 100, 5_000, DEFAULT_CAP));
    }

    function testConstructorRevertsForBadConfig() public {
        ArcaVault.Config memory cfg = _newConfig(51, 100, 5_000, DEFAULT_CAP);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);

        cfg = _newConfig(0, 10_001, 5_000, DEFAULT_CAP);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);

        cfg = _newConfig(0, 100, 10_001, DEFAULT_CAP);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);

        cfg = _newConfig(0, 100, 5_000, SUPPLY_CEILING + 1);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);
    }

    function testConstructorRevertsForZeroCriticalAddresses() public {
        ArcaVault.Config memory cfg = _newConfig(0, 100, 5_000, DEFAULT_CAP);
        cfg.guardian = address(0);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);

        cfg = _newConfig(0, 100, 5_000, DEFAULT_CAP);
        cfg.feeRecipient = address(0);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);

        cfg = _newConfig(0, 100, 5_000, DEFAULT_CAP);
        cfg.router = address(0);
        vm.expectRevert(ArcaVault.BadConfig.selector);
        new ArcaVault("Bad", "BAD", _newAssets(), _newUnits(), _newOracles(), cfg);
    }

    function testMintPullsCeilBasketAndMintsShares() public {
        uint256 shares = 1;
        _mintShares(alice, bob, shares);

        assertEq(vault.balanceOf(bob), shares);
        assertEq(assetA.balanceOf(address(vault)), 2);
        assertEq(assetB.balanceOf(address(vault)), 3);
        assertTrue(vault.isFullyBacked());
    }

    function testMintMintsFeeSharesToFeeRecipient() public {
        _deployVault(50, 100, 5_000, DEFAULT_CAP);

        uint256 shares = 100e18;
        _mintShares(alice, shares);

        assertEq(vault.balanceOf(alice), 99_5e17);
        assertEq(vault.balanceOf(feeRecipient), 5e17);
        assertEq(vault.totalSupply(), shares);
        assertTrue(vault.isFullyBacked());
    }

    function testMintRevertsForZeroPausedOrCapExceeded() public {
        vm.expectRevert(ArcaVault.ZeroShares.selector);
        vault.mint(0, alice);

        vm.prank(guardian);
        vault.setMintPaused(true);
        _fundAndApprove(alice, 1e18);
        vm.expectRevert(ArcaVault.MintIsPaused.selector);
        vm.prank(alice);
        vault.mint(1e18, alice);

        vm.prank(guardian);
        vault.setMintPaused(false);
        _fundAndApprove(alice, DEFAULT_CAP + 1);
        vm.expectRevert(ArcaVault.CapExceeded.selector);
        vm.prank(alice);
        vault.mint(DEFAULT_CAP + 1, alice);
    }

    function testRedeemBurnsSharesAndReturnsFloorBasket() public {
        _mintShares(alice, 100e18);

        vm.prank(alice);
        vault.redeem(10e18, bob);

        assertEq(vault.balanceOf(alice), 90e18);
        assertEq(assetA.balanceOf(bob), 15e18);
        assertEq(assetB.balanceOf(bob), 25e18);
        assertEq(assetA.balanceOf(address(vault)), 135e18);
        assertEq(assetB.balanceOf(address(vault)), 225e18);
        assertTrue(vault.isFullyBacked());
    }

    function testRedeemFloorsTinyShareAmounts() public {
        _mintShares(alice, 1);

        vm.prank(alice);
        vault.redeem(1, bob);

        assertEq(assetA.balanceOf(bob), 1);
        assertEq(assetB.balanceOf(bob), 2);
        assertEq(vault.totalSupply(), 0);
        assertTrue(vault.isFullyBacked());
    }

    function testRedeemRevertsForZeroOrInsufficientBalance() public {
        vm.expectRevert(ArcaVault.ZeroShares.selector);
        vault.redeem(0, alice);

        vm.expectRevert();
        vm.prank(alice);
        vault.redeem(1, alice);
    }

    function testRedeemWorksWhenMintPausedAndRebalancerRemoved() public {
        _mintShares(alice, 100e18);

        vm.startPrank(guardian);
        vault.setMintPaused(true);
        vault.setRebalancer(address(0));
        vm.stopPrank();

        vm.prank(alice);
        vault.redeem(100e18, alice);

        assertEq(vault.totalSupply(), 0);
        assertEq(assetA.balanceOf(alice), 150e18);
        assertEq(assetB.balanceOf(alice), 250e18);
    }

    function testGuardianSettersAreAccessControlledAndBounded() public {
        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vm.prank(alice);
        vault.setMintPaused(true);

        vm.prank(guardian);
        vault.setMintPaused(true);
        assertTrue(vault.mintPaused());

        vm.prank(guardian);
        vault.setSupplyCap(900e18);
        assertEq(vault.supplyCap(), 900e18);

        vm.expectRevert(ArcaVault.BadConfig.selector);
        vm.prank(guardian);
        vault.setSupplyCap(901e18);

        vm.expectRevert(ArcaVault.BadConfig.selector);
        vm.prank(guardian);
        vault.setFeeRecipient(address(0));

        vm.prank(guardian);
        vault.setFeeRecipient(bob);
        assertEq(vault.feeRecipient(), bob);

        vm.prank(guardian);
        vault.setRebalancer(address(0));
        assertEq(vault.rebalancer(), address(0));
    }

    function testGuardianCanTransferGuardianRole() public {
        vm.prank(guardian);
        vault.setGuardian(bob);
        assertEq(vault.guardian(), bob);

        vm.expectRevert(ArcaVault.NotGuardian.selector);
        vm.prank(guardian);
        vault.setMintPaused(true);

        vm.prank(bob);
        vault.setMintPaused(true);
        assertTrue(vault.mintPaused());
    }

    function testGuardianCannotSetZeroGuardian() public {
        vm.expectRevert(ArcaVault.BadConfig.selector);
        vm.prank(guardian);
        vault.setGuardian(address(0));
    }

    function testRebalanceSwapsAndRecomputesUnits() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 50e18, 50e18), keccak256("rotate-a-to-b"));

        assertEq(assetA.balanceOf(address(vault)), 100e18);
        assertEq(assetB.balanceOf(address(vault)), 300e18);
        assertEq(assetA.allowance(address(vault), address(router)), 0);
        assertEq(vault.lastRebalance(), block.timestamp);

        uint256[] memory units_ = vault.units();
        assertEq(units_[0], 1e18);
        assertEq(units_[1], 3e18);
        assertTrue(vault.isFullyBacked());
    }

    function testRebalanceRevertsForNonRebalancerCooldownAndNonWhitelist() public {
        _mintShares(alice, 100e18);

        vm.expectRevert(ArcaVault.NotRebalancer.selector);
        vm.prank(alice);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 1e18, 1e18), keccak256("x"));

        vm.expectRevert(ArcaVault.Cooldown.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 1e18, 1e18), keccak256("x"));

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectRevert(ArcaVault.NotWhitelisted.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetC), address(assetB), 1e18, 1e18), keccak256("x"));

        vm.expectRevert(ArcaVault.NotWhitelisted.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetC), 1e18, 1e18), keccak256("x"));
    }

    function testRebalanceRevertsForSlippageTooHigh() public {
        _deployVault(0, 100, 5_000, DEFAULT_CAP);
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 8_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectRevert(ArcaVault.SlippageTooHigh.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 100e18, 80e18), keccak256("lossy"));

        assertEq(assetA.balanceOf(address(vault)), 150e18);
        assertEq(assetB.balanceOf(address(vault)), 250e18);
    }

    function testRebalanceRevertsForTurnoverTooHigh() public {
        _deployVault(0, 10_000, 1_000, DEFAULT_CAP);
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectRevert(ArcaVault.TurnoverTooHigh.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 50e18, 50e18), keccak256("too-much"));
    }

    function testRebalanceRevertsWhenRouterOutputBelowMinOut() public {
        _mintShares(alice, 100e18);
        _seedRouter(assetB, 1_000e18);
        router.setRate(address(assetA), address(assetB), 10_000);

        vm.warp(block.timestamp + COOLDOWN + 1);
        vm.expectRevert(MockRouter.InsufficientOutput.selector);
        vm.prank(rebalancer);
        vault.rebalance(_oneSwap(address(assetA), address(assetB), 10e18, 11e18), keccak256("min-out"));
    }

    function testNavUsesOraclePrices() public {
        _mintShares(alice, 100e18);
        assertEq(vault.nav(), 400e18);

        oracleB.setAnswer(2e8);
        assertEq(vault.nav(), 650e18);
    }

    function testNavRevertsForBadOracle() public {
        _mintShares(alice, 100e18);
        oracleA.setAnswer(0);

        vm.expectRevert(ArcaVault.BadPrice.selector);
        vault.nav();
    }

    function testFuzzMintRedeemKeepsBacking(uint96 rawShares, uint16 redeemBps) public {
        uint256 shares = bound(uint256(rawShares), 1, DEFAULT_CAP);
        _mintShares(alice, shares);
        assertTrue(vault.isFullyBacked());

        uint256 bps = bound(uint256(redeemBps), 0, 10_000);
        uint256 redeemShares = (shares * bps) / 10_000;
        if (redeemShares > 0) {
            vm.prank(alice);
            vault.redeem(redeemShares, bob);
        }

        assertTrue(vault.isFullyBacked());
    }
}

contract ArcaVaultHandler {
    MockToken internal immutable assetA;
    MockToken internal immutable assetB;
    ArcaVault internal immutable vault;

    uint256 internal constant UNIT_A = 15e17;
    uint256 internal constant UNIT_B = 25e17;

    constructor(MockToken assetA_, MockToken assetB_, ArcaVault vault_) {
        assetA = assetA_;
        assetB = assetB_;
        vault = vault_;

        assetA.approve(address(vault), type(uint256).max);
        assetB.approve(address(vault), type(uint256).max);
    }

    function mint(uint96 rawShares) external {
        uint256 shares = (uint256(rawShares) % 100e18) + 1;
        if (vault.totalSupply() + shares > vault.supplyCap()) return;

        assetA.mint(address(this), _required(shares, UNIT_A));
        assetB.mint(address(this), _required(shares, UNIT_B));
        vault.mint(shares, address(this));
    }

    function redeem(uint96 rawShares) external {
        uint256 balance = vault.balanceOf(address(this));
        if (balance == 0) return;

        uint256 shares = (uint256(rawShares) % balance) + 1;
        vault.redeem(shares, address(this));
    }

    function _required(uint256 shares, uint256 unit) private pure returns (uint256) {
        return (shares * unit + 1e18 - 1) / 1e18;
    }
}

contract ArcaVaultInvariantTest is ArcaVaultTestBase {
    ArcaVaultHandler internal handler;

    function setUp() public {
        _deployVault(0, 100, 5_000, DEFAULT_CAP);
        handler = new ArcaVaultHandler(assetA, assetB, vault);
        targetContract(address(handler));
    }

    function invariantVaultIsFullyBacked() public {
        assertTrue(vault.isFullyBacked());
    }

    function invariantBackingFormulaHolds() public {
        uint256 supply = vault.totalSupply();
        address[] memory assets = vault.assets();
        uint256[] memory units_ = vault.units();

        for (uint256 i; i < assets.length; ++i) {
            assertGe(IERC20(assets[i]).balanceOf(address(vault)), (supply * units_[i]) / 1e18);
        }
    }
}
