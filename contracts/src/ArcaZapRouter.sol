// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IZapRouter} from "./ArcaZapper.sol";
import {
    Currency,
    BalanceDelta,
    PoolKey,
    IPoolManager,
    IUnlockCallback,
    BalanceDeltaLib
} from "./interfaces/IUniswapV4Minimal.sol";

/// @title ArcaZapRouter
/// @notice IZapRouter over Uniswap v4 for the ArcaZapper: every leg is a single USDG <-> stock hop
///         through that stock's registered USDG pool. Supports EXACT-OUTPUT (zapMint buys precisely
///         the basket amounts the vault will pull) and EXACT-INPUT (zapRedeem sells the whole basket).
///
/// Trust model: STATELESS w.r.t. funds — it moves only the caller's pre-approved tokens inside a
///         single unlock, pays the pool from the caller, and delivers output straight back to the
///         caller. No privileged role can touch user funds; the owner can only (re)point pool keys,
///         and a wrong key just makes swaps revert or price worse — bounded by the caller's
///         maxIn / minOut. Anyone may call it; it is periphery, not a dependency of the vault.
contract ArcaZapRouter is IZapRouter, IUnlockCallback {
    using SafeERC20 for IERC20;
    using BalanceDeltaLib for BalanceDelta;
    using SafeCast for uint256;
    using SafeCast for int256;

    IPoolManager public immutable poolManager;
    address public immutable usdg;
    address public owner;

    /// @dev stock token => its USDG pool. Both swap directions use the same pool.
    mapping(address => PoolKey) private _poolOf;
    mapping(address => bool) public hasPool;

    // v4 price-limit sentinels (min/max sqrtPrice, nudged one tick inward)
    uint160 internal constant MIN_SQRT_PRICE_LIMIT = 4295128739 + 1;
    uint160 internal constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342 - 1;

    event OwnerTransferred(address indexed from, address indexed to);
    event PoolSet(address indexed stock, uint24 fee, int24 tickSpacing, address hooks);

    error NotOwner();
    error OnlyPoolManager();
    error NoPool();
    error NotUsdgPair();
    error MaxInExceeded(uint256 needed, uint256 maxIn);
    error MinOutNotMet(uint256 got, uint256 minOut);
    error BadDelta();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager _poolManager, address _usdg, address _owner) {
        require(address(_poolManager) != address(0) && _usdg != address(0) && _owner != address(0), "zero");
        poolManager = _poolManager;
        usdg = _usdg;
        owner = _owner;
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "zero");
        emit OwnerTransferred(owner, to);
        owner = to;
    }

    /// @notice Register (or overwrite) the USDG pool used for `stock`. The key must pair stock/USDG.
    function setPool(address stock, PoolKey calldata key) external onlyOwner {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool pairsUsdg = (c0 == usdg && c1 == stock) || (c0 == stock && c1 == usdg);
        if (!pairsUsdg) revert NotUsdgPair();
        _poolOf[stock] = key;
        hasPool[stock] = true;
        emit PoolSet(stock, key.fee, key.tickSpacing, key.hooks);
    }

    function poolOf(address stock) external view returns (PoolKey memory) {
        return _poolOf[stock];
    }

    // ---------------------------------------------------------------------
    // IZapRouter
    // ---------------------------------------------------------------------

    /// @inheritdoc IZapRouter
    function swapExactOut(address tokenIn, address tokenOut, uint256 amountOut, uint256 maxIn)
        external
        override
        returns (uint256 amountIn)
    {
        bytes memory res = poolManager.unlock(abi.encode(true, msg.sender, tokenIn, tokenOut, amountOut, maxIn));
        amountIn = abi.decode(res, (uint256));
    }

    /// @inheritdoc IZapRouter
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        override
        returns (uint256 amountOut)
    {
        bytes memory res = poolManager.unlock(abi.encode(false, msg.sender, tokenIn, tokenOut, amountIn, minOut));
        amountOut = abi.decode(res, (uint256));
    }

    // ---------------------------------------------------------------------
    // v4 unlock callback
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (bool exactOut, address payer, address tokenIn, address tokenOut, uint256 amount, uint256 bound) =
            abi.decode(data, (bool, address, address, address, uint256, uint256));

        address stock = tokenIn == usdg ? tokenOut : tokenIn;
        if (!hasPool[stock]) revert NoPool();
        PoolKey memory key = _poolOf[stock];
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;

        // v4 sign convention: negative amountSpecified = exact input, positive = exact output.
        BalanceDelta delta = poolManager.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactOut ? int256(amount) : -int256(amount),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT
            }),
            ""
        );

        // positive delta = owed to us (output), negative = we owe (input)
        int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inDelta >= 0 || outDelta <= 0) revert BadDelta();

        uint256 amountIn = uint256(uint128(-inDelta));
        uint256 amountOut = uint256(uint128(outDelta));
        if (exactOut && amountIn > bound) revert MaxInExceeded(amountIn, bound);
        if (!exactOut && amountOut < bound) revert MinOutNotMet(amountOut, bound);

        // pay the input from the caller (single approval on the zapper side), take output to caller
        poolManager.sync(Currency.wrap(tokenIn));
        IERC20(tokenIn).safeTransferFrom(payer, address(poolManager), amountIn);
        poolManager.settle();
        poolManager.take(Currency.wrap(tokenOut), payer, amountOut);

        return abi.encode(exactOut ? amountIn : amountOut);
    }
}
