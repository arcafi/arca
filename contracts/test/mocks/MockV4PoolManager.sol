// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    Currency,
    BalanceDelta,
    PoolKey,
    IPoolManager,
    IUnlockCallback,
    BalanceDeltaLib
} from "../../src/interfaces/IUniswapV4Minimal.sol";

/// @notice Test double for the Uniswap v4 PoolManager. Faithful enough to validate an adapter's
///         unlock/swap/settle/take accounting: it tracks per-locker currency deltas and REVERTS at
///         the end of unlock() if anything is left unsettled (exactly like real v4's lock invariant).
///         Swaps use a fixed per-pool rate (1e18 fixed-point). Must be pre-funded with output tokens.
contract MockV4PoolManager is IPoolManager {
    using BalanceDeltaLib for BalanceDelta;
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using SafeCast for int256;

    // poolId => output-per-1e18-input for each direction
    mapping(bytes32 => uint256) public rateZeroForOne; // currency1 out per 1e18 currency0 in
    mapping(bytes32 => uint256) public rateOneForZero; // currency0 out per 1e18 currency1 in

    // locker => currency => delta (positive: manager owes locker; negative: locker owes manager)
    mapping(address => mapping(address => int256)) public delta;
    address[] private _touched;
    mapping(address => bool) private _isTouched;

    address private _synced;
    uint256 private _syncedBalance;
    bool private _locked;

    function poolId(PoolKey calldata key) public pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function setRate(PoolKey calldata key, uint256 zeroForOne, uint256 oneForZero) external {
        bytes32 id = poolId(key);
        rateZeroForOne[id] = zeroForOne;
        rateOneForZero[id] = oneForZero;
    }

    function unlock(bytes calldata data) external override returns (bytes memory result) {
        require(!_locked, "locked");
        _locked = true;
        result = IUnlockCallback(msg.sender).unlockCallback(data);
        // enforce the lock invariant: every touched currency must net to zero
        for (uint256 i; i < _touched.length; ++i) {
            require(delta[msg.sender][_touched[i]] == 0, "unsettled");
            _isTouched[_touched[i]] = false;
        }
        delete _touched;
        _locked = false;
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        override
        returns (BalanceDelta)
    {
        require(_locked, "unlocked");
        require(params.amountSpecified < 0, "exact-input only");
        uint256 amountIn = uint256(-params.amountSpecified);
        bytes32 id = poolId(key);

        address cur0 = Currency.unwrap(key.currency0);
        address cur1 = Currency.unwrap(key.currency1);

        int128 a0;
        int128 a1;
        if (params.zeroForOne) {
            uint256 out = (amountIn * rateZeroForOne[id]) / 1e18;
            require(out > 0, "no liquidity");
            a0 = -amountIn.toInt256().toInt128();
            a1 = out.toInt256().toInt128();
        } else {
            uint256 out = (amountIn * rateOneForZero[id]) / 1e18;
            require(out > 0, "no liquidity");
            a0 = out.toInt256().toInt128();
            a1 = -amountIn.toInt256().toInt128();
        }
        _account(msg.sender, cur0, a0);
        _account(msg.sender, cur1, a1);
        return BalanceDeltaLib.toBalanceDelta(a0, a1);
    }

    function sync(Currency currency) external override {
        _synced = Currency.unwrap(currency);
        _syncedBalance = IERC20(_synced).balanceOf(address(this));
    }

    function settle() external payable override returns (uint256 paid) {
        uint256 bal = IERC20(_synced).balanceOf(address(this));
        paid = bal - _syncedBalance;
        _account(msg.sender, _synced, paid.toInt256().toInt128());
    }

    function take(Currency currency, address to, uint256 amount) external override {
        address c = Currency.unwrap(currency);
        _account(msg.sender, c, -amount.toInt256().toInt128());
        IERC20(c).safeTransfer(to, amount);
    }

    function _account(address locker, address currency, int128 d) private {
        delta[locker][currency] += d;
        if (!_isTouched[currency]) {
            _isTouched[currency] = true;
            _touched.push(currency);
        }
    }
}
