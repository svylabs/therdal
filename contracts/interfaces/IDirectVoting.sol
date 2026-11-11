// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDirectVoting
 * @notice Stage 2 interface, domain structs, events, and custom errors for Direct On-Chain Voting
 *         backed by cryptographic proofs of Ethereum held on the Execution Layer or staked on the
 *         Beacon Chain at the topic's pinned snapshot block.
 */
interface IDirectVoting {
    // -------------------------------------------------------------------------
    // Enums
    // -------------------------------------------------------------------------

    /**
     * @notice Type of Ethereum stakeholder position proven at snapshot time.
     *         - `ExecutionWallet` (`0`): ETH balance held in an Execution Layer account (`THERDAL_WALLET`).
     *         - `BeaconValidator` (`1`): ETH staked in a Beacon Chain validator (`THERDAL_VALIDATOR`).
     */
    enum PositionType {
        ExecutionWallet,
        BeaconValidator
    }

    // -------------------------------------------------------------------------
    // Proof & View Structs
    // -------------------------------------------------------------------------

    /**
     * @notice Proof authenticating the Beacon Chain state root and snapshot epoch aligned with the
     *         topic's pinned `snapshotBlockHash`.
     * @param childBlockTimestamp Timestamp queried in EIP-4788 when `snapshotBeaconBlockRoot` was not
     *        already captured at topic creation (ignored when `snapshotBeaconBlockRoot != bytes32(0)`).
     * @param beaconSlot Slot number of the snapshot Beacon Block (`snapshotEpoch = beaconSlot / 32`).
     * @param slotBranch Depth-3 SHA-256 SSZ Merkle branch proving `beaconSlot` at leaf index `0` of `BeaconBlockHeader`.
     * @param beaconStateRoot `BeaconBlockHeader.state_root` (`snapshotBeaconRoot`).
     * @param stateRootBranch Depth-3 SHA-256 SSZ Merkle branch proving `beaconStateRoot` at leaf index `3` of `BeaconBlockHeader`.
     * @param executionHashBranch Depth-10 (Deneb) or Depth-11 (Electra) SHA-256 SSZ Merkle branch proving
     *        `snapshotBlockHash` at `BeaconState.latest_execution_payload_header.block_hash` (index `780`).
     */
    struct BeaconSnapshotAuthProof {
        uint64 childBlockTimestamp;
        uint64 beaconSlot;
        bytes32[] slotBranch;
        bytes32 beaconStateRoot;
        bytes32[] stateRootBranch;
        bytes32[] executionHashBranch;
    }

    /**
     * @notice SSZ inclusion proof for a single Beacon Chain `Validator` container at `validatorIndex`.
     */
    struct ValidatorStakeProof {
        uint64 validatorIndex;
        bytes32 pubkeyRoot;
        bytes32 withdrawalCredentials;
        uint64 effectiveBalanceGwei;
        bool slashed;
        uint64 activationEligibilityEpoch;
        uint64 activationEpoch;
        uint64 exitEpoch;
        uint64 withdrawableEpoch;
        bytes32[] validatorBranch;
        bytes32 validatorsLengthChunk;
        bytes32[] beaconStateBranch;
    }

    /**
     * @notice Combined direct voting proof payload allowing `msg.sender` to prove both Execution Layer
     *         wallet ETH and one or more Beacon Chain validators in a single transaction.
     */
    struct DirectVoteProofBundle {
        bool includeExecutionBalance;
        bytes rlpExecutionHeader;
        bytes rlpAccountProofNodes;
        BeaconSnapshotAuthProof beaconAuth;
        ValidatorStakeProof[] validatorProofs;
    }

    /**
     * @notice Read model describing snapshot authentication state for a topic.
     */
    struct SnapshotStateView {
        uint64 snapshotBlock;
        bytes32 snapshotBlockHash;
        bytes32 snapshotBeaconBlockRoot;
        bytes32 snapshotExecutionRoot;
        bytes32 snapshotBeaconRoot;
        uint64 snapshotEpoch;
        bool executionAuthenticated;
        bool beaconAuthenticated;
    }

    /**
     * @notice Receipt recorded per unique `(topicId, positionKey)` upon direct vote verification.
     */
    struct PositionReceipt {
        bool claimed;
        PositionType positionType;
        address voter;
        uint32 optionIndex;
        uint256 weightWei;
    }

    /**
     * @notice Complete ETH-weighted tally view for all options of a topic.
     */
    struct TopicTallyView {
        uint256 topicId;
        uint256[] optionWeightsWei;
        uint256[] optionPositionCounts;
        uint256 totalWeightWei;
        uint256 totalCountedPositions;
        uint256 directVoteCount;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event ExecutionSnapshotAuthenticated(
        uint256 indexed topicId,
        uint64 snapshotBlock,
        bytes32 snapshotBlockHash,
        bytes32 snapshotExecutionRoot
    );

    event BeaconSnapshotAuthenticated(
        uint256 indexed topicId,
        bytes32 beaconBlockRoot,
        bytes32 snapshotBeaconRoot,
        uint64 beaconSlot,
        uint64 snapshotEpoch
    );

    event PositionCounted(
        uint256 indexed topicId,
        bytes32 indexed positionKey,
        address indexed voter,
        PositionType positionType,
        uint64 validatorIndex,
        uint32 optionIndex,
        uint256 weightWei
    );

    event DirectVoteCast(
        uint256 indexed topicId,
        address indexed voter,
        uint32 indexed optionIndex,
        uint256 totalWeightWei,
        uint256 executionWeightWei,
        uint256 beaconWeightWei,
        uint256 positionsCounted
    );

    // -------------------------------------------------------------------------
    // Custom Errors
    // -------------------------------------------------------------------------

    error InvalidOptionIndex(uint32 optionIndex, uint32 optionCount);
    error EmptyDirectVoteProof();
    error ExecutionSnapshotAlreadyAuthenticated(uint256 topicId);
    error BeaconSnapshotAlreadyAuthenticated(uint256 topicId);
    error ExecutionSnapshotNotAuthenticated(uint256 topicId);
    error BeaconSnapshotNotAuthenticated(uint256 topicId);
    error PositionAlreadyVoted(uint256 topicId, bytes32 positionKey);
    error ZeroVotingWeight();
    error ValidatorSlashed(uint64 validatorIndex);
    error ValidatorNotActiveAtSnapshot(
        uint64 validatorIndex,
        uint64 activationEpoch,
        uint64 exitEpoch,
        uint64 snapshotEpoch
    );
    error UnsupportedWithdrawalPrefix(uint64 validatorIndex, uint8 prefix);
    error UnauthorizedWithdrawalAddress(
        uint64 validatorIndex,
        address expectedVoter,
        address credentialAddress
    );
    error ValidatorIndexOutOfRange(uint64 validatorIndex);
    error InvalidValidatorProof(uint64 validatorIndex);

    // -------------------------------------------------------------------------
    // Snapshot Authentication & Direct Voting Entry Points
    // -------------------------------------------------------------------------

    /**
     * @notice Authenticates and caches `snapshotExecutionRoot` for `topicId` from its RLP execution block header.
     */
    function authenticateExecutionSnapshot(
        uint256 topicId,
        bytes calldata rlpExecutionHeader
    ) external returns (bytes32 snapshotExecutionRoot);

    /**
     * @notice Authenticates and caches `snapshotBeaconRoot` and `snapshotEpoch` for `topicId` aligned with `snapshotBlockHash`.
     */
    function authenticateBeaconSnapshot(
        uint256 topicId,
        BeaconSnapshotAuthProof calldata proof
    ) external returns (bytes32 snapshotBeaconRoot, uint64 snapshotEpoch);

    /**
     * @notice Casts a direct on-chain vote ($0 protocol fee) using an EIP-1186 MPT proof of ETH held by
     *         `msg.sender` at `snapshotBlock`. Authenticates `rlpExecutionHeader` inline if not yet cached.
     */
    function voteWithExecutionBalance(
        uint256 topicId,
        uint32 optionIndex,
        bytes calldata rlpExecutionHeader,
        bytes calldata rlpAccountProofNodes
    ) external returns (uint256 weightWei);

    /**
     * @notice Casts a direct on-chain vote ($0 protocol fee) using SSZ proofs for one or more Beacon Chain
     *         validators whose `0x01`/`0x02` withdrawal credentials match `msg.sender` at `snapshotEpoch`.
     *         Authenticates `beaconAuth` inline if not yet cached.
     */
    function voteWithBeaconStake(
        uint256 topicId,
        uint32 optionIndex,
        BeaconSnapshotAuthProof calldata beaconAuth,
        ValidatorStakeProof[] calldata validatorProofs
    ) external returns (uint256 totalStakeWei);

    /**
     * @notice Casts a combined direct on-chain vote ($0 protocol fee) proving Execution Layer wallet ETH,
     *         Beacon Chain validator stakes, or both in a single atomic transaction.
     */
    function voteDirect(
        uint256 topicId,
        uint32 optionIndex,
        DirectVoteProofBundle calldata bundle
    ) external returns (uint256 totalWeightWei);

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getSnapshotState(uint256 topicId) external view returns (SnapshotStateView memory);

    function getTopicTallies(uint256 topicId) external view returns (TopicTallyView memory);

    function getPositionReceipt(
        uint256 topicId,
        bytes32 positionKey
    ) external view returns (PositionReceipt memory);

    function hasWalletVoted(uint256 topicId, address account) external view returns (bool);

    function hasValidatorVoted(uint256 topicId, uint64 validatorIndex) external view returns (bool);

    function computeWalletPositionKey(address account) external view returns (bytes32);

    function computeValidatorPositionKey(uint64 validatorIndex) external view returns (bytes32);
}
