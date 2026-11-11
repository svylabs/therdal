// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeERC20Helper} from "./interfaces/IERC20Minimal.sol";

/**
 * @title TherdalController
 * @notice Smart-account controller and pricing authority for the Therdal Protocol.
 *         - Initially operated by a single signer (`operator`), transferable to a DAO / Timelock via `transferOperator`.
 *         - Acts as the initial Protocol Developer recipient (`developerRecipient = address(this)`).
 *         - Topic creation is always free ($0 creation fee, $0 required deposit).
 *         - Maintains market-updated `pricePerVoteUsdMicros` (default $0.01 = 10,000 micro-USD) and
 *           the allowlist of accepted USD stablecoins (USDC initially), frozen per topic at creation.
 */
contract TherdalController {
    using SafeERC20Helper for address;

    bytes4 internal constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    struct StablecoinConfig {
        bool allowed;
        uint8 decimals;
    }

    /// @notice Current smart-account operator (initially 1 signer; transferable to a DAO Timelock)
    address public operator;

    /// @notice Recipient of protocol developer settlement shares (initially `address(this)`)
    address public developerRecipient;

    /// @notice Default USD stablecoin used when `paymentToken == address(0)` (initially USDC)
    address public defaultPaymentToken;

    /// @notice Estimated price per newly accepted valid vote in 6-decimal micro-USD (10,000 = $0.01)
    uint256 public pricePerVoteUsdMicros;

    /// @notice Allowlist of accepted USD stablecoins and their decimals (`6 <= decimals <= 18`)
    mapping(address => StablecoinConfig) public stablecoins;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event DeveloperRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event PricePerVoteUpdated(uint256 oldPriceUsdMicros, uint256 newPriceUsdMicros);
    event StablecoinConfigured(address indexed token, uint8 decimals, bool allowed);
    event DefaultPaymentTokenUpdated(address indexed token);
    event SmartAccountExecuted(address indexed target, uint256 value, bytes data);
    event TreasuryWithdrawn(address indexed token, address indexed to, uint256 amount);

    error UnauthorizedOperator(address caller);
    error ZeroAddress();
    error InvalidDecimals(uint8 decimals);
    error UnsupportedPaymentToken(address token);
    error CannotDisableDefaultToken(address token);
    error InvalidPricePerVote();
    error ExecutionFailed(bytes returnData);

    modifier onlyOperator() {
        _onlyOperator();
        _;
    }

    function _onlyOperator() internal view {
        if (msg.sender != operator) {
            revert UnauthorizedOperator(msg.sender);
        }
    }

    /**
     * @param _initialOperator Single signer initially controlling this smart account
     * @param _usdcToken Initial default USD stablecoin (USDC, typically 6 decimals)
     * @param _usdcDecimals Decimals of `_usdcToken` (`6 <= _usdcDecimals <= 18`)
     */
    constructor(
        address _initialOperator,
        address _usdcToken,
        uint8 _usdcDecimals
    ) {
        if (_initialOperator == address(0) || _usdcToken == address(0)) {
            revert ZeroAddress();
        }
        if (_usdcDecimals < 6 || _usdcDecimals > 18) {
            revert InvalidDecimals(_usdcDecimals);
        }

        operator = _initialOperator;
        developerRecipient = address(this);
        defaultPaymentToken = _usdcToken;

        // Default market estimate: $0.01 / valid vote (10,000 micro-USD); $0 creation fee
        pricePerVoteUsdMicros = 10_000;

        stablecoins[_usdcToken] = StablecoinConfig({allowed: true, decimals: _usdcDecimals});

        emit OperatorTransferred(address(0), _initialOperator);
        emit StablecoinConfigured(_usdcToken, _usdcDecimals, true);
        emit DefaultPaymentTokenUpdated(_usdcToken);
    }

    // -------------------------------------------------------------------------
    // Governance & Smart Account Controls
    // -------------------------------------------------------------------------

    /**
     * @notice Transfers control of this smart account to a new signer or DAO Timelock.
     */
    function transferOperator(address newOperator) external onlyOperator {
        if (newOperator == address(0)) revert ZeroAddress();
        address prev = operator;
        operator = newOperator;
        emit OperatorTransferred(prev, newOperator);
    }

    /**
     * @notice Updates the protocol developer fee recipient address.
     */
    function setDeveloperRecipient(address newRecipient) external onlyOperator {
        if (newRecipient == address(0)) revert ZeroAddress();
        address prev = developerRecipient;
        developerRecipient = newRecipient;
        emit DeveloperRecipientUpdated(prev, newRecipient);
    }

    /**
     * @notice Updates the per-vote settlement price for future topics (active topics retain their frozen price).
     */
    function setPricePerVoteUsdMicros(uint256 newPriceUsdMicros) external onlyOperator {
        if (newPriceUsdMicros == 0) revert InvalidPricePerVote();
        uint256 prev = pricePerVoteUsdMicros;
        pricePerVoteUsdMicros = newPriceUsdMicros;
        emit PricePerVoteUpdated(prev, newPriceUsdMicros);
    }

    /**
     * @notice Enables or disables an allowlisted USD stablecoin (e.g., USDC, USDT, PYUSD, DAI, USDS).
     */
    function configureStablecoin(
        address token,
        uint8 tokenDecimals,
        bool allowed
    ) external onlyOperator {
        if (token == address(0)) revert ZeroAddress();
        if (tokenDecimals < 6 || tokenDecimals > 18) {
            revert InvalidDecimals(tokenDecimals);
        }
        if (!allowed && token == defaultPaymentToken) {
            revert CannotDisableDefaultToken(token);
        }
        stablecoins[token] = StablecoinConfig({allowed: allowed, decimals: tokenDecimals});
        emit StablecoinConfigured(token, tokenDecimals, allowed);
    }

    /**
     * @notice Updates the default USD stablecoin used when `paymentToken == address(0)`.
     */
    function setDefaultPaymentToken(address token) external onlyOperator {
        if (!stablecoins[token].allowed) {
            revert UnsupportedPaymentToken(token);
        }
        defaultPaymentToken = token;
        emit DefaultPaymentTokenUpdated(token);
    }

    /**
     * @notice Withdraws ERC-20 tokens held by this controller smart account.
     */
    function withdrawToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOperator {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit TreasuryWithdrawn(token, to, amount);
    }

    /**
     * @notice Generic smart-account execution entry point for the operator or DAO Timelock.
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyOperator returns (bytes memory result) {
        if (target == address(0)) revert ZeroAddress();
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert ExecutionFailed(ret);
        emit SmartAccountExecuted(target, value, data);
        return ret;
    }

    /**
     * @notice ERC-1271 smart-account signature verification delegating to `operator` ECDSA recovery.
     */
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            if (v < 27) v += 27;
            if (ecrecover(hash, v, r, s) == operator) {
                return ERC1271_MAGIC_VALUE;
            }
        }
        return 0xffffffff;
    }

    // -------------------------------------------------------------------------
    // Pricing Quote View for Topic Creation ($0 Creation Fee)
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the resolved `paymentToken` and frozen token-denominated `pricePerVote`
     *         for a new topic (`$0` creation fee).
     */
    function quoteTopicTerms(address requestedToken)
        external
        view
        returns (address paymentToken, uint256 pricePerVote)
    {
        paymentToken = requestedToken == address(0) ? defaultPaymentToken : requestedToken;
        StablecoinConfig memory cfg = stablecoins[paymentToken];
        if (!cfg.allowed) {
            revert UnsupportedPaymentToken(paymentToken);
        }

        uint256 scale = 10 ** uint256(cfg.decimals - 6);
        pricePerVote = pricePerVoteUsdMicros * scale;
    }

    receive() external payable {}
}
