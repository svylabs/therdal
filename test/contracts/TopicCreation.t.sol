// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "../../contracts/interfaces/ITopicRegistry.sol";
import {TopicValidation} from "../../contracts/libraries/TopicValidation.sol";
import {TherdalController} from "../../contracts/TherdalController.sol";
import {Therdal} from "../../contracts/Therdal.sol";
import {DeployTherdal} from "../../script/DeployTherdal.s.sol";
import {Vm, MockStablecoin, MockNonReturningERC20} from "../helpers/TestHelpers.sol";

/**
 * @title TopicCreationTest
 * @notice Comprehensive Stage 1 unit, boundary, fuzz, and cross-layer vector tests for Topic Creation.
 */
contract TopicCreationTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockStablecoin internal usdc;
    MockStablecoin internal dai;
    MockNonReturningERC20 internal usdt;
    TherdalController internal controller;
    Therdal internal therdal;

    address internal operator = address(0xD00D);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint64 internal constant INITIAL_TIMESTAMP = 1_760_000_000;
    uint256 internal constant INITIAL_BLOCK = 21_500_000;

    error AssertionFailed(string reason);

    function setUp() public {
        VM.roll(INITIAL_BLOCK);
        VM.warp(INITIAL_TIMESTAMP);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        dai = new MockStablecoin("Dai Stablecoin", "DAI", 18);
        usdt = new MockNonReturningERC20();

        controller = new TherdalController(operator, address(usdc), 6);
        therdal = new Therdal(address(controller));
    }

    // -------------------------------------------------------------------------
    // 1. Happy Path: Free Topic Creation ($0 Deposit, $0 Fee) & Multi-Options
    // -------------------------------------------------------------------------

    function test_CreateTopicFreeWithCustomOptions() public {
        string memory subject = "Should Ethereum raise the Pectra blob target from 6 to 12?";
        string[] memory options = new string[](3);
        options[0] = "Increase to 12 Blobs";
        options[1] = "Increase to 9 Blobs";
        options[2] = "Keep at 6 Blobs";
        uint64 votingEndsAt = INITIAL_TIMESTAMP + 7 days;

        // Alice has 0 USDC balance and 0 allowance — topic creation is completely free
        VM.prank(alice);
        uint256 topicId = therdal.createTopic(subject, options, votingEndsAt, 0);

        _assertTrue(topicId == 1, "topicId == 1");
        _assertTrue(therdal.topicCount() == 1, "topicCount == 1");

        ITopicRegistry.TopicView memory viewData = therdal.getTopic(topicId);
        _assertTrue(viewData.id == 1, "view.id");
        _assertTrue(viewData.creator == alice, "view.creator");
        _assertTrue(
            keccak256(bytes(viewData.subject)) == keccak256(bytes(subject)),
            "view.subject"
        );
        _assertTrue(viewData.options.length == 3, "view.options.length");
        _assertTrue(
            keccak256(bytes(viewData.options[0])) == keccak256(bytes("Increase to 12 Blobs")),
            "option 0"
        );
        _assertTrue(
            keccak256(bytes(viewData.options[1])) == keccak256(bytes("Increase to 9 Blobs")),
            "option 1"
        );
        _assertTrue(
            keccak256(bytes(viewData.options[2])) == keccak256(bytes("Keep at 6 Blobs")),
            "option 2"
        );
        _assertTrue(viewData.createdAt == INITIAL_TIMESTAMP, "view.createdAt");
        _assertTrue(viewData.votingEndsAt == votingEndsAt, "view.votingEndsAt");
        _assertTrue(viewData.snapshotBlock == INITIAL_BLOCK - 1, "view.snapshotBlock");
        _assertTrue(
            viewData.snapshotBlockHash == blockhash(INITIAL_BLOCK - 1),
            "view.snapshotBlockHash"
        );
        _assertTrue(viewData.paymentToken == address(usdc), "view.paymentToken");
        _assertTrue(viewData.pricePerVote == 10_000, "view.pricePerVote ($0.01 USDC)");
        _assertTrue(viewData.totalSponsored == 0, "view.totalSponsored == 0");
        _assertTrue(viewData.remainingEscrow == 0, "view.remainingEscrow == 0");
        _assertTrue(viewData.phase == ITopicRegistry.TopicPhase.Open, "view.phase == Open");

        string[] memory fetchedOptions = therdal.getTopicOptions(topicId);
        _assertTrue(fetchedOptions.length == 3, "getTopicOptions length");
        _assertTrue(usdc.balanceOf(address(controller)) == 0, "$0 protocol creation fee");
    }

    // -------------------------------------------------------------------------
    // 2. Optional Initial USDC Sponsorship & Follow-up Community Sponsorship
    // -------------------------------------------------------------------------

    function test_CreateTopicWithInitialSponsorshipAndTopUp() public {
        string[] memory options = new string[](4);
        options[0] = "60M Gas Limit";
        options[1] = "45M Gas Limit";
        options[2] = "36M Gas Limit";
        options[3] = "No Change (30M)";
        uint64 votingEndsAt = INITIAL_TIMESTAMP + 14 days;

        uint256 initialSponsorship = 100_000_000; // $100.00 USDC
        usdc.mint(alice, initialSponsorship);
        VM.prank(alice);
        usdc.approve(address(therdal), initialSponsorship);

        VM.prank(alice);
        uint256 topicId = therdal.createTopic(
            "What L1 execution block gas limit should validators target?",
            options,
            votingEndsAt,
            initialSponsorship
        );

        // 100% enters SponsorEscrow; $0 taken as creation fee
        _assertTrue(usdc.balanceOf(address(therdal)) == initialSponsorship, "100% in escrow");
        _assertTrue(usdc.balanceOf(address(controller)) == 0, "$0 creation fee");
        _assertTrue(therdal.totalSponsored(topicId) == initialSponsorship, "totalSponsored");
        _assertTrue(therdal.remainingEscrow(topicId) == initialSponsorship, "remainingEscrow");
        _assertTrue(
            therdal.sponsorContributions(topicId, alice) == initialSponsorship,
            "creator contribution"
        );

        // Bob tops up $50 USDC while Open
        uint256 bobTopUp = 50_000_000;
        usdc.mint(bob, bobTopUp);
        VM.prank(bob);
        usdc.approve(address(therdal), bobTopUp);

        VM.prank(bob);
        therdal.sponsorTopic(topicId, bobTopUp);

        _assertTrue(therdal.totalSponsored(topicId) == 150_000_000, "combined totalSponsored");
        _assertTrue(therdal.remainingEscrow(topicId) == 150_000_000, "combined remainingEscrow");
        _assertTrue(therdal.sponsorContributions(topicId, bob) == bobTopUp, "bob contribution");
    }

    function test_MultiStablecoinScalingPriceFreezeAndNonReturningToken() public {
        VM.prank(operator);
        controller.configureStablecoin(address(dai), 18, true);
        VM.prank(operator);
        controller.configureStablecoin(address(usdt), 6, true);

        string[] memory opts = _twoOptions();
        uint64 endsAt = INITIAL_TIMESTAMP + 3 days;

        // Create topic with 18-decimal DAI: $0.01 = 10_000 * 1e12 = 1e16 wei
        uint256 daiSponsorship = 25 ether;
        dai.mint(alice, daiSponsorship);
        VM.prank(alice);
        dai.approve(address(therdal), daiSponsorship);

        VM.prank(alice);
        uint256 daiTopicId = therdal.createTopicWithConfig(
            ITopicRegistry.CreateTopicParams({
                subject: "Should staking issuance follow an asymptotic cap?",
                options: opts,
                votingEndsAt: endsAt,
                paymentToken: address(dai),
                initialSponsorship: daiSponsorship
            })
        );

        ITopicRegistry.TopicView memory daiTopic = therdal.getTopic(daiTopicId);
        _assertTrue(daiTopic.pricePerVote == 1e16, "DAI 18-decimal pricePerVote == 0.01e18");
        _assertTrue(daiTopic.totalSponsored == daiSponsorship, "DAI sponsorship credited");

        // Market-adaptive controller update to $0.02/vote does NOT retroactively change daiTopic
        VM.prank(operator);
        controller.setPricePerVoteUsdMicros(20_000);
        _assertTrue(
            therdal.getTopic(daiTopicId).pricePerVote == 1e16,
            "Active topic pricePerVote remains frozen"
        );

        // Non-returning USDT-style token works seamlessly
        usdt.mint(bob, 10_000_000);
        VM.prank(bob);
        usdt.approve(address(therdal), 10_000_000);

        VM.prank(bob);
        uint256 usdtTopicId = therdal.createTopicWithConfig(
            ITopicRegistry.CreateTopicParams({
                subject: "Adopt FOCIL inclusion lists in Glamsterdam?",
                options: opts,
                votingEndsAt: endsAt,
                paymentToken: address(usdt),
                initialSponsorship: 10_000_000
            })
        );
        _assertTrue(therdal.getTopic(usdtTopicId).pricePerVote == 20_000, "New topic gets $0.02");
        _assertTrue(therdal.totalSponsored(usdtTopicId) == 10_000_000, "USDT sponsored");
    }

    // -------------------------------------------------------------------------
    // 3. Lifecycle Phases, Pagination & Deploy Script
    // -------------------------------------------------------------------------

    function test_TopicPhaseTransitionAndPagination() public {
        string[] memory opts = _twoOptions();
        uint64 endsAt = INITIAL_TIMESTAMP + 3600;

        for (uint256 i = 0; i < 4; i++) {
            therdal.createTopic("Topic pagination check", opts, endsAt, 0);
        }

        _assertTrue(
            therdal.getPhase(999) == ITopicRegistry.TopicPhase.None,
            "Unregistered topic phase == None"
        );
        _assertTrue(
            therdal.getPhase(1) == ITopicRegistry.TopicPhase.Open,
            "Open before votingEndsAt"
        );

        // Exact boundary: timestamp == votingEndsAt is still Open
        VM.warp(endsAt);
        _assertTrue(
            therdal.getPhase(1) == ITopicRegistry.TopicPhase.Open,
            "Open at exact votingEndsAt"
        );

        // 1 second after votingEndsAt -> Closed
        VM.warp(endsAt + 1);
        _assertTrue(
            therdal.getPhase(1) == ITopicRegistry.TopicPhase.Closed,
            "Closed after votingEndsAt"
        );

        ITopicRegistry.TopicView[] memory page1 = therdal.getTopics(0, 2);
        _assertTrue(page1.length == 2 && page1[0].id == 1 && page1[1].id == 2, "Page 1");

        ITopicRegistry.TopicView[] memory page2 = therdal.getTopics(2, 5);
        _assertTrue(page2.length == 2 && page2[0].id == 3 && page2[1].id == 4, "Page 2");

        ITopicRegistry.TopicView[] memory emptyPage = therdal.getTopics(10, 5);
        _assertTrue(emptyPage.length == 0, "Offset past topicCount returns empty slice");
    }

    function test_DeployScriptWiresControllerAndRegistry() public {
        DeployTherdal deployer = new DeployTherdal();
        (TherdalController deployedCtrl, Therdal deployedRegistry) = deployer.run(
            operator,
            address(usdc)
        );
        _assertTrue(address(deployedRegistry.controller()) == address(deployedCtrl), "wired");
        _assertTrue(deployedCtrl.operator() == operator, "operator");
        _assertTrue(deployedCtrl.defaultPaymentToken() == address(usdc), "defaultPaymentToken");
    }

    // -------------------------------------------------------------------------
    // 4. Cross-Layer Canonical ContentHash Deterministic Vector
    // -------------------------------------------------------------------------

    function test_CrossLayerCanonicalTopicContentHashVector() public {
        string memory subject = "Should Ethereum increase the blob target from 6 to 12?";
        string[] memory options = new string[](3);
        options[0] = "12 Blobs";
        options[1] = "9 Blobs";
        options[2] = "Keep at 6 Blobs";
        uint64 votingEndsAt = 1_800_000_000;

        uint256 topicId = therdal.createTopic(subject, options, votingEndsAt, 0);
        bytes32 actual = therdal.getTopic(topicId).contentHash;

        // Recompute explicitly from spec formula:
        // keccak256("THERDAL_TOPIC_V1" || keccak256(subject) || uint64(3) || keccak256(h0||h1||h2) || uint64(1800000000))
        bytes32 subjectHash = keccak256(bytes(subject));
        bytes32 optionsHash = keccak256(
            abi.encodePacked(
                keccak256(bytes("12 Blobs")),
                keccak256(bytes("9 Blobs")),
                keccak256(bytes("Keep at 6 Blobs"))
            )
        );
        bytes32 expected = keccak256(
            abi.encodePacked(
                "THERDAL_TOPIC_V1",
                subjectHash,
                uint64(3),
                optionsHash,
                uint64(1_800_000_000)
            )
        );

        _assertTrue(actual == expected, "contentHash matches canonical 96-byte preimage formula");
        _assertTrue(
            actual == 0x9c2f31b24a86bb08a454e2566c47308d9fef016662c6e369a5323230572aa02d,
            "matches exact shared cross-layer test vector digest"
        );
    }

    // -------------------------------------------------------------------------
    // 5. Boundary Conditions: Subject, Options Count/Length/Duplicates, Time
    // -------------------------------------------------------------------------

    function test_SubjectBoundariesAndValidationReverts() public {
        string[] memory opts = _twoOptions();
        uint64 endsAt = INITIAL_TIMESTAMP + 1 days;

        // Empty subject
        VM.expectRevert(ITopicRegistry.EmptySubject.selector);
        therdal.createTopic("", opts, endsAt, 0);

        // Whitespace-only subject
        VM.expectRevert(ITopicRegistry.EmptySubject.selector);
        therdal.createTopic("   \t\n\r  ", opts, endsAt, 0);

        // Exact 512-byte subject succeeds
        string memory maxSubject = _repeatChar(0x41, TopicValidation.MAX_SUBJECT_BYTES);
        uint256 okId = therdal.createTopic(maxSubject, opts, endsAt, 0);
        _assertTrue(okId == 1, "512-byte subject succeeds");

        // 513-byte subject reverts
        string memory tooLongSubject = _repeatChar(0x41, TopicValidation.MAX_SUBJECT_BYTES + 1);
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.SubjectTooLong.selector,
                TopicValidation.MAX_SUBJECT_BYTES + 1,
                TopicValidation.MAX_SUBJECT_BYTES
            )
        );
        therdal.createTopic(tooLongSubject, opts, endsAt, 0);
    }

    function test_OptionsCountLengthAndDuplicateValidationReverts() public {
        uint64 endsAt = INITIAL_TIMESTAMP + 1 days;

        // 0 options
        string[] memory zeroOpts = new string[](0);
        VM.expectRevert(
            abi.encodeWithSelector(ITopicRegistry.InvalidOptionCount.selector, 0, 2, 16)
        );
        therdal.createTopic("Valid subject?", zeroOpts, endsAt, 0);

        // 1 option
        string[] memory oneOpt = new string[](1);
        oneOpt[0] = "Only choice";
        VM.expectRevert(
            abi.encodeWithSelector(ITopicRegistry.InvalidOptionCount.selector, 1, 2, 16)
        );
        therdal.createTopic("Valid subject?", oneOpt, endsAt, 0);

        // Max 16 unique options succeeds
        string[] memory sixteenOpts = new string[](16);
        for (uint256 i = 0; i < 16; i++) {
            sixteenOpts[i] = string(abi.encodePacked("Option #", bytes1(uint8(65 + i))));
        }
        uint256 id16 = therdal.createTopic("16-option ballot?", sixteenOpts, endsAt, 0);
        _assertTrue(therdal.getTopic(id16).options.length == 16, "16 options stored");

        // 17 options reverts
        string[] memory seventeenOpts = new string[](17);
        for (uint256 i = 0; i < 17; i++) {
            seventeenOpts[i] = string(abi.encodePacked("Option #", bytes1(uint8(65 + i))));
        }
        VM.expectRevert(
            abi.encodeWithSelector(ITopicRegistry.InvalidOptionCount.selector, 17, 2, 16)
        );
        therdal.createTopic("17-option ballot?", seventeenOpts, endsAt, 0);

        // Empty / whitespace option reverts
        string[] memory blankOpt = new string[](2);
        blankOpt[0] = "Support";
        blankOpt[1] = "  \t\n ";
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.EmptyOption.selector, 1));
        therdal.createTopic("Blank option test?", blankOpt, endsAt, 0);

        // Exact 256-byte option succeeds, 257-byte option reverts
        string[] memory boundaryLenOpts = new string[](2);
        boundaryLenOpts[0] = _repeatChar(0x42, TopicValidation.MAX_OPTION_BYTES);
        boundaryLenOpts[1] = "Alternative";
        therdal.createTopic("256-byte option check?", boundaryLenOpts, endsAt, 0);

        boundaryLenOpts[1] = _repeatChar(0x43, TopicValidation.MAX_OPTION_BYTES + 1);
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.OptionTooLong.selector,
                1,
                TopicValidation.MAX_OPTION_BYTES + 1,
                TopicValidation.MAX_OPTION_BYTES
            )
        );
        therdal.createTopic("257-byte option check?", boundaryLenOpts, endsAt, 0);

        // Duplicate option (including deceptive whitespace-padded duplicate) reverts
        string[] memory dupOpts = new string[](3);
        dupOpts[0] = "12 Blobs";
        dupOpts[1] = "9 Blobs";
        dupOpts[2] = "  12 Blobs\n";
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.DuplicateOption.selector, 0, 2));
        therdal.createTopic("Duplicate option check?", dupOpts, endsAt, 0);
    }

    function test_VotingEndTimeAndSnapshotBlockBoundaries() public {
        string[] memory opts = _twoOptions();

        // Past votingEndsAt reverts
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidVotingEndTime.selector,
                INITIAL_TIMESTAMP - 1,
                INITIAL_TIMESTAMP
            )
        );
        therdal.createTopic("Past end time?", opts, INITIAL_TIMESTAMP - 1, 0);

        // Current timestamp votingEndsAt reverts (must be strictly > block.timestamp)
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidVotingEndTime.selector,
                INITIAL_TIMESTAMP,
                INITIAL_TIMESTAMP
            )
        );
        therdal.createTopic("Zero duration?", opts, INITIAL_TIMESTAMP, 0);

        // +1 second succeeds
        uint256 okId = therdal.createTopic("1-second window?", opts, INITIAL_TIMESTAMP + 1, 0);
        _assertTrue(okId == 1, "+1s window succeeds");

        // Block 0 reverts
        VM.roll(0);
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.InvalidSnapshotBlock.selector, 0));
        therdal.createTopic("Genesis block?", opts, INITIAL_TIMESTAMP + 100, 0);
    }

    // -------------------------------------------------------------------------
    // 6. Fuzz Test: Arbitrary Future Deadlines & Optional Sponsorships
    // -------------------------------------------------------------------------

    function testFuzz_CreateTopicValidDeadlineAndSponsorship(
        uint32 durationSecs,
        uint96 sponsorshipMicros
    ) public {
        uint64 delta = uint64(durationSecs) + 1;
        uint64 votingEndsAt = INITIAL_TIMESTAMP + delta;
        uint256 sponsorAmount = uint256(sponsorshipMicros);

        if (sponsorAmount > 0) {
            usdc.mint(alice, sponsorAmount);
            VM.prank(alice);
            usdc.approve(address(therdal), sponsorAmount);
        }

        string[] memory opts = _twoOptions();
        VM.prank(alice);
        uint256 topicId = therdal.createTopic(
            "Fuzzed topic creation",
            opts,
            votingEndsAt,
            sponsorAmount
        );

        ITopicRegistry.TopicView memory viewData = therdal.getTopic(topicId);
        _assertTrue(viewData.votingEndsAt == votingEndsAt, "fuzz votingEndsAt");
        _assertTrue(viewData.totalSponsored == sponsorAmount, "fuzz totalSponsored");
        _assertTrue(viewData.remainingEscrow == sponsorAmount, "fuzz remainingEscrow");
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _twoOptions() internal pure returns (string[] memory opts) {
        opts = new string[](2);
        opts[0] = "Support";
        opts[1] = "Oppose";
    }

    function _repeatChar(bytes1 ch, uint256 len) internal pure returns (string memory) {
        bytes memory buf = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            buf[i] = ch;
        }
        return string(buf);
    }

    function _assertTrue(bool cond, string memory reason) internal pure {
        if (!cond) {
            revert AssertionFailed(reason);
        }
    }
}
