// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ITherdal
 * @notice Core interface, data structures, events, and errors for the Therdal Protocol (v0.2).
 */
interface ITherdal {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    enum ResolutionPhase {
        None,
        Open,
        Settling,
        Finalized,
        ClosedForRefunds
    }

    enum Choice {
        Yes,
        No,
        Abstain
    }

    enum PositionType {
        Wallet,
        Validator
    }

    // -------------------------------------------------------------------------
    // Structs
    // -------------------------------------------------------------------------

    /**
     * @notice Configuration supplied when creating a new resolution (v0.2).
     *         Creator must approve the mandatory $100 equivalent deposit (+ optional `extraSponsorAmount`)
     *         in `paymentToken` (or `controller.defaultPaymentToken()` when `paymentToken == address(0)`).
     */
    struct ResolutionConfig {
        string questionURI;
        uint64 snapshotBlockNumber;
        uint64 snapshotBeaconTimestamp;
        uint64 snapshotEpoch;
        uint64 votingStartsAt;
        uint64 votingEndsAt;
        uint64 settlementDeadline;
        uint32 rulesetVersion;
        address paymentToken;
        uint256 extraSponsorAmount;
    }

    /**
     * @notice Mutable and pinned state of a resolution (v0.2).
     */
    struct ResolutionState {
        bytes32 positionRoot;
        uint256[3] tallies;
        uint256 countedPositions;
        uint256 acceptedVotes;
        uint256 nextBatchId;
        uint256 settledBatchCount;
        bytes32 snapshotExecutionRoot;
        bytes32 snapshotBeaconRoot;
        uint64 snapshotBlockNumber;
        uint64 snapshotBeaconTimestamp;
        uint64 snapshotEpoch;
        uint64 votingStartsAt;
        uint64 votingEndsAt;
        uint64 settlementDeadline;
        address creator;
        address paymentToken;
        uint256 pricePerVote;
        uint32 rulesetVersion;
        bool snapshotAuthenticated;
        bool finalized;
        bool settlementClosed;
    }

    /**
     * @notice Registered EIP-4844 batch commitment record.
     */
    struct BatchRecord {
        bytes32 commitmentRoot;
        address submitter;
        uint32 blobCount;
        bool settled;
        uint64 publishedAt;
        uint256 newlyCountedPositions;
        uint256 newlyAcceptedVotes;
    }

    /**
     * @notice Proof data used to authenticate pinned snapshot block/slot against Ethereum state.
     */
    struct SnapshotAuthProof {
        bytes rlpExecutionHeader;
        bytes32 beaconBlockRoot;
        bytes32 beaconStateRoot;
        bytes32[] stateRootBranch;
        bytes32[] executionHashBranch;
        uint256 executionHashLeafIndex;
    }

    /**
     * @notice Canonical public inputs verified by StarkVerifierAdapter during settleBatch (v0.2).
     */
    struct BatchPublicInputs {
        uint256 chainId;
        uint256 resolutionId;
        uint32 rulesetVersion;
        bytes32 snapshotExecutionRoot;
        bytes32 snapshotBeaconRoot;
        uint256 batchId;
        bytes32 registeredBatchCommitment;
        bytes32 oldPositionRoot;
        bytes32 newPositionRoot;
        uint256[3] oldTallies;
        uint256[3] newTallies;
        uint256 oldCountedPositions;
        uint256 newCountedPositions;
        uint256 newlyAcceptedVoteCount;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ResolutionCreated(
        uint256 indexed resolutionId,
        address indexed creator,
        address indexed paymentToken,
        uint64 snapshotBlockNumber,
        uint64 snapshotBeaconTimestamp,
        uint64 votingStartsAt,
        uint64 votingEndsAt,
        uint64 settlementDeadline,
        uint32 rulesetVersion,
        uint256 creationFeePaid,
        uint256 initialEscrowCredited,
        uint256 frozenPricePerVote,
        string questionURI
    );

    event SnapshotAuthenticated(
        uint256 indexed resolutionId,
        bytes32 executionBlockHash,
        bytes32 snapshotExecutionRoot,
        bytes32 snapshotBeaconRoot
    );

    event BatchPublished(
        uint256 indexed resolutionId,
        uint256 indexed batchId,
        address indexed submitter,
        bytes32 commitmentRoot,
        bytes32[] blobVersionedHashes
    );

    event BatchSettled(
        uint256 indexed resolutionId,
        uint256 indexed batchId,
        address indexed prover,
        address submitter,
        bytes32 oldPositionRoot,
        bytes32 newPositionRoot,
        uint256[3] newTallies,
        uint256 newlyCountedPositions,
        uint256 newlyAcceptedVoteCount,
        uint256 developerShare,
        uint256 submitterShare,
        uint256 proverShare
    );

    event ResolutionFinalized(
        uint256 indexed resolutionId,
        bytes32 finalPositionRoot,
        uint256[3] finalTallies,
        uint256 totalCountedPositions,
        uint256 totalAcceptedVotes,
        uint256 settledBatches,
        uint256 frozenUnusedEscrow
    );

    event SettlementClosedAndRefundsEnabled(
        uint256 indexed resolutionId,
        uint256 settledBatches,
        uint256 totalBatches,
        uint256 frozenUnusedEscrow
    );

    event ResolutionSponsored(
        uint256 indexed resolutionId,
        address indexed sponsor,
        address indexed paymentToken,
        uint256 amount,
        uint256 totalEscrowContributed,
        uint256 remainingEscrow
    );

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error ResolutionNotFound(uint256 resolutionId);
    error InvalidRulesetVersion(uint32 version);
    error InvalidTimeWindow(uint64 votingStartsAt, uint64 votingEndsAt, uint64 settlementDeadline);
    error InvalidSnapshotBlock(uint64 snapshotBlockNumber, uint64 currentBlockNumber);
    error InvalidPhase(ResolutionPhase currentPhase, ResolutionPhase expectedPhase);
    error InvalidBlobCount(uint8 blobCount);
    error MissingBlobHash(uint256 blobIndex);
    error SnapshotAlreadyAuthenticated(uint256 resolutionId);
    error SnapshotNotAuthenticated(uint256 resolutionId);
    error BatchOutOfRange(uint256 batchId, uint256 nextBatchId);
    error BatchAlreadySettled(uint256 resolutionId, uint256 batchId);
    error InvalidCountedPositionsTransition(uint256 oldCount, uint256 newCount);
    error InvalidAcceptedVoteCount(uint256 newlyAcceptedVoteCount, uint256 newlyCountedPositions);
    error InvalidTallyTransition(uint256 choiceIndex, uint256 oldTally, uint256 newTally);
    error InvalidSettlementProof();
    error InsufficientEscrowBalance(uint256 requiredFee, uint256 availableEscrow);
    error BatchesRemainingToSettle(uint256 settledBatches, uint256 totalBatches);
    error SettlementDeadlineNotReached(uint64 currentTimestamp, uint64 settlementDeadline);
    error ZeroSponsorshipAmount();

    // -------------------------------------------------------------------------
    // Core Functions
    // -------------------------------------------------------------------------

    function createResolution(ResolutionConfig calldata config) external returns (uint256 resolutionId);

    function authenticateSnapshot(uint256 resolutionId, SnapshotAuthProof calldata proof) external;

    function publishBatch(uint256 resolutionId, uint8 blobCount) external returns (uint256 batchId);

    function settleBatch(
        uint256 resolutionId,
        uint256 batchId,
        bytes32 newPositionRoot,
        uint256[3] calldata newTallies,
        uint256 newCountedPositions,
        uint256 newlyAcceptedVoteCount,
        bytes calldata proof
    ) external;

    function finalizeResolution(uint256 resolutionId) external;

    function sponsor(uint256 resolutionId, uint256 amount) external;

    function closeSettlementAndEnableRefunds(uint256 resolutionId) external;

    function claimRefund(uint256 resolutionId) external returns (uint256 refundAmount);
}
