// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "../../contracts/interfaces/ITopicRegistry.sol";
import {SafeERC20Helper} from "../../contracts/interfaces/IERC20Minimal.sol";
import {TherdalController} from "../../contracts/TherdalController.sol";
import {Therdal} from "../../contracts/Therdal.sol";
import {Vm, MockStablecoin, MockReentrantERC20} from "../helpers/TestHelpers.sol";

/**
 * @title TopicAdversarialTest
 * @notice Adversarial and security-boundary tests for Stage 1 Topic Creation & Controller access control.
 */
contract TopicAdversarialTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockStablecoin internal usdc;
    TherdalController internal controller;
    Therdal internal therdal;

    address internal operator = address(0xD00D);
    address internal attacker = address(0xBAD);
    address internal daoTimelock = address(0xDA00);

    uint64 internal constant INITIAL_TIMESTAMP = 1_760_000_000;

    error AssertionFailed(string reason);

    function setUp() public {
        VM.roll(5000);
        VM.warp(INITIAL_TIMESTAMP);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        controller = new TherdalController(operator, address(usdc), 6);
        therdal = new Therdal(address(controller));
    }

    function test_RevertOnReentrancyDuringInitialSponsorship() public {
        MockReentrantERC20 maliciousToken = new MockReentrantERC20(address(therdal));
        maliciousToken.setAttack(true);

        VM.prank(operator);
        controller.configureStablecoin(address(maliciousToken), 6, true);

        string[] memory opts = _twoOptions();

        // Malicious token tries to re-enter `sponsorTopic(1, amount)` inside `transferFrom`;
        // `nonReentrant` blocks the inner call, causing `safeTransferFrom` to revert cleanly.
        VM.expectRevert(
            abi.encodeWithSelector(
                SafeERC20Helper.ERC20TransferFromFailed.selector,
                address(maliciousToken),
                attacker,
                address(therdal),
                1_000_000
            )
        );
        VM.prank(attacker);
        therdal.createTopicWithConfig(
            ITopicRegistry.CreateTopicParams({
                subject: "Reentrant token attack?",
                options: opts,
                votingEndsAt: INITIAL_TIMESTAMP + 1 days,
                paymentToken: address(maliciousToken),
                initialSponsorship: 1_000_000
            })
        );

        if (therdal.topicCount() != 0) {
            revert AssertionFailed("State must roll back completely on reentrancy revert");
        }
    }

    function test_RevertOnUnallowlistedPaymentToken() public {
        MockStablecoin fakeToken = new MockStablecoin("Fake USD", "FUSD", 6);
        string[] memory opts = _twoOptions();

        VM.expectRevert(
            abi.encodeWithSelector(
                TherdalController.UnsupportedPaymentToken.selector,
                address(fakeToken)
            )
        );
        VM.prank(attacker);
        therdal.createTopicWithConfig(
            ITopicRegistry.CreateTopicParams({
                subject: "Unallowlisted token test?",
                options: opts,
                votingEndsAt: INITIAL_TIMESTAMP + 1 days,
                paymentToken: address(fakeToken),
                initialSponsorship: 0
            })
        );
    }

    function test_RevertSponsoringClosedOrMissingTopicOrZeroAmount() public {
        string[] memory opts = _twoOptions();
        uint64 endsAt = INITIAL_TIMESTAMP + 100;
        uint256 topicId = therdal.createTopic("Short window topic?", opts, endsAt, 0);

        // Zero sponsorship reverts
        VM.expectRevert(ITopicRegistry.ZeroSponsorshipAmount.selector);
        therdal.sponsorTopic(topicId, 0);

        // Nonexistent topic reverts
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.TopicNotFound.selector, 42));
        therdal.sponsorTopic(42, 1_000_000);

        // Sponsoring after votingEndsAt reverts
        VM.warp(endsAt + 1);
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidTopicPhase.selector,
                ITopicRegistry.TopicPhase.Closed,
                ITopicRegistry.TopicPhase.Open
            )
        );
        therdal.sponsorTopic(topicId, 1_000_000);
    }

    function test_RevertInvalidPaginationAndMissingTopicViews() public {
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.TopicNotFound.selector, 1));
        therdal.getTopic(1);

        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.TopicNotFound.selector, 1));
        therdal.getTopicOptions(1);

        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidPaginationLimit.selector,
                0,
                therdal.MAX_PAGE_LIMIT()
            )
        );
        therdal.getTopics(0, 0);

        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidPaginationLimit.selector,
                51,
                therdal.MAX_PAGE_LIMIT()
            )
        );
        therdal.getTopics(0, 51);
    }

    function test_ControllerAndRegistryAccessControlInvariants() public {
        // Non-operator cannot update price, allowlist, or transfer operator
        VM.expectRevert(
            abi.encodeWithSelector(TherdalController.UnauthorizedOperator.selector, attacker)
        );
        VM.prank(attacker);
        controller.setPricePerVoteUsdMicros(5_000);

        VM.expectRevert(
            abi.encodeWithSelector(TherdalController.UnauthorizedOperator.selector, attacker)
        );
        VM.prank(attacker);
        controller.transferOperator(attacker);

        // Operator cannot disable the active default payment token without switching default first
        VM.expectRevert(
            abi.encodeWithSelector(
                TherdalController.CannotDisableDefaultToken.selector,
                address(usdc)
            )
        );
        VM.prank(operator);
        controller.configureStablecoin(address(usdc), 6, false);

        // Non-controller cannot replace controller on Therdal
        VM.expectRevert(abi.encodeWithSelector(Therdal.UnauthorizedController.selector, attacker));
        VM.prank(attacker);
        therdal.replaceController(attacker);

        // Controller can migrate itself via smart-account `execute` and hand off operator to DAO
        TherdalController nextController = new TherdalController(daoTimelock, address(usdc), 6);
        VM.prank(operator);
        controller.execute(
            address(therdal),
            0,
            abi.encodeCall(Therdal.replaceController, (address(nextController)))
        );
        if (address(therdal.controller()) != address(nextController)) {
            revert AssertionFailed("Controller migration via execute failed");
        }
    }

    function _twoOptions() internal pure returns (string[] memory opts) {
        opts = new string[](2);
        opts[0] = "Approve";
        opts[1] = "Reject";
    }
}
