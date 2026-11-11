// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IERC20Minimal.sol";

/**
 * @title TherdalController
 * @notice Smart-account controller and pricing authority for the Therdal Protocol (v0.2).
 *         - Initially operated by one signer (`operator`), replaceable with a DAO / Timelock via `transferOperator`.
 *         - Acts as the initial Protocol Developer recipient (`developerRecipient = address(this)`), receiving
 *           the $10 nonrefundable creation fee and 25% of earned settlement fees.
 *         - Sets `pricePerVoteUsdMicros` (default $0.01 = 10,000 micro-USD, i.e., $10 per 1,000 votes),
 *           creation deposit/fee parameters, and the allowlist of accepted USD stablecoins (USDC initially).
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

    /// @notice Recipient of the $10 creation fee and 25% developer settlement share (initially `address(this)`)
    address public developerRecipient;

    /// @notice Default USD stablecoin (initially USDC)
    address public defaultPaymentToken;

    /// @notice Price per newly accepted valid vote in 6-decimal micro-USD (10,000 = $0.01 = $10 / 1,000 votes)
    uint256 public pricePerVoteUsdMicros;

    /// @notice Mandatory creation deposit in 6-decimal micro-USD (100,000,000 = $100.00)
    uint256 public creationDepositUsdMicros;

    /// @notice Nonrefundable creation fee in 6-decimal micro-USD (10,000,000 = $10.00; remainder goes to escrow)
    uint256 public creationFeeUsdMicros;

    /// @notice Allowlist of accepted USD stablecoins and their decimals
    mapping(address => StablecoinConfig) public stablecoins;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event DeveloperRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event PricePerVoteUpdated(uint256 oldPriceUsdMicros, uint256 newPriceUsdMicros);
    event CreationDepositTermsUpdated(uint256 depositUsdMicros, uint256 creationFeeUsdMicros);
    event StablecoinConfigured(address indexed token, uint8 decimals, bool allowed);
    event DefaultPaymentTokenUpdated(address indexed token);
    event SmartAccountExecuted(address indexed target, uint256 value, bytes data);
    event TreasuryWithdrawn(address indexed token, address indexed to, uint256 amount);

    error UnauthorizedOperator(address caller);
    error ZeroAddress();
    error InvalidDecimals(uint8 decimals);
    error UnsupportedPaymentToken(address token);
    error InvalidCreationFeeTerms(uint256 depositUsdMicros, uint256 feeUsdMicros);
    error InvalidPricePerVote();
    error ExecutionFailed(bytes returnData);

    modifier onlyOperator() {
        if (msg.sender != operator) {
            revert UnauthorizedOperator(msg.sender);
        }
        _;
    }

    /**
     * @param _initialOperator Single signer initially controlling this smart account
     * @param _usdcToken Initial default USD stablecoin (USDC, typically 6 decimals)
     * @param _usdcDecimals Decimals of `_usdcToken` (must be between 6 and 18)
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
        developerRecipient = address(this); // Controller smart account is the initial developer fee recipient
        defaultPaymentToken = _usdcToken;

        // Initial v0.2 pricing: $0.01/vote ($10 per 1,000 votes), $100 deposit ($10 dev fee + $90 escrow)
        pricePerVoteUsdMicros = 10_000;
        creationDepositUsdMicros = 100_000_000;
        creationFeeUsdMicros = 10_000_000;

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
     * @notice Updates the protocol developer fee recipient address if governance chooses to separate treasury.
     */
    function setDeveloperRecipient(address newRecipient) external onlyOperator {
        if (newRecipient == address(0)) revert ZeroAddress();
        address prev = developerRecipient;
        developerRecipient = newRecipient;
        emit DeveloperRecipientUpdated(prev, newRecipient);
    }

    /**
     * @notice Updates the settlement price per newly accepted valid vote (only applies to newly created resolutions).
     */
    function setPricePerVoteUsdMicros(uint256 newPriceUsdMicros) external onlyOperator {
        if (newPriceUsdMicros == 0) revert InvalidPricePerVote();
        uint256 prev = pricePerVoteUsdMicros;
        pricePerVoteUsdMicros = newPriceUsdMicros;
        emit PricePerVoteUpdated(prev, newPriceUsdMicros);
    }

    /**
     * @notice Updates the creation deposit and nonrefundable creation fee (in 6-decimal micro-USD).
     */
    function setCreationDepositTerms(uint256 depositUsdMicros, uint256 feeUsdMicros) external onlyOperator {
        if (feeUsdMicros > depositUsdMicros || depositUsdMicros == 0) {
            revert InvalidCreationFeeTerms(depositUsdMicros, feeUsdMicros);
        }
        creationDepositUsdMicros = depositUsdMicros;
        creationFeeUsdMicros = feeUsdMicros;
        emit CreationDepositTermsUpdated(depositUsdMicros, feeUsdMicros);
    }

    /**
     * @notice Enables or disables a USD stablecoin (e.g., USDT, PYUSD, DAI, USDS) for future resolutions.
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
        stablecoins[token] = StablecoinConfig({allowed: allowed, decimals: tokenDecimals});
        emit StablecoinConfigured(token, tokenDecimals, allowed);
    }

    /**
     * @notice Updates the default USD stablecoin used when `config.paymentToken == address(0)`.
     */
    function setDefaultPaymentToken(address token) external onlyOperator {
        if (!stablecoins[token].allowed) {
            revert UnsupportedPaymentToken(token);
        }
        defaultPaymentToken = token;
        emit DefaultPaymentTokenUpdated(token);
    }

    /**
     * @notice Withdraws earned ERC-20 creation/settlement fees from this controller smart account.
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
    // Pricing Quote View for Therdal.createResolution
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the frozen token-denominated creation deposit, creation fee, initial escrow,
     *         price per accepted vote, and developer recipient for a new resolution.
     */
    function quoteResolutionTerms(address requestedToken)
        external
        view
        returns (
            address paymentToken,
            uint256 creationDeposit,
            uint256 creationFee,
            uint256 initialEscrow,
            uint256 pricePerVote,
            address devRecipient
        )
    {
        paymentToken = requestedToken == address(0) ? defaultPaymentToken : requestedToken;
        StablecoinConfig memory cfg = stablecoins[paymentToken];
        if (!cfg.allowed) {
            revert UnsupportedPaymentToken(paymentToken);
        }

        uint256 scale = 10 ** uint256(cfg.decimals - 6);
        creationDeposit = creationDepositUsdMicros * scale;
        creationFee = creationFeeUsdMicros * scale;
        initialEscrow = creationDeposit - creationFee;
        pricePerVote = pricePerVoteUsdMicros * scale;
        devRecipient = developerRecipient;
    }

    receive() external payable {}
}
