// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ITopicRegistry
 * @notice Stage 1 interface, domain types, events, and custom errors for Therdal Topic Creation.
 */
interface ITopicRegistry {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /**
     * @notice Lifecycle phase of a topic in Stage 1.
     *         - `None`: Topic ID has not been registered.
     *         - `Open`: Voting window is active (`block.timestamp <= votingEndsAt`).
     *         - `Closed`: Voting window has ended (`block.timestamp > votingEndsAt`).
     */
    enum TopicPhase {
        None,
        Open,
        Closed
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /**
     * @notice Configuration supplied to `createTopicWithConfig` when selecting a specific allowlisted
     *         USD stablecoin (`paymentToken == address(0)` defaults to `controller.defaultPaymentToken()`).
     */
    struct CreateTopicParams {
        string subject;
        string[] options;
        uint64 votingEndsAt;
        address paymentToken;
        uint256 initialSponsorship;
    }

    /**
     * @notice Compact fixed-slot metadata stored on-chain per topic (`_topics[topicId]`).
     */
    struct TopicRecord {
        address creator;
        uint64 createdAt;
        uint64 votingEndsAt;
        uint64 snapshotBlock;
        uint32 optionCount;
        bytes32 snapshotBlockHash;
        bytes32 contentHash;
        address paymentToken;
        uint256 pricePerVote;
    }

    /**
     * @notice Complete read model returned by `getTopic` and `getTopics`.
     */
    struct TopicView {
        uint256 id;
        address creator;
        string subject;
        string[] options;
        uint64 createdAt;
        uint64 votingEndsAt;
        uint64 snapshotBlock;
        bytes32 snapshotBlockHash;
        bytes32 contentHash;
        address paymentToken;
        uint256 pricePerVote;
        uint256 totalSponsored;
        uint256 remainingEscrow;
        TopicPhase phase;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event TopicCreated(
        uint256 indexed topicId,
        address indexed creator,
        address indexed paymentToken,
        string subject,
        string[] options,
        uint64 createdAt,
        uint64 votingEndsAt,
        uint64 snapshotBlock,
        bytes32 snapshotBlockHash,
        bytes32 contentHash,
        uint256 frozenPricePerVote,
        uint256 initialSponsorship
    );

    event TopicSponsored(
        uint256 indexed topicId,
        address indexed sponsor,
        address indexed paymentToken,
        uint256 amount,
        uint256 totalSponsored,
        uint256 remainingEscrow
    );

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------

    error TopicNotFound(uint256 topicId);
    error EmptySubject();
    error SubjectTooLong(uint256 byteLength, uint256 maxBytes);
    error InvalidOptionCount(uint256 count, uint256 minOptions, uint256 maxOptions);
    error EmptyOption(uint256 optionIndex);
    error OptionTooLong(uint256 optionIndex, uint256 byteLength, uint256 maxBytes);
    error DuplicateOption(uint256 firstIndex, uint256 duplicateIndex);
    error InvalidVotingEndTime(uint64 votingEndsAt, uint64 currentTimestamp);
    error InvalidSnapshotBlock(uint256 currentBlockNumber);
    error InvalidTopicPhase(TopicPhase currentPhase, TopicPhase expectedPhase);
    error ZeroSponsorshipAmount();
    error InvalidPaginationLimit(uint256 limit, uint256 maxLimit);

    // -------------------------------------------------------------------------
    // Core Stage 1 Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Registers a new topic using the default allowlisted USD stablecoin (USDC).
     *         Topic creation requires $0 fee and $0 deposit when `initialSponsorship == 0`.
     *         When `initialSponsorship > 0`, 100% is deposited into the topic's sponsorship escrow.
     */
    function createTopic(
        string calldata subject,
        string[] calldata options,
        uint64 votingEndsAt,
        uint256 initialSponsorship
    ) external returns (uint256 topicId);

    /**
     * @notice Registers a new topic with an explicit allowlisted USD stablecoin (`address(0)` defaults to USDC).
     */
    function createTopicWithConfig(CreateTopicParams calldata params)
        external
        returns (uint256 topicId);

    /**
     * @notice Contributes additional USD stablecoin sponsorship (100% to escrow, $0 fee) while the topic is `Open`.
     */
    function sponsorTopic(uint256 topicId, uint256 amount) external;

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function topicCount() external view returns (uint256);

    function getTopic(uint256 topicId) external view returns (TopicView memory);

    function getTopicOptions(uint256 topicId) external view returns (string[] memory);

    function getTopics(uint256 offset, uint256 limit) external view returns (TopicView[] memory);

    function getPhase(uint256 topicId) external view returns (TopicPhase);
}
