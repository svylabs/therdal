// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "./interfaces/ITopicRegistry.sol";
import {SafeERC20Helper} from "./interfaces/IERC20Minimal.sol";

/**
 * @title SponsorEscrow
 * @notice Manages optional USD stablecoin (USDC + allowlisted tokens) sponsorship pools per topic.
 *         - Topic creation requires $0 deposit and $0 fee.
 *         - 100% of optional initial or community sponsorships enter `remainingEscrow[topicId]`.
 */
abstract contract SponsorEscrow {
    using SafeERC20Helper for address;

    /// @notice Total sponsorship contributed per topic (`topicId => totalUnits`)
    mapping(uint256 => uint256) public totalSponsored;

    /// @notice Current unspent sponsorship balance per topic (`topicId => remainingUnits`)
    mapping(uint256 => uint256) public remainingEscrow;

    /// @notice Individual sponsor contribution basis (`topicId => sponsor => contributedUnits`)
    mapping(uint256 => mapping(address => uint256)) public sponsorContributions;

    /**
     * @notice Credits `amount` (100%, $0 fee) to `topicId`'s sponsorship pool and pulls `paymentToken`
     *         from `sponsorAddr` following Checks-Effects-Interactions.
     */
    function _collectSponsorship(
        uint256 topicId,
        address sponsorAddr,
        address paymentToken,
        uint256 amount
    ) internal {
        uint256 updatedTotal = totalSponsored[topicId] + amount;
        uint256 updatedRemaining = remainingEscrow[topicId] + amount;

        totalSponsored[topicId] = updatedTotal;
        remainingEscrow[topicId] = updatedRemaining;
        sponsorContributions[topicId][sponsorAddr] += amount;

        paymentToken.safeTransferFrom(sponsorAddr, address(this), amount);

        emit ITopicRegistry.TopicSponsored(
            topicId,
            sponsorAddr,
            paymentToken,
            amount,
            updatedTotal,
            updatedRemaining
        );
    }
}
