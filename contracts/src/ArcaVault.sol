// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @notice Minimal swap abstraction. Real deployment wraps the RHC DEX (Uniswap v4) in an adapter.
interface IArcaRouter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut);
}

/// @title ArcaVault
/// @notice A managed, fully-backed basket of tokenized stocks. One share token = the whole index.
///         Mint/redeem in-kind. An autonomous agent rebalances weights within on-chain guardrails.
///
/// INVARIANTS (must ALWAYS hold — see test/invariant):
///   INV1  backing:  forall i, assets[i].balanceOf(this) >= totalSupply * units[i] / 1e18
///   INV2  no-drain: tokens leave only via redeem() or router swaps in rebalance() — no arbitrary transfer
///   INV3  redeem:   redeem() is never blockable by any admin action
///   INV4  closed:   the asset set is fixed at construction; rebalance cannot introduce a new asset
///   INV5  guardian: guardian may only pause mint, lower cap, set feeRecipient/rebalancer/guardian.
///                   it can NEVER move balances, change units, or pause redeem.
contract ArcaVault is ERC20 {
    using SafeERC20 for IERC20;

    struct Swap {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
    }

    struct Config {
        uint256 supplyCeiling; // hard immutable cap ceiling
        uint256 supplyCap; // active cap (guardian may only lower ≤ ceiling)
        uint16 mintFeeBps; // immutable, ≤ MAX_FEE_BPS
        uint16 maxSlippageBps; // immutable rebalance guardrail
        uint16 maxTurnoverBps; // immutable rebalance guardrail
        uint64 rebalanceCooldown; // immutable, seconds between rebalances
        uint64 maxOracleAge; // immutable, max seconds since a feed's last update before it's stale
        address sequencerUptimeFeed; // immutable, L2 sequencer feed (address(0) = skip the check)
        address guardian;
        address rebalancer;
        address feeRecipient;
        address router;
    }

    uint16 public constant MAX_FEE_BPS = 50; // 0.50% hard cap

    // --- immutable config ---
    address[] private _assets;
    uint256[] private _units; // per 1e18 shares; mutable ONLY via rebalance()
    mapping(address => bool) public isAsset;
    mapping(address => AggregatorV3Interface) public oracleOf;

    uint256 public immutable SUPPLY_CEILING;
    uint16 public immutable mintFeeBps;
    uint16 public immutable maxSlippageBps;
    uint16 public immutable maxTurnoverBps;
    uint64 public immutable rebalanceCooldown;
    uint64 public immutable maxOracleAge;
    address public immutable sequencerUptimeFeed;
    IArcaRouter public immutable router;

    /// @dev after the L2 sequencer restarts, wait this long before trusting prices again.
    uint256 private constant SEQUENCER_GRACE = 3600;

    // --- guardian-mutable (never touches user funds) ---
    uint256 public supplyCap;
    address public guardian;
    address public rebalancer;
    address public feeRecipient;
    bool public mintPaused;
    uint64 public lastRebalance;

    event Mint(address indexed from, address indexed to, uint256 shares, uint256 fee);
    event Redeem(address indexed from, address indexed to, uint256 shares);
    event Rebalanced(address indexed by, bytes32 rationale, uint256 navBefore, uint256 navAfter);
    event MintPausedSet(bool paused);
    event SupplyCapSet(uint256 cap);
    event FeeRecipientSet(address recipient);
    event RebalancerSet(address rebalancer);
    event GuardianSet(address guardian);

    error NotGuardian();
    error NotRebalancer();
    error MintIsPaused();
    error CapExceeded();
    error Cooldown();
    error NotWhitelisted();
    error SlippageTooHigh();
    error TurnoverTooHigh();
    error BadConfig();
    error ZeroShares();
    error BadPrice();
    error StalePrice();
    error SequencerDown();

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    modifier onlyRebalancer() {
        if (msg.sender != rebalancer) revert NotRebalancer();
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address[] memory assets_,
        uint256[] memory units_,
        address[] memory oracles_,
        Config memory cfg
    ) ERC20(name_, symbol_) {
        uint256 n = assets_.length;
        if (n == 0 || units_.length != n || oracles_.length != n) revert BadConfig();
        if (cfg.mintFeeBps > MAX_FEE_BPS) revert BadConfig();
        if (cfg.supplyCap > cfg.supplyCeiling) revert BadConfig();
        if (cfg.maxSlippageBps > 10_000 || cfg.maxTurnoverBps > 10_000) revert BadConfig();
        if (cfg.maxOracleAge == 0) revert BadConfig();
        if (cfg.guardian == address(0) || cfg.feeRecipient == address(0) || cfg.router == address(0)) {
            revert BadConfig();
        }

        for (uint256 i; i < n; ++i) {
            if (assets_[i] == address(0) || isAsset[assets_[i]] || units_[i] == 0 || oracles_[i] == address(0)) {
                revert BadConfig();
            }
            _assets.push(assets_[i]);
            _units.push(units_[i]);
            isAsset[assets_[i]] = true;
            oracleOf[assets_[i]] = AggregatorV3Interface(oracles_[i]);
        }

        SUPPLY_CEILING = cfg.supplyCeiling;
        supplyCap = cfg.supplyCap;
        mintFeeBps = cfg.mintFeeBps;
        maxSlippageBps = cfg.maxSlippageBps;
        maxTurnoverBps = cfg.maxTurnoverBps;
        rebalanceCooldown = cfg.rebalanceCooldown;
        maxOracleAge = cfg.maxOracleAge;
        sequencerUptimeFeed = cfg.sequencerUptimeFeed;
        router = IArcaRouter(cfg.router);
        guardian = cfg.guardian;
        rebalancer = cfg.rebalancer;
        feeRecipient = cfg.feeRecipient;
    }

    // --- mint / redeem ---

    /// @notice Deposit the exact in-kind basket and receive `shares` (minus fee). ceil() rounding keeps INV1.
    function mint(uint256 shares, address to) external {
        if (shares == 0) revert ZeroShares();
        if (mintPaused) revert MintIsPaused();
        if (totalSupply() + shares > supplyCap) revert CapExceeded();

        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 amt = _mulDivUp(shares, _units[i], 1e18);
            IERC20(_assets[i]).safeTransferFrom(msg.sender, address(this), amt);
        }

        uint256 fee = (shares * mintFeeBps) / 10_000;
        if (fee > 0) _mint(feeRecipient, fee);
        _mint(to, shares - fee);
        emit Mint(msg.sender, to, shares, fee);
    }

    /// @notice Burn `shares`, receive the in-kind basket. floor() rounding keeps INV1. NEVER pausable (INV3).
    function redeem(uint256 shares, address to) external {
        if (shares == 0) revert ZeroShares();
        _burn(msg.sender, shares); // reverts if caller lacks balance

        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            uint256 amt = (shares * _units[i]) / 1e18; // floor
            if (amt > 0) IERC20(_assets[i]).safeTransfer(to, amt);
        }
        emit Redeem(msg.sender, to, shares);
    }

    // --- rebalance (agent only, guardrailed) ---

    /// @notice Agent rotates weights via whitelisted swaps, bounded by slippage/turnover/cooldown.
    ///         Units are recomputed from ACTUAL balances afterward, so the vault stays fully backed (INV1).
    function rebalance(Swap[] calldata swaps, bytes32 rationale) external onlyRebalancer {
        // Rebalance cadence is intentionally time-based; small timestamp drift cannot drain funds.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < lastRebalance + rebalanceCooldown) revert Cooldown();

        uint256 navBefore = _nav();
        uint256 turnoverValue;

        for (uint256 i; i < swaps.length; ++i) {
            Swap calldata s = swaps[i];
            if (!isAsset[s.tokenIn] || !isAsset[s.tokenOut]) revert NotWhitelisted(); // INV4
            turnoverValue += _value(s.tokenIn, s.amountIn);
            IERC20(s.tokenIn).forceApprove(address(router), s.amountIn);
            router.swap(s.tokenIn, s.tokenOut, s.amountIn, s.minOut);
            IERC20(s.tokenIn).forceApprove(address(router), 0);
        }

        uint256 navAfter = _nav();
        // value must not drop beyond slippage tolerance
        if (navAfter * 10_000 < navBefore * (10_000 - maxSlippageBps)) revert SlippageTooHigh();
        // bounded turnover per rebalance
        if (navBefore > 0 && turnoverValue * 10_000 > navBefore * maxTurnoverBps) revert TurnoverTooHigh();

        // recompute units from real balances -> fully backed by construction (INV1)
        uint256 supply = totalSupply();
        if (supply > 0) {
            uint256 n = _assets.length;
            for (uint256 i; i < n; ++i) {
                _units[i] = (IERC20(_assets[i]).balanceOf(address(this)) * 1e18) / supply;
            }
        }
        lastRebalance = uint64(block.timestamp);
        emit Rebalanced(msg.sender, rationale, navBefore, navAfter);
    }

    // --- guardian (bounded — never touches funds, INV5) ---

    function setMintPaused(bool p) external onlyGuardian {
        mintPaused = p;
        emit MintPausedSet(p);
    }

    function setSupplyCap(uint256 c) external onlyGuardian {
        if (c > supplyCap || c > SUPPLY_CEILING) revert BadConfig();
        supplyCap = c;
        emit SupplyCapSet(c);
    }

    function setFeeRecipient(address r) external onlyGuardian {
        if (r == address(0)) revert BadConfig();
        feeRecipient = r;
        emit FeeRecipientSet(r);
    }

    function setRebalancer(address r) external onlyGuardian {
        rebalancer = r; // may be address(0) to freeze management; redeem still works
        emit RebalancerSet(r);
    }

    function setGuardian(address g) external onlyGuardian {
        if (g == address(0)) revert BadConfig();
        guardian = g;
        emit GuardianSet(g);
    }

    // --- views ---

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function units() external view returns (uint256[] memory) {
        return _units;
    }

    function nav() external view returns (uint256) {
        return _nav();
    }

    function isFullyBacked() external view returns (bool) {
        uint256 supply = totalSupply();
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            if (IERC20(_assets[i]).balanceOf(address(this)) < (supply * _units[i]) / 1e18) return false;
        }
        return true;
    }

    // --- internal ---

    function _nav() internal view returns (uint256 v) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            v += _value(_assets[i], IERC20(_assets[i]).balanceOf(address(this)));
        }
    }

    function _value(address asset, uint256 amount) internal view returns (uint256) {
        // L2 liveness: right after the sequencer restarts, feeds can be stale/manipulable.
        address seq = sequencerUptimeFeed;
        if (seq != address(0)) {
            (, int256 up, uint256 since,,) = AggregatorV3Interface(seq).latestRoundData();
            // forge-lint: disable-next-line(block-timestamp)
            if (up != 0 || block.timestamp - since < SEQUENCER_GRACE) revert SequencerDown();
        }
        AggregatorV3Interface o = oracleOf[asset];
        (, int256 answer,, uint256 updatedAt,) = o.latestRoundData();
        if (answer <= 0 || updatedAt == 0) revert BadPrice();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt > maxOracleAge) revert StalePrice();
        // forge-lint: disable-next-line(unsafe-typecast)
        return (amount * uint256(answer)) / (10 ** o.decimals());
    }

    function _mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b + d - 1) / d;
    }
}
