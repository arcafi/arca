// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Exact-output + exact-input swaps against an RHC venue. A real deployment wires this to a
///         Uniswap v4 adapter (extends the ArcaUniV4Router pattern to support exact-output) or an
///         aggregator (1inch / Rialto) that already routes across Uniswap, Arcus and Pleiades.
///         Stock tokens pair against USDG, so every leg is a single USDG <-> stock hop.
interface IZapRouter {
    /// @notice Spend up to `maxIn` of `tokenIn` to receive EXACTLY `amountOut` of `tokenOut`.
    /// @return amountIn actually spent (<= maxIn, or the call reverts).
    function swapExactOut(address tokenIn, address tokenOut, uint256 amountOut, uint256 maxIn)
        external
        returns (uint256 amountIn);

    /// @notice Spend EXACTLY `amountIn` of `tokenIn` for at least `minOut` of `tokenOut`.
    /// @return amountOut actually received (>= minOut, or the call reverts).
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut);
}

/// @notice The bits of ArcaVault the zapper touches. The vault is an ERC20 itself (the index token).
interface IArcaVault is IERC20 {
    function assets() external view returns (address[] memory);
    function units() external view returns (uint256[] memory);
    function mint(uint256 shares, address to) external;
    function redeem(uint256 shares, address to) external;
}

/// @title ArcaZapper
/// @notice One-click in/out of a Arca index using a single asset (USDG).
///           zapMint:  USDG -> (buy the exact basket) -> vault.mint -> index token to `to`
///           zapRedeem: index token -> vault.redeem -> (sell the basket) -> USDG to `to`
///
/// TRUST MODEL — this is PERIPHERY, and it adds NO trust to the vault:
///   * It custodies nothing between transactions; every zap is atomic and fully refunds leftovers.
///   * It has no privileged role on the vault — it calls the same public mint()/redeem() anyone can.
///   * The vault's guarantees (full backing, no-drain, redeem-never-pausable) are untouched; a bad
///     router can at worst waste the caller's slippage budget, bounded by maxUsdgIn / minUsdgOut.
///   * Anyone could deploy their own zapper. This one is a convenience, not a dependency.
///
/// @dev zapMint uses EXACT-OUTPUT swaps so it buys precisely `mulDivUp(shares, units[i], 1e18)` of
///      each asset — the amount mint() pulls — leaving zero stock dust; only unspent USDG is refunded.
///      zapRedeem uses EXACT-INPUT swaps (sell the whole redeemed basket). Fork-test against live RHC
///      pools before mainnet; per-pool depth is still early, so front-ends should size zaps to the
///      thinnest leg and pass a realistic slippage bound.
contract ArcaZapper is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeERC20 for IArcaVault;

    IArcaVault public immutable vault;
    IERC20 public immutable usdg;
    IZapRouter public immutable router;

    error ZeroShares();
    error SlippageExceeded(uint256 got, uint256 bound);

    event ZapMint(address indexed caller, address indexed to, uint256 shares, uint256 usdgSpent);
    event ZapRedeem(address indexed caller, address indexed to, uint256 shares, uint256 usdgOut);

    constructor(IArcaVault vault_, IERC20 usdg_, IZapRouter router_) {
        vault = vault_;
        usdg = usdg_;
        router = router_;
    }

    /// @notice Pay USDG, receive `shares` of the index in one transaction.
    /// @param shares      index tokens to mint (net of the vault's mint fee, sent to `to`).
    /// @param maxUsdgIn   hard cap on USDG spent — the whole zap reverts if the basket costs more.
    /// @param to          recipient of the minted index tokens.
    /// @return spent      USDG actually spent buying the basket.
    function zapMint(uint256 shares, uint256 maxUsdgIn, address to) external nonReentrant returns (uint256 spent) {
        if (shares == 0) revert ZeroShares();

        usdg.safeTransferFrom(msg.sender, address(this), maxUsdgIn);
        usdg.forceApprove(address(router), maxUsdgIn);

        address[] memory assets = vault.assets();
        uint256[] memory units = vault.units();
        for (uint256 i; i < assets.length; ++i) {
            uint256 need = _mulDivUp(shares, units[i], 1e18); // exactly what vault.mint() will pull
            if (need == 0) continue;
            spent += router.swapExactOut(address(usdg), assets[i], need, maxUsdgIn - spent);
            if (spent > maxUsdgIn) revert SlippageExceeded(spent, maxUsdgIn); // defensive; router should enforce
            IERC20(assets[i]).forceApprove(address(vault), need);
        }

        vault.mint(shares, to); // pulls the exact basket from this contract, mints (shares - fee) to `to`

        usdg.forceApprove(address(router), 0);
        uint256 leftover = maxUsdgIn - spent;
        if (leftover > 0) usdg.safeTransfer(msg.sender, leftover);

        emit ZapMint(msg.sender, to, shares, spent);
    }

    /// @notice Burn `shares` of the index and receive USDG in one transaction.
    /// @param shares       index tokens to redeem (caller must approve this contract for them first).
    /// @param minUsdgOut   minimum USDG to accept — reverts if the basket sells for less.
    /// @param to           recipient of the USDG.
    /// @return usdgOut     USDG sent to `to`.
    function zapRedeem(uint256 shares, uint256 minUsdgOut, address to) external nonReentrant returns (uint256 usdgOut) {
        if (shares == 0) revert ZeroShares();

        vault.safeTransferFrom(msg.sender, address(this), shares);
        vault.redeem(shares, address(this)); // burns this contract's shares, sends the basket here

        address[] memory assets = vault.assets();
        for (uint256 i; i < assets.length; ++i) {
            uint256 bal = IERC20(assets[i]).balanceOf(address(this));
            if (bal == 0) continue;
            IERC20(assets[i]).forceApprove(address(router), bal);
            usdgOut += router.swapExactIn(assets[i], address(usdg), bal, 0); // slippage bounded in aggregate below
        }

        if (usdgOut < minUsdgOut) revert SlippageExceeded(usdgOut, minUsdgOut);
        usdg.safeTransfer(to, usdgOut);

        emit ZapRedeem(msg.sender, to, shares, usdgOut);
    }

    /// @dev ceil(a*b/d) — mirrors ArcaVault._mulDivUp so `need` equals what mint() pulls, to the wei.
    function _mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b + d - 1) / d;
    }
}
