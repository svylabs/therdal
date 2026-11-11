// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "./interfaces/ITopicRegistry.sol";
import {TopicValidation} from "./libraries/TopicValidation.sol";
import {SponsorEscrow} from "./SponsorEscrow.sol";
import {TherdalController} from "./TherdalController.sol";

/**
 * @title Therdal
 * @notice Stage 1 Topic Registry & Optional Sponsorship Escrow for the Therdal Protocol:
 *         - Permissionlessly registers topics with `subject`, `string[] options` (2..16 unique free-text
 *           choices), and `votingEndsAt`.
 *         - Always free topic creation ($0 creation fee, $0 mandatory deposit).
 *         - Optional initial or follow-up USDC / allowlisted stablecoin sponsorship (100% to pool).
 *         - Automatically pins `snapshotBlock = block.number - 1`, `snapshotBlockHash`, frozen `pricePerVote`,
 *           and deterministic cross-layer `contentHash`.
 */
contract Therdal is ITopicRegistry, SponsorEscrow {
    /// @notice Maximum number of topics returned in a single `getTopics` page
    uint256 public constant MAX_PAGE_LIMIT = 50;

    /// @notice Smart-account controller & pricing authority (replaceable by itself for DAO migration)
    TherdalController public controller;

    /// @notice Total topics registered (`topicId` is 1-indexed)
    uint256 public override topicCount;

    /// @notice Fixed-slot metadata per topic (`1..=topicCount`)
    mapping(uint256 => TopicRecord) internal _topics;

    /// @notice Registered free-text subject per topic
    mapping(uint256 => string) internal _topicSubjects;

    /// @notice Registered free-text option labels per topic
    mapping(uint256 => string[]) internal _topicOptions;

    uint256 private _locked = 1;

    event ControllerReplaced(address indexed previousController, address indexed newController);

    error ZeroControllerAddress();
    error UnauthorizedController(address caller);
    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() internal {
        if (_locked != 1) {
            revert ReentrancyGuardReentrantCall();
        }
        _locked = 2;
    }

    function _nonReentrantAfter() internal {
        _locked = 1;
    }

    constructor(address _controller) {
        if (_controller == address(0)) {
            revert ZeroControllerAddress();
        }
        controller = TherdalController(payable(_controller));
    }

    /**
     * @notice Allows the current `TherdalController` smart account (or DAO) to migrate to a new controller contract.
     */
    function replaceController(address newController) external {
        if (msg.sender != address(controller)) {
            revert UnauthorizedController(msg.sender);
        }
        if (newController == address(0)) {
            revert ZeroControllerAddress();
        }
        address previous = address(controller);
        controller = TherdalController(payable(newController));
        emit ControllerReplaced(previous, newController);
    }

    // -------------------------------------------------------------------------
    // Stage 1: Topic Registration & Optional Sponsorship
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITopicRegistry
     */
    function createTopic(
        string calldata subject,
        string[] calldata options,
        uint64 votingEndsAt,
        uint256 initialSponsorship
    ) external override nonReentrant returns (uint256 topicId) {
        return
            _registerTopic(
                subject,
                options,
                votingEndsAt,
                address(0),
                initialSponsorship
            );
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function createTopicWithConfig(CreateTopicParams calldata params)
        external
        override
        nonReentrant
        returns (uint256 topicId)
    {
        return
            _registerTopic(
                params.subject,
                params.options,
                params.votingEndsAt,
                params.paymentToken,
                params.initialSponsorship
            );
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function sponsorTopic(uint256 topicId, uint256 amount) external override nonReentrant {
        if (amount == 0) {
            revert ZeroSponsorshipAmount();
        }
        TopicRecord storage record = _topics[topicId];
        if (record.creator == address(0)) {
            revert TopicNotFound(topicId);
        }
        TopicPhase phase = getPhase(topicId);
        if (phase != TopicPhase.Open) {
            revert InvalidTopicPhase(phase, TopicPhase.Open);
        }

        _collectSponsorship(topicId, msg.sender, record.paymentToken, amount);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopic(uint256 topicId) external view override returns (TopicView memory) {
        TopicRecord storage record = _topics[topicId];
        if (record.creator == address(0)) {
            revert TopicNotFound(topicId);
        }
        return _buildTopicView(topicId, record);
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopicOptions(uint256 topicId) external view override returns (string[] memory) {
        if (_topics[topicId].creator == address(0)) {
            revert TopicNotFound(topicId);
        }
        return _topicOptions[topicId];
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopics(uint256 offset, uint256 limit)
        external
        view
        override
        returns (TopicView[] memory page)
    {
        if (limit == 0 || limit > MAX_PAGE_LIMIT) {
            revert InvalidPaginationLimit(limit, MAX_PAGE_LIMIT);
        }

        uint256 total = topicCount;
        if (offset >= total) {
            return new TopicView[](0);
        }

        uint256 available = total - offset;
        uint256 count = available < limit ? available : limit;
        page = new TopicView[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 topicId = offset + i + 1; // 1-indexed topicId
            page[i] = _buildTopicView(topicId, _topics[topicId]);
        }
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function getPhase(uint256 topicId) public view override returns (TopicPhase) {
        TopicRecord storage record = _topics[topicId];
        if (record.creator == address(0)) {
            return TopicPhase.None;
        }
        if (block.timestamp <= record.votingEndsAt) {
            return TopicPhase.Open;
        }
        return TopicPhase.Closed;
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    function _registerTopic(
        string calldata subject,
        string[] calldata options,
        uint64 votingEndsAt,
        address requestedToken,
        uint256 initialSponsorship
    ) internal returns (uint256 topicId) {
        if (block.number == 0) {
            revert InvalidSnapshotBlock(block.number);
        }

        uint64 createdAt = uint64(block.timestamp);
        bytes32 contentHash = TopicValidation.validateAndHash(
            subject,
            options,
            votingEndsAt,
            createdAt
        );

        (address paymentToken, uint256 frozenPricePerVote) = controller.quoteTopicTerms(
            requestedToken
        );

        uint64 snapshotBlock = uint64(block.number - 1);
        bytes32 snapshotBlockHash = blockhash(snapshotBlock);

        topicId = ++topicCount;

        TopicRecord storage record = _topics[topicId];
        record.creator = msg.sender;
        record.createdAt = createdAt;
        record.votingEndsAt = votingEndsAt;
        record.snapshotBlock = snapshotBlock;
        record.optionCount = uint32(options.length);
        record.snapshotBlockHash = snapshotBlockHash;
        record.contentHash = contentHash;
        record.paymentToken = paymentToken;
        record.pricePerVote = frozenPricePerVote;

        _topicSubjects[topicId] = subject;

        string[] storage storedOptions = _topicOptions[topicId];
        uint256 optLen = options.length;
        for (uint256 i = 0; i < optLen; i++) {
            storedOptions.push(options[i]);
        }

        if (initialSponsorship > 0) {
            _collectSponsorship(topicId, msg.sender, paymentToken, initialSponsorship);
        }

        emit TopicCreated(
            topicId,
            msg.sender,
            paymentToken,
            subject,
            options,
            createdAt,
            votingEndsAt,
            snapshotBlock,
            snapshotBlockHash,
            contentHash,
            frozenPricePerVote,
            initialSponsorship
        );
    }

    function _buildTopicView(uint256 topicId, TopicRecord storage record)
        internal
        view
        returns (TopicView memory)
    {
        return
            TopicView({
                id: topicId,
                creator: record.creator,
                subject: _topicSubjects[topicId],
                options: _topicOptions[topicId],
                createdAt: record.createdAt,
                votingEndsAt: record.votingEndsAt,
                snapshotBlock: record.snapshotBlock,
                snapshotBlockHash: record.snapshotBlockHash,
                contentHash: record.contentHash,
                paymentToken: record.paymentToken,
                pricePerVote: record.pricePerVote,
                totalSponsored: totalSponsored[topicId],
                remainingEscrow: remainingEscrow[topicId],
                phase: getPhase(topicId)
            });
    }
}
