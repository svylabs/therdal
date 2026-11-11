// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "./interfaces/IDirectVoting.sol";
import {ITopicRegistry} from "./interfaces/ITopicRegistry.sol";
import {PositionEligibility} from "./libraries/PositionEligibility.sol";
import {SnapshotAuthenticator} from "./libraries/SnapshotAuthenticator.sol";
import {TopicValidation} from "./libraries/TopicValidation.sol";
import {SponsorEscrow} from "./SponsorEscrow.sol";
import {TherdalController} from "./TherdalController.sol";

/**
 * @title Therdal
 * @notice Stage 1 (Topic Registry & Optional Sponsorship Escrow) + Stage 2 (Direct On-Chain Voting)
 *         for the Therdal Protocol:
 *         - Permissionlessly registers topics with `subject`, `string[] options` (2..16 unique free-text
 *           choices), and `votingEndsAt` ($0 creation fee, $0 mandatory deposit).
 *         - Automatically pins `snapshotBlock = block.number - 1`, `snapshotBlockHash`, and (when EIP-4788
 *           is active) `snapshotBeaconBlockRoot` at creation.
 *         - Allows ETH holders to vote directly ($0 protocol fee, zero escrow draw) during `Open` by
 *           submitting EIP-1186 MPT proofs of Execution Layer ETH held at snapshot time, SHA-256 SSZ
 *           proofs of Beacon Chain ETH staked at snapshot time, or both in a single transaction.
 */
contract Therdal is ITopicRegistry, IDirectVoting, SponsorEscrow {
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

    // -------------------------------------------------------------------------
    // Stage 2: Snapshot Authentication & Direct Voting State
    // -------------------------------------------------------------------------

    /// @notice Parent Beacon Block root captured from EIP-4788 at creation or upon beacon authentication
    mapping(uint256 => bytes32) internal _snapshotBeaconBlockRoots;

    /// @notice Authenticated Execution Layer `stateRoot` per topic
    mapping(uint256 => bytes32) internal _snapshotExecutionRoots;

    /// @notice Authenticated Beacon Chain `state_root` per topic
    mapping(uint256 => bytes32) internal _snapshotBeaconRoots;

    /// @notice Authenticated Beacon Chain snapshot epoch (`beaconSlot / 32`) per topic
    mapping(uint256 => uint64) internal _snapshotEpochs;

    /// @notice Whether Execution Layer snapshot state root has been authenticated for `topicId`
    mapping(uint256 => bool) internal _executionAuthenticated;

    /// @notice Whether Beacon Chain snapshot state root has been authenticated for `topicId`
    mapping(uint256 => bool) internal _beaconAuthenticated;

    /// @notice ETH-weighted tally (in wei) per `(topicId, optionIndex)`
    mapping(uint256 => mapping(uint32 => uint256)) internal _optionWeightsWei;

    /// @notice Counted unique positions per `(topicId, optionIndex)`
    mapping(uint256 => mapping(uint32 => uint256)) internal _optionPositionCounts;

    /// @notice Total ETH weight (in wei) counted across all options for `topicId`
    mapping(uint256 => uint256) internal _totalWeightWei;

    /// @notice Total unique positions (wallets + validators) counted across all options for `topicId`
    mapping(uint256 => uint256) internal _totalCountedPositions;

    /// @notice Total direct vote transactions accepted for `topicId`
    mapping(uint256 => uint256) internal _directVoteCount;

    /// @notice Canonical uniqueness registry and receipt per `(topicId, positionKey)`
    mapping(uint256 => mapping(bytes32 => PositionReceipt)) internal _positionReceipts;

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
        return _registerTopic(subject, options, votingEndsAt, address(0), initialSponsorship);
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function createTopicWithConfig(
        CreateTopicParams calldata params
    ) external override nonReentrant returns (uint256 topicId) {
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
        TopicRecord storage record = _requireTopicExists(topicId);
        TopicPhase phase = getPhase(topicId);
        if (phase != TopicPhase.Open) {
            revert InvalidTopicPhase(phase, TopicPhase.Open);
        }

        _collectSponsorship(topicId, msg.sender, record.paymentToken, amount);
    }

    // -------------------------------------------------------------------------
    // Stage 2: Snapshot Authentication & Direct On-Chain Voting
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc IDirectVoting
     */
    function authenticateExecutionSnapshot(
        uint256 topicId,
        bytes calldata rlpExecutionHeader
    ) external override nonReentrant returns (bytes32 snapshotExecutionRoot) {
        TopicRecord storage record = _requireTopicExists(topicId);
        if (_executionAuthenticated[topicId]) {
            revert ExecutionSnapshotAlreadyAuthenticated(topicId);
        }
        snapshotExecutionRoot = _authenticateAndStoreExecutionRoot(
            topicId,
            record,
            rlpExecutionHeader
        );
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function authenticateBeaconSnapshot(
        uint256 topicId,
        BeaconSnapshotAuthProof calldata proof
    )
        external
        override
        nonReentrant
        returns (bytes32 snapshotBeaconRoot, uint64 snapshotEpoch)
    {
        TopicRecord storage record = _requireTopicExists(topicId);
        if (_beaconAuthenticated[topicId]) {
            revert BeaconSnapshotAlreadyAuthenticated(topicId);
        }
        (snapshotBeaconRoot, snapshotEpoch) = _authenticateAndStoreBeaconRoot(
            topicId,
            record,
            proof
        );
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function voteWithExecutionBalance(
        uint256 topicId,
        uint32 optionIndex,
        bytes calldata rlpExecutionHeader,
        bytes calldata rlpAccountProofNodes
    ) external override nonReentrant returns (uint256 weightWei) {
        TopicRecord storage record = _validateOpenVoteTarget(topicId, optionIndex);

        bytes32 executionRoot = _ensureExecutionSnapshotAuthenticated(
            topicId,
            record,
            rlpExecutionHeader
        );

        weightWei = _processExecutionBalanceClaim(
            topicId,
            optionIndex,
            msg.sender,
            executionRoot,
            rlpAccountProofNodes
        );

        _directVoteCount[topicId] += 1;

        emit DirectVoteCast(topicId, msg.sender, optionIndex, weightWei, weightWei, 0, 1);
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function voteWithBeaconStake(
        uint256 topicId,
        uint32 optionIndex,
        BeaconSnapshotAuthProof calldata beaconAuth,
        ValidatorStakeProof[] calldata validatorProofs
    ) external override nonReentrant returns (uint256 totalStakeWei) {
        if (validatorProofs.length == 0) {
            revert EmptyDirectVoteProof();
        }
        TopicRecord storage record = _validateOpenVoteTarget(topicId, optionIndex);

        (bytes32 beaconRoot, uint64 snapshotEpoch) = _ensureBeaconSnapshotAuthenticated(
            topicId,
            record,
            beaconAuth
        );

        totalStakeWei = _processValidatorStakeClaims(
            topicId,
            optionIndex,
            msg.sender,
            beaconRoot,
            snapshotEpoch,
            validatorProofs
        );

        _directVoteCount[topicId] += 1;

        emit DirectVoteCast(
            topicId,
            msg.sender,
            optionIndex,
            totalStakeWei,
            0,
            totalStakeWei,
            validatorProofs.length
        );
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function voteDirect(
        uint256 topicId,
        uint32 optionIndex,
        DirectVoteProofBundle calldata bundle
    ) external override nonReentrant returns (uint256 totalWeightWei) {
        uint256 valCount = bundle.validatorProofs.length;
        if (!bundle.includeExecutionBalance && valCount == 0) {
            revert EmptyDirectVoteProof();
        }

        TopicRecord storage record = _validateOpenVoteTarget(topicId, optionIndex);

        uint256 executionWeightWei = 0;
        uint256 beaconWeightWei = 0;
        uint256 positionsCounted = 0;

        if (bundle.includeExecutionBalance) {
            bytes32 executionRoot = _ensureExecutionSnapshotAuthenticated(
                topicId,
                record,
                bundle.rlpExecutionHeader
            );
            executionWeightWei = _processExecutionBalanceClaim(
                topicId,
                optionIndex,
                msg.sender,
                executionRoot,
                bundle.rlpAccountProofNodes
            );
            positionsCounted += 1;
        }

        if (valCount > 0) {
            (bytes32 beaconRoot, uint64 snapshotEpoch) = _ensureBeaconSnapshotAuthenticated(
                topicId,
                record,
                bundle.beaconAuth
            );
            beaconWeightWei = _processValidatorStakeClaims(
                topicId,
                optionIndex,
                msg.sender,
                beaconRoot,
                snapshotEpoch,
                bundle.validatorProofs
            );
            positionsCounted += valCount;
        }

        totalWeightWei = executionWeightWei + beaconWeightWei;
        _directVoteCount[topicId] += 1;

        emit DirectVoteCast(
            topicId,
            msg.sender,
            optionIndex,
            totalWeightWei,
            executionWeightWei,
            beaconWeightWei,
            positionsCounted
        );
    }

    // -------------------------------------------------------------------------
    // Views (Stage 1 + Stage 2)
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopic(uint256 topicId) external view override returns (TopicView memory) {
        TopicRecord storage record = _requireTopicExists(topicId);
        return _buildTopicView(topicId, record);
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopicOptions(uint256 topicId) external view override returns (string[] memory) {
        _requireTopicExists(topicId);
        return _topicOptions[topicId];
    }

    /**
     * @inheritdoc ITopicRegistry
     */
    function getTopics(
        uint256 offset,
        uint256 limit
    ) external view override returns (TopicView[] memory page) {
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
            uint256 topicId = offset + i + 1;
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

    /**
     * @inheritdoc IDirectVoting
     */
    function getSnapshotState(
        uint256 topicId
    ) external view override returns (SnapshotStateView memory) {
        TopicRecord storage record = _requireTopicExists(topicId);
        return
            SnapshotStateView({
                snapshotBlock: record.snapshotBlock,
                snapshotBlockHash: record.snapshotBlockHash,
                snapshotBeaconBlockRoot: _snapshotBeaconBlockRoots[topicId],
                snapshotExecutionRoot: _snapshotExecutionRoots[topicId],
                snapshotBeaconRoot: _snapshotBeaconRoots[topicId],
                snapshotEpoch: _snapshotEpochs[topicId],
                executionAuthenticated: _executionAuthenticated[topicId],
                beaconAuthenticated: _beaconAuthenticated[topicId]
            });
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function getTopicTallies(
        uint256 topicId
    ) external view override returns (TopicTallyView memory) {
        TopicRecord storage record = _requireTopicExists(topicId);
        uint32 optCount = record.optionCount;

        uint256[] memory weights = new uint256[](optCount);
        uint256[] memory counts = new uint256[](optCount);
        for (uint32 i = 0; i < optCount; i++) {
            weights[i] = _optionWeightsWei[topicId][i];
            counts[i] = _optionPositionCounts[topicId][i];
        }

        return
            TopicTallyView({
                topicId: topicId,
                optionWeightsWei: weights,
                optionPositionCounts: counts,
                totalWeightWei: _totalWeightWei[topicId],
                totalCountedPositions: _totalCountedPositions[topicId],
                directVoteCount: _directVoteCount[topicId]
            });
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function getPositionReceipt(
        uint256 topicId,
        bytes32 positionKey
    ) external view override returns (PositionReceipt memory) {
        _requireTopicExists(topicId);
        return _positionReceipts[topicId][positionKey];
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function hasWalletVoted(
        uint256 topicId,
        address account
    ) external view override returns (bool) {
        _requireTopicExists(topicId);
        bytes32 key = PositionEligibility.computeWalletPositionKey(block.chainid, account);
        return _positionReceipts[topicId][key].claimed;
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function hasValidatorVoted(
        uint256 topicId,
        uint64 validatorIndex
    ) external view override returns (bool) {
        _requireTopicExists(topicId);
        bytes32 key = PositionEligibility.computeValidatorPositionKey(
            block.chainid,
            validatorIndex
        );
        return _positionReceipts[topicId][key].claimed;
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function computeWalletPositionKey(address account) external view override returns (bytes32) {
        return PositionEligibility.computeWalletPositionKey(block.chainid, account);
    }

    /**
     * @inheritdoc IDirectVoting
     */
    function computeValidatorPositionKey(
        uint64 validatorIndex
    ) external view override returns (bytes32) {
        return PositionEligibility.computeValidatorPositionKey(block.chainid, validatorIndex);
    }

    // -------------------------------------------------------------------------
    // Internal Helpers
    // -------------------------------------------------------------------------

    function _requireTopicExists(
        uint256 topicId
    ) internal view returns (TopicRecord storage record) {
        record = _topics[topicId];
        if (record.creator == address(0)) {
            revert TopicNotFound(topicId);
        }
    }

    function _validateOpenVoteTarget(
        uint256 topicId,
        uint32 optionIndex
    ) internal view returns (TopicRecord storage record) {
        record = _requireTopicExists(topicId);
        TopicPhase phase = getPhase(topicId);
        if (phase != TopicPhase.Open) {
            revert InvalidTopicPhase(phase, TopicPhase.Open);
        }
        if (optionIndex >= record.optionCount) {
            revert InvalidOptionIndex(optionIndex, record.optionCount);
        }
    }

    function _ensureExecutionSnapshotAuthenticated(
        uint256 topicId,
        TopicRecord storage record,
        bytes calldata rlpExecutionHeader
    ) internal returns (bytes32 executionRoot) {
        if (_executionAuthenticated[topicId]) {
            return _snapshotExecutionRoots[topicId];
        }
        if (rlpExecutionHeader.length == 0) {
            revert ExecutionSnapshotNotAuthenticated(topicId);
        }
        executionRoot = _authenticateAndStoreExecutionRoot(topicId, record, rlpExecutionHeader);
    }

    function _authenticateAndStoreExecutionRoot(
        uint256 topicId,
        TopicRecord storage record,
        bytes calldata rlpExecutionHeader
    ) internal returns (bytes32 executionRoot) {
        bytes32 canonicalHash;
        (canonicalHash, executionRoot) = SnapshotAuthenticator.authenticateExecutionHeader(
            record.snapshotBlock,
            record.snapshotBlockHash,
            rlpExecutionHeader
        );
        _snapshotExecutionRoots[topicId] = executionRoot;
        _executionAuthenticated[topicId] = true;

        emit ExecutionSnapshotAuthenticated(
            topicId,
            record.snapshotBlock,
            canonicalHash,
            executionRoot
        );
    }

    function _ensureBeaconSnapshotAuthenticated(
        uint256 topicId,
        TopicRecord storage record,
        BeaconSnapshotAuthProof calldata beaconAuth
    ) internal returns (bytes32 beaconRoot, uint64 snapshotEpoch) {
        if (_beaconAuthenticated[topicId]) {
            return (_snapshotBeaconRoots[topicId], _snapshotEpochs[topicId]);
        }
        if (beaconAuth.beaconStateRoot == bytes32(0)) {
            revert BeaconSnapshotNotAuthenticated(topicId);
        }
        return _authenticateAndStoreBeaconRoot(topicId, record, beaconAuth);
    }

    function _authenticateAndStoreBeaconRoot(
        uint256 topicId,
        TopicRecord storage record,
        BeaconSnapshotAuthProof calldata proof
    ) internal returns (bytes32 beaconRoot, uint64 snapshotEpoch) {
        bytes32 canonicalBeaconBlockRoot;
        (canonicalBeaconBlockRoot, beaconRoot, snapshotEpoch) = SnapshotAuthenticator
            .authenticateBeaconSnapshot(
                record.snapshotBlock,
                record.snapshotBlockHash,
                _snapshotBeaconBlockRoots[topicId],
                proof
            );

        if (_snapshotBeaconBlockRoots[topicId] == bytes32(0)) {
            _snapshotBeaconBlockRoots[topicId] = canonicalBeaconBlockRoot;
        }
        _snapshotBeaconRoots[topicId] = beaconRoot;
        _snapshotEpochs[topicId] = snapshotEpoch;
        _beaconAuthenticated[topicId] = true;

        emit BeaconSnapshotAuthenticated(
            topicId,
            canonicalBeaconBlockRoot,
            beaconRoot,
            proof.beaconSlot,
            snapshotEpoch
        );
    }

    function _processExecutionBalanceClaim(
        uint256 topicId,
        uint32 optionIndex,
        address voter,
        bytes32 executionRoot,
        bytes calldata rlpAccountProofNodes
    ) internal returns (uint256 weightWei) {
        bytes32 walletKey = PositionEligibility.computeWalletPositionKey(block.chainid, voter);
        if (_positionReceipts[topicId][walletKey].claimed) {
            revert PositionAlreadyVoted(topicId, walletKey);
        }

        weightWei = PositionEligibility.verifyExecutionBalanceProof(
            executionRoot,
            voter,
            rlpAccountProofNodes
        );

        _recordPositionVote(
            topicId,
            walletKey,
            PositionType.ExecutionWallet,
            0,
            voter,
            optionIndex,
            weightWei
        );
    }

    function _processValidatorStakeClaims(
        uint256 topicId,
        uint32 optionIndex,
        address voter,
        bytes32 beaconRoot,
        uint64 snapshotEpoch,
        ValidatorStakeProof[] calldata validatorProofs
    ) internal returns (uint256 totalStakeWei) {
        uint256 len = validatorProofs.length;
        for (uint256 i = 0; i < len; i++) {
            ValidatorStakeProof calldata vp = validatorProofs[i];
            bytes32 validatorKey = PositionEligibility.computeValidatorPositionKey(
                block.chainid,
                vp.validatorIndex
            );
            if (_positionReceipts[topicId][validatorKey].claimed) {
                revert PositionAlreadyVoted(topicId, validatorKey);
            }

            uint256 stakeWei = PositionEligibility.verifyValidatorStakeProof(
                beaconRoot,
                snapshotEpoch,
                voter,
                vp
            );

            _recordPositionVote(
                topicId,
                validatorKey,
                PositionType.BeaconValidator,
                vp.validatorIndex,
                voter,
                optionIndex,
                stakeWei
            );

            totalStakeWei += stakeWei;
        }
    }

    function _recordPositionVote(
        uint256 topicId,
        bytes32 positionKey,
        PositionType positionType,
        uint64 validatorIndex,
        address voter,
        uint32 optionIndex,
        uint256 weightWei
    ) internal {
        _positionReceipts[topicId][positionKey] = PositionReceipt({
            claimed: true,
            positionType: positionType,
            voter: voter,
            optionIndex: optionIndex,
            weightWei: weightWei
        });

        _optionWeightsWei[topicId][optionIndex] += weightWei;
        _optionPositionCounts[topicId][optionIndex] += 1;
        _totalWeightWei[topicId] += weightWei;
        _totalCountedPositions[topicId] += 1;

        emit PositionCounted(
            topicId,
            positionKey,
            voter,
            positionType,
            validatorIndex,
            optionIndex,
            weightWei
        );
    }

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
        // casting to 'uint32' is safe because TopicValidation enforces options.length <= 16
        // forge-lint: disable-next-line(unsafe-typecast)
        record.optionCount = uint32(options.length);
        record.snapshotBlockHash = snapshotBlockHash;
        record.contentHash = contentHash;
        record.paymentToken = paymentToken;
        record.pricePerVote = frozenPricePerVote;

        bytes32 parentBeaconRoot = SnapshotAuthenticator.tryReadParentBeaconRoot(createdAt);
        if (parentBeaconRoot != bytes32(0)) {
            _snapshotBeaconBlockRoots[topicId] = parentBeaconRoot;
        }

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

    function _buildTopicView(
        uint256 topicId,
        TopicRecord storage record
    ) internal view returns (TopicView memory) {
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
