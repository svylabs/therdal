// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/ITherdal.sol";
import "./interfaces/IERC20Minimal.sol";

/**
 * @title SponsorEscrow
 * @notice Manages USD stablecoin (USDC + allowlisted stablecoins) resolution deposits,
 *         100% sponsorship escrow contributions, 25% / 25% / 50% verified settlement fee splits,
 *         pull-fallback token credits, and pro-rata pull refunds (`floor(U * c_i / C)`).
 */
abstract contract SponsorEscrow {
    using SafeERC20Helper for address;

    /// @notice Total refundable escrow contributed (`C`) per resolution (excludes the $10 creation fee)
    mapping(uint256 => uint256) public totalEscrowContributed;

    /// @notice Current unspent escrow balance per resolution
    mapping(uint256 => uint256) public remainingEscrow;

    /// @notice Total settlement fees earned across all settled batches for a resolution
    mapping(uint256 => uint256) public totalEarnedFees;

    /// @notice Frozen unused escrow (`U`) snapshot when settlement closes or finalizes
    mapping(uint256 => uint256) public frozenUnusedEscrow;

    /// @notice Whether pro-rata pull refunds have been enabled for a resolution
    mapping(uint256 => bool) public refundsEnabled;

    /// @notice Refundable escrow contribution (`c_i`) per contributor: `resolutionId => contributor => amount`
    mapping(uint256 => mapping(address => uint256)) public contributorEscrow;

    /// @notice Tracks whether a contributor has claimed their pro-rata refund
    mapping(uint256 => mapping(address => bool)) public refundClaimed;

    /// @notice Pull-fallback token rewards if a direct ERC-20 transfer fails (e.g., blacklisted recipient):
    ///         `token => recipient => amount`
    mapping(address => mapping(address => uint256)) public claimableTokenRewards;

    event TokenRewardFallbackCredited(address indexed token, address indexed recipient, uint256 amount);
    event ClaimableTokenRewardWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event RefundClaimed(
        uint256 indexed resolutionId,
        address indexed contributor,
        address indexed paymentToken,
        uint256 refundAmount
    );

    error RefundsNotEnabled(uint256 resolutionId);
    error RefundAlreadyClaimed(uint256 resolutionId, address contributor);
    error NoEscrowContribution(uint256 resolutionId, address contributor);
    error NoClaimableTokenRewards(address token, address account);

    /**
     * @notice Collects the mandatory creation deposit (+ optional `extraSponsorAmount`) from `creator`:
     *         - Sends `creationFee` ($10 equivalent) directly to `developerRecipient` (nonrefundable).
     *         - Deposits `initialEscrow + extraSponsorAmount` ($90 + extra) into resolution escrow (`c_creator`).
     */
    function _collectCreationDepositAndEscrow(
        uint256 resolutionId,
        address creator,
        address paymentToken,
        address developerRecipient,
        uint256 creationFee,
        uint256 initialEscrow,
        uint256 extraSponsorAmount
    ) internal returns (uint256 totalCreatorEscrow) {
        totalCreatorEscrow = initialEscrow + extraSponsorAmount;
        uint256 totalPull = creationFee + totalCreatorEscrow;

        paymentToken.safeTransferFrom(creator, address(this), totalPull);

        if (creationFee > 0) {
            _safeSendOrCreditToken(paymentToken, developerRecipient, creationFee);
        }

        if (totalCreatorEscrow > 0) {
            totalEscrowContributed[resolutionId] += totalCreatorEscrow;
            remainingEscrow[resolutionId] += totalCreatorEscrow;
            contributorEscrow[resolutionId][creator] += totalCreatorEscrow;
        }
    }

    /**
     * @notice Collects a 100% escrow sponsorship deposit (no creation fee).
     */
    function _collectSponsorship(
        uint256 resolutionId,
        address sponsorAddr,
        address paymentToken,
        uint256 amount
    ) internal {
        paymentToken.safeTransferFrom(sponsorAddr, address(this), amount);

        totalEscrowContributed[resolutionId] += amount;
        remainingEscrow[resolutionId] += amount;
        contributorEscrow[resolutionId][sponsorAddr] += amount;

        emit ITherdal.ResolutionSponsored(
            resolutionId,
            sponsorAddr,
            paymentToken,
            amount,
            totalEscrowContributed[resolutionId],
            remainingEscrow[resolutionId]
        );
    }

    /**
     * @notice Charges `totalFee = newlyAcceptedVoteCount * pricePerVote` against `remainingEscrow`
     *         (reverting if insufficient) and disburses the exact 25% / 25% / 50% split:
     *         - 25% to `developerRecipient` (`TherdalController` smart account)
     *         - 25% to `submitter` (`batch.submitter`)
     *         - 50% to `prover` (`msg.sender`)
     */
    function _disburseSettlementFeeSplit(
        uint256 resolutionId,
        address paymentToken,
        address developerRecipient,
        address submitter,
        address prover,
        uint256 newlyAcceptedVoteCount,
        uint256 pricePerVote
    )
        internal
        returns (
            uint256 developerShare,
            uint256 submitterShare,
            uint256 proverShare
        )
    {
        if (newlyAcceptedVoteCount == 0 || pricePerVote == 0) {
            return (0, 0, 0);
        }

        uint256 totalFee = newlyAcceptedVoteCount * pricePerVote;
        uint256 available = remainingEscrow[resolutionId];
        if (totalFee > available) {
            revert ITherdal.InsufficientEscrowBalance(totalFee, available);
        }

        remainingEscrow[resolutionId] = available - totalFee;
        totalEarnedFees[resolutionId] += totalFee;

        developerShare = totalFee / 4; // 25%
        submitterShare = totalFee / 4; // 25%
        proverShare = totalFee - developerShare - submitterShare; // 50% (plus any remainder wei)

        if (developerShare > 0) {
            _safeSendOrCreditToken(paymentToken, developerRecipient, developerShare);
        }
        if (submitterShare > 0) {
            _safeSendOrCreditToken(paymentToken, submitter, submitterShare);
        }
        if (proverShare > 0) {
            _safeSendOrCreditToken(paymentToken, prover, proverShare);
        }
    }

    /**
     * @notice Freezes unused escrow (`U`) when settlement closes or finalizes, enabling pro-rata pull refunds.
     */
    function _freezeEscrowForRefunds(uint256 resolutionId) internal returns (uint256 unusedEscrow) {
        if (!refundsEnabled[resolutionId]) {
            refundsEnabled[resolutionId] = true;
            unusedEscrow = remainingEscrow[resolutionId];
            frozenUnusedEscrow[resolutionId] = unusedEscrow;
        } else {
            unusedEscrow = frozenUnusedEscrow[resolutionId];
        }
    }

    /**
     * @notice Internal helper executing `refund_i = floor(U * c_i / C)` for `contributor`.
     */
    function _processRefundClaim(
        uint256 resolutionId,
        address paymentToken,
        address contributor
    ) internal returns (uint256 refundAmount) {
        if (!refundsEnabled[resolutionId]) {
            revert RefundsNotEnabled(resolutionId);
        }
        if (refundClaimed[resolutionId][contributor]) {
            revert RefundAlreadyClaimed(resolutionId, contributor);
        }

        uint256 c_i = contributorEscrow[resolutionId][contributor];
        if (c_i == 0) {
            revert NoEscrowContribution(resolutionId, contributor);
        }

        refundClaimed[resolutionId][contributor] = true;

        uint256 C = totalEscrowContributed[resolutionId];
        uint256 U = frozenUnusedEscrow[resolutionId];
        if (U == 0 || C == 0) {
            emit RefundClaimed(resolutionId, contributor, paymentToken, 0);
            return 0;
        }

        refundAmount = (U * c_i) / C;
        if (refundAmount > remainingEscrow[resolutionId]) {
            refundAmount = remainingEscrow[resolutionId];
        }
        remainingEscrow[resolutionId] -= refundAmount;

        if (refundAmount > 0) {
            paymentToken.safeTransfer(contributor, refundAmount);
        }

        emit RefundClaimed(resolutionId, contributor, paymentToken, refundAmount);
    }

    /**
     * @notice Withdraws fallback-credited token rewards if a push transfer previously failed.
     */
    function withdrawClaimableTokenRewards(address token) external returns (uint256 amount) {
        amount = claimableTokenRewards[token][msg.sender];
        if (amount == 0) {
            revert NoClaimableTokenRewards(token, msg.sender);
        }
        claimableTokenRewards[token][msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit ClaimableTokenRewardWithdrawn(token, msg.sender, amount);
    }

    function _safeSendOrCreditToken(
        address token,
        address recipient,
        uint256 amount
    ) private {
        if (!token.trySafeTransfer(recipient, amount)) {
            claimableTokenRewards[token][recipient] += amount;
            emit TokenRewardFallbackCredited(token, recipient, amount);
        }
    }
}
