// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice TESTNET-ONLY settable Chainlink-style feed (matches AggregatorV3Interface used by ArcaVault).
///         RHC testnet has no real stock feeds, so we stand one up with a settable price. Never mainnet.
contract MockStockOracle {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    string public description;

    constructor(int256 answer_, uint8 decimals_, string memory description_) {
        answer = answer_;
        decimals = decimals_;
        description = description_;
        updatedAt = block.timestamp;
    }

    /// @notice Move the price to simulate market moves (drives rebalance demos).
    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
