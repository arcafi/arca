// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Minimal subset of the Uniswap v4 core surface that the Arca router adapter needs.
// Types mirror v4-core exactly (Currency/BalanceDelta as user-defined value types, PoolKey layout,
// SwapParams sign convention: negative amountSpecified = exact input). Kept local to avoid pulling
// the full v4-core dependency tree; MUST be validated against live RHC pools on a fork before mainnet.

type Currency is address;
type BalanceDelta is int256;

struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface IPoolManager {
    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified; // negative = exact input, positive = exact output
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Opens a lock; PoolManager calls `unlockCallback(data)` back on msg.sender.
    function unlock(bytes calldata data) external returns (bytes memory);

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (BalanceDelta);

    /// @notice Snapshot a currency's balance so a following transfer + settle() is credited.
    function sync(Currency currency) external;

    /// @notice Credit the caller for tokens transferred to the manager since sync().
    function settle() external payable returns (uint256 paid);

    /// @notice Debit a currency the caller is owed, sending it to `to`.
    function take(Currency currency, address to, uint256 amount) external;
}

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

library BalanceDeltaLib {
    /// @dev amount0 is packed in the high 128 bits, amount1 in the low 128 bits (v4 convention).
    function amount0(BalanceDelta d) internal pure returns (int128) {
        return int128(BalanceDelta.unwrap(d) >> 128);
    }

    function amount1(BalanceDelta d) internal pure returns (int128) {
        return int128(BalanceDelta.unwrap(d));
    }

    function toBalanceDelta(int128 a0, int128 a1) internal pure returns (BalanceDelta) {
        return BalanceDelta.wrap((int256(a0) << 128) | (int256(a1) & int256(uint256(type(uint128).max))));
    }
}
