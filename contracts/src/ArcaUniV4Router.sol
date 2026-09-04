// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IArcaRouter} from "./ArcaVault.sol";
import {
    Currency,
    BalanceDelta,
    PoolKey,
    IPoolManager,
    IUnlockCallback,
    BalanceDeltaLib
} from "./interfaces/IUniswapV4Minimal.sol";

/// @title ArcaUniV4Router
/// @notice Adapter that lets ArcaVault.rebalance() swap over Uniswap v4 on Robinhood Chain.
///         The vault sees one clean `swap(tokenIn, tokenOut, amountIn, minOut)`; internally the
///         adapter walks an owner-registered route of 1..N v4 pools (e.g. NVDA -> USD -> AMD),
///         because tokenized stocks pair against a quote currency, not directly against each other.
///
/// Trust model: STATELESS w.r.t. funds. It only holds tokens transiently inside a single call:
///   pull tokenIn from the vault -> swap -> push tokenOut back to the vault. It never custodies
///   user funds and the vault caps slippage/turnover on its side, so a buggy/malicious route can
///   at worst waste an approved `amountIn` (bounded by the vault's guardrails), never drain it.
///
/// @dev The v4 interface subset (IUniswapV4Minimal) is hand-written; validate against live RHC
///      pools on a fork before mainnet. Exact-input only.
contract ArcaUniV4Router is IArcaRouter, IUnlockCallback {
    using SafeERC20 for IERC20;
    using BalanceDeltaLib for BalanceDelta;
    using SafeCast for uint256;
    using SafeCast for int256;

    /// @dev One leg of a route: a pool and the swap direction through it.
    struct Hop {
        PoolKey key;
        bool zeroForOne;
    }

    IPoolManager public immutable poolManager;
    address public owner;

    // pairId(tokenIn, tokenOut) => ordered hops
    mapping(bytes32 => Hop[]) private _routes;

    // v4 price-limit sentinels (min/max sqrtPrice, nudged one tick inward)
    uint160 internal constant MIN_SQRT_PRICE_LIMIT = 4295128739 + 1;
    uint160 internal constant MAX_SQRT_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342 - 1;

    event OwnerTransferred(address indexed from, address indexed to);
    event RouteSet(address indexed tokenIn, address indexed tokenOut, uint256 hops);

    error NotOwner();
    error OnlyPoolManager();
    error NoRoute();
    error EmptyRoute();
    error SlippageTooHigh();
    error BadOutput();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(IPoolManager _poolManager, address _owner) {
        require(address(_poolManager) != address(0) && _owner != address(0), "zero");
        poolManager = _poolManager;
        owner = _owner;
    }

    function transferOwnership(address to) external onlyOwner {
        require(to != address(0), "zero");
        emit OwnerTransferred(owner, to);
        owner = to;
    }

    /// @notice Register (or overwrite) the pool route used to swap `tokenIn` -> `tokenOut`.
    /// @dev Hops must chain: hop[0] input == tokenIn, hop[i].output == hop[i+1].input, last output == tokenOut.
    ///      Caller (owner) is responsible for supplying a coherent route; the vault's guardrails are the
    ///      security backstop, this is a correctness convenience.
    function setRoute(address tokenIn, address tokenOut, Hop[] calldata hops) external onlyOwner {
        if (hops.length == 0) revert EmptyRoute();
        bytes32 id = _pairId(tokenIn, tokenOut);
        delete _routes[id];
        for (uint256 i; i < hops.length; ++i) {
            _routes[id].push(hops[i]);
        }
        emit RouteSet(tokenIn, tokenOut, hops.length);
    }

    function routeLength(address tokenIn, address tokenOut) external view returns (uint256) {
        return _routes[_pairId(tokenIn, tokenOut)].length;
    }

    // ---------------------------------------------------------------------
    // IArcaRouter
    // ---------------------------------------------------------------------

    /// @inheritdoc IArcaRouter
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        override
        returns (uint256 amountOut)
    {
        bytes32 id = _pairId(tokenIn, tokenOut);
        if (_routes[id].length == 0) revert NoRoute();

        // pull exact input from the caller (the vault)
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        bytes memory res = poolManager.unlock(abi.encode(id, tokenIn, tokenOut, amountIn, msg.sender));
        amountOut = abi.decode(res, (uint256));
        if (amountOut < minOut) revert SlippageTooHigh();
    }

    // ---------------------------------------------------------------------
    // v4 unlock callback
    // ---------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        (bytes32 id, address tokenIn, address tokenOut, uint256 amountIn, address recipient) =
            abi.decode(data, (bytes32, address, address, uint256, address));

        Hop[] storage hops = _routes[id];
        uint256 currentAmount = amountIn;

        // Exact-input chain. Intermediate currency deltas net to zero across hops, so we only
        // settle the very first input and take the very last output.
        for (uint256 i; i < hops.length; ++i) {
            Hop storage h = hops[i];
            BalanceDelta delta = poolManager.swap(
                h.key,
                IPoolManager.SwapParams({
                    zeroForOne: h.zeroForOne,
                    amountSpecified: -currentAmount.toInt256(),
                    sqrtPriceLimitX96: h.zeroForOne ? MIN_SQRT_PRICE_LIMIT : MAX_SQRT_PRICE_LIMIT
                }),
                ""
            );
            // output side is positive (owed to us); input side is negative (we owe)
            int128 out = h.zeroForOne ? delta.amount1() : delta.amount0();
            if (out <= 0) revert BadOutput();
            currentAmount = int256(out).toUint256();
        }

        // pay the input token once
        poolManager.sync(Currency.wrap(tokenIn));
        IERC20(tokenIn).safeTransfer(address(poolManager), amountIn);
        poolManager.settle();

        // receive the final output straight to the vault
        poolManager.take(Currency.wrap(tokenOut), recipient, currentAmount);

        return abi.encode(currentAmount);
    }

    function _pairId(address tokenIn, address tokenOut) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(tokenIn, tokenOut));
    }
}
