// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/ITherdal.sol";
import "./BatchRegistry.sol";
import "./SponsorEscrow.sol";
import "./StarkVerifierAdapter.sol";
import "./TherdalController.sol";
import "./libraries/SnapshotAuthenticator.sol";

/**
 * @title Therdal
 * @notice Ethereum-native, ETH-weighted public resolutions protocol (v0.2):
 *         - Mandatory $100 USD stablecoin creation deposit ($10 nonrefundable dev fee + $90 settlement escrow).
 *         - Controlled by `TherdalController` smart account (initially 1 signer, upgradable to DAO).
 *         - Permissionless EIP-4844 blob publication & permissionless non-sequential STARK batch settlement.
 *         - 25% Developer / 25% Submitter / 50% Prover fee split per newly accepted valid vote.
 *         - Settlement grace period & pro-rata pull refunds (`floor(U * c_i / C)`).
 */
contract Therdal is ITherdal, BatchRegistry, SponsorEscrow {
    /// @notice Supported protocol ruleset version
    uint32 public constant RULESET_VERSION_V1 = 1;

    /// @notice Pinned STARK verifier adapter
    StarkVerifierAdapter public immutable verifierAdapter;

    /// @notice Smart-account controller & pricing authority (replaceable by itself for DAO migration)
    TherdalController public controller;

    /// @notice Total resolutions created (`resolutionId` is 1-indexed)
    uint256 public resolutionCount;

    /// @notice Stored state per resolution
    mapping(uint256 => ResolutionState) internal _resolutions;

    /// @notice Stored question URI per resolution
    mapping(uint256 => string) public resolutionQuestionURI;

    uint256 private _locked = 1;

    event ControllerReplaced(address indexed previousController, address indexed newController);

    error UnauthorizedController(address caller);

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANCY");
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(
        address _controller,
        address _verifierAdapter,
        address _blobHashReader
    ) BatchRegistry(_blobHashReader) {
        require(_controller != address(0), "ZERO_CONTROLLER");
        require(_verifierAdapter != address(0), "ZERO_VERIFIER");
        controller = TherdalController(payable(_controller));
        verifierAdapter = StarkVerifierAdapter(_verifierAdapter);
    }

    /**
     * @notice Allows the current `TherdalController` smart account (or DAO) to migrate to a new controller contract.
     */
    function replaceController(address newController) external {
        if (msg.sender != address(controller)) {
            revert UnauthorizedController(msg.sender);
        }
        require(newController != address(0), "ZERO_CONTROLLER");
        address prev = address(controller);
        controller = TherdalController(payable(newController));
        emit ControllerReplaced(prev, newController);
    }

    // -------------------------------------------------------------------------
    // 1. Paid Resolution Creation ($100 = $10 Fee + $90 Escrow) & Sponsorship
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITherdal
     */
    function createResolution(ResolutionConfig calldata config)
        external
        override
        nonReentrant
        returns (uint256 resolutionId)
    {
        if (config.rulesetVersion != RULESET_VERSION_V1) {
            revert InvalidRulesetVersion(config.rulesetVersion);
        }
        if (config.snapshotBlockNumber == 0 || config.snapshotBlockNumber >= block.number) {
            revert InvalidSnapshotBlock(config.snapshotBlockNumber, uint64(block.number));
        }

        uint64 start = config.votingStartsAt == 0 ? uint64(block.timestamp) : config.votingStartsAt;
        if (
            start < block.timestamp ||
            config.votingEndsAt <= start ||
            config.settlementDeadline <= config.votingEndsAt
        ) {
            revert InvalidTimeWindow(start, config.votingEndsAt, config.settlementDeadline);
        }

        (
            address paymentToken,
            ,
            uint256 creationFee,
            uint256 initialEscrow,
            uint256 frozenPricePerVote,
            address devRecipient
        ) = controller.quoteResolutionTerms(config.paymentToken);

        resolutionId = ++resolutionCount;
        resolutionQuestionURI[resolutionId] = config.questionURI;

        ResolutionState storage state = _resolutions[resolutionId];
        state.snapshotBlockNumber = config.snapshotBlockNumber;
        state.snapshotBeaconTimestamp = config.snapshotBeaconTimestamp;
        state.snapshotEpoch = config.snapshotEpoch;
        state.votingStartsAt = start;
        state.votingEndsAt = config.votingEndsAt;
        state.settlementDeadline = config.settlementDeadline;
        state.creator = msg.sender;
        state.paymentToken = paymentToken;
        state.pricePerVote = frozenPricePerVote;
        state.rulesetVersion = config.rulesetVersion;

        uint256 creditedEscrow = _collectCreationDepositAndEscrow(
            resolutionId,
            msg.sender,
            paymentToken,
            devRecipient,
            creationFee,
            initialEscrow,
            config.extraSponsorAmount
        );

        emit ResolutionCreated(
            resolutionId,
            msg.sender,
            paymentToken,
            config.snapshotBlockNumber,
            config.snapshotBeaconTimestamp,
            start,
            config.votingEndsAt,
            config.settlementDeadline,
            config.rulesetVersion,
            creationFee,
            creditedEscrow,
            frozenPricePerVote,
            config.questionURI
        );
    }

    /**
     * @inheritdoc ITherdal
     */
    function sponsor(uint256 resolutionId, uint256 amount) external override nonReentrant {
        if (amount == 0) {
            revert ZeroSponsorshipAmount();
        }
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        ResolutionPhase phase = getPhase(resolutionId);
        if (phase == ResolutionPhase.Finalized || phase == ResolutionPhase.ClosedForRefunds) {
            revert InvalidPhase(phase, ResolutionPhase.Open);
        }

        _collectSponsorship(resolutionId, msg.sender, state.paymentToken, amount);
    }

    // -------------------------------------------------------------------------
    // 2. Snapshot Authentication (Pinned at Creation, Authenticated On-Chain)
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITherdal
     */
    function authenticateSnapshot(uint256 resolutionId, SnapshotAuthProof calldata proof)
        external
        override
    {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        if (state.snapshotAuthenticated) {
            revert SnapshotAlreadyAuthenticated(resolutionId);
        }
        if (state.finalized || state.settlementClosed) {
            revert InvalidPhase(getPhase(resolutionId), ResolutionPhase.Settling);
        }

        (
            bytes32 executionBlockHash,
            bytes32 snapshotExecutionRoot,
            bytes32 snapshotBeaconRoot
        ) = SnapshotAuthenticator.authenticate(
                state.snapshotBlockNumber,
                state.snapshotBeaconTimestamp,
                proof
            );

        state.snapshotExecutionRoot = snapshotExecutionRoot;
        state.snapshotBeaconRoot = snapshotBeaconRoot;
        state.snapshotAuthenticated = true;

        emit SnapshotAuthenticated(
            resolutionId,
            executionBlockHash,
            snapshotExecutionRoot,
            snapshotBeaconRoot
        );
    }

    // -------------------------------------------------------------------------
    // 3. Permissionless EIP-4844 Batch Publication
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITherdal
     */
    function publishBatch(uint256 resolutionId, uint8 blobCount)
        external
        override
        nonReentrant
        returns (uint256 batchId)
    {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }

        ResolutionPhase phase = getPhase(resolutionId);
        if (phase != ResolutionPhase.Open) {
            revert InvalidPhase(phase, ResolutionPhase.Open);
        }

        batchId = state.nextBatchId++;
        (bytes32 commitmentRoot, bytes32[] memory blobHashes) = _registerBatch(
            resolutionId,
            batchId,
            msg.sender,
            blobCount
        );

        emit BatchPublished(resolutionId, batchId, msg.sender, commitmentRoot, blobHashes);
    }

    // -------------------------------------------------------------------------
    // 4. Permissionless Non-Sequential Batch Settlement & 25/25/50 Fee Split
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITherdal
     */
    function settleBatch(
        uint256 resolutionId,
        uint256 batchId,
        bytes32 newPositionRoot,
        uint256[3] calldata newTallies,
        uint256 newCountedPositions,
        uint256 newlyAcceptedVoteCount,
        bytes calldata proof
    ) external override nonReentrant {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }

        ResolutionPhase phase = getPhase(resolutionId);
        if (phase != ResolutionPhase.Settling) {
            revert InvalidPhase(phase, ResolutionPhase.Settling);
        }
        if (!state.snapshotAuthenticated) {
            revert SnapshotNotAuthenticated(resolutionId);
        }

        if (batchId >= state.nextBatchId) {
            revert BatchOutOfRange(batchId, state.nextBatchId);
        }

        BatchRecord storage batch = _batches[resolutionId][batchId];
        if (batch.settled) {
            revert BatchAlreadySettled(resolutionId, batchId);
        }

        uint256 oldCountedPositions = state.countedPositions;
        if (newCountedPositions < oldCountedPositions) {
            revert InvalidCountedPositionsTransition(oldCountedPositions, newCountedPositions);
        }

        uint256 newlyCounted = newCountedPositions - oldCountedPositions;
        if (newlyAcceptedVoteCount > newlyCounted) {
            revert InvalidAcceptedVoteCount(newlyAcceptedVoteCount, newlyCounted);
        }

        uint256[3] memory oldTallies = state.tallies;
        for (uint256 i = 0; i < 3; i++) {
            if (newTallies[i] < oldTallies[i]) {
                revert InvalidTallyTransition(i, oldTallies[i], newTallies[i]);
            }
        }

        bytes32 oldPositionRoot = state.positionRoot;

        BatchPublicInputs memory publicInputs = BatchPublicInputs({
            chainId: block.chainid,
            resolutionId: resolutionId,
            rulesetVersion: state.rulesetVersion,
            snapshotExecutionRoot: state.snapshotExecutionRoot,
            snapshotBeaconRoot: state.snapshotBeaconRoot,
            batchId: batchId,
            registeredBatchCommitment: batch.commitmentRoot,
            oldPositionRoot: oldPositionRoot,
            newPositionRoot: newPositionRoot,
            oldTallies: oldTallies,
            newTallies: [newTallies[0], newTallies[1], newTallies[2]],
            oldCountedPositions: oldCountedPositions,
            newCountedPositions: newCountedPositions,
            newlyAcceptedVoteCount: newlyAcceptedVoteCount
        });

        if (!verifierAdapter.verifyBatchTransition(publicInputs, proof)) {
            revert InvalidSettlementProof();
        }

        // Atomic state transition before ERC-20 reward payouts (CEI)
        state.positionRoot = newPositionRoot;
        state.tallies[0] = newTallies[0];
        state.tallies[1] = newTallies[1];
        state.tallies[2] = newTallies[2];
        state.countedPositions = newCountedPositions;
        state.acceptedVotes += newlyAcceptedVoteCount;
        state.settledBatchCount += 1;

        batch.settled = true;
        batch.newlyCountedPositions = newlyCounted;
        batch.newlyAcceptedVotes = newlyAcceptedVoteCount;
        address submitter = batch.submitter;

        // Charge `newlyAcceptedVoteCount * state.pricePerVote` (reverts if > remainingEscrow)
        // and disburse 25% Developer (TherdalController) / 25% Submitter / 50% Prover
        (uint256 devShare, uint256 submitterShare, uint256 proverShare) = _disburseSettlementFeeSplit(
            resolutionId,
            state.paymentToken,
            controller.developerRecipient(),
            submitter,
            msg.sender,
            newlyAcceptedVoteCount,
            state.pricePerVote
        );

        emit BatchSettled(
            resolutionId,
            batchId,
            msg.sender,
            submitter,
            oldPositionRoot,
            newPositionRoot,
            [newTallies[0], newTallies[1], newTallies[2]],
            newlyCounted,
            newlyAcceptedVoteCount,
            devShare,
            submitterShare,
            proverShare
        );
    }

    // -------------------------------------------------------------------------
    // 5. Finalization, Settlement Grace Closure & Pro-Rata Pull Refunds
    // -------------------------------------------------------------------------

    /**
     * @inheritdoc ITherdal
     */
    function finalizeResolution(uint256 resolutionId) external override nonReentrant {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }

        ResolutionPhase phase = getPhase(resolutionId);
        if (phase != ResolutionPhase.Settling) {
            revert InvalidPhase(phase, ResolutionPhase.Settling);
        }
        if (state.settledBatchCount != state.nextBatchId) {
            revert BatchesRemainingToSettle(state.settledBatchCount, state.nextBatchId);
        }

        state.finalized = true;
        state.settlementClosed = true;
        uint256 unusedEscrow = _freezeEscrowForRefunds(resolutionId);

        emit ResolutionFinalized(
            resolutionId,
            state.positionRoot,
            state.tallies,
            state.countedPositions,
            state.acceptedVotes,
            state.settledBatchCount,
            unusedEscrow
        );
    }

    /**
     * @inheritdoc ITherdal
     */
    function closeSettlementAndEnableRefunds(uint256 resolutionId) external override nonReentrant {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        if (state.finalized || state.settlementClosed) {
            revert InvalidPhase(getPhase(resolutionId), ResolutionPhase.Settling);
        }
        if (block.timestamp <= state.settlementDeadline) {
            revert SettlementDeadlineNotReached(uint64(block.timestamp), state.settlementDeadline);
        }

        state.settlementClosed = true;
        if (state.settledBatchCount == state.nextBatchId) {
            state.finalized = true;
        }
        uint256 unusedEscrow = _freezeEscrowForRefunds(resolutionId);

        emit SettlementClosedAndRefundsEnabled(
            resolutionId,
            state.settledBatchCount,
            state.nextBatchId,
            unusedEscrow
        );
    }

    /**
     * @inheritdoc ITherdal
     */
    function claimRefund(uint256 resolutionId)
        external
        override
        nonReentrant
        returns (uint256 refundAmount)
    {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        return _processRefundClaim(resolutionId, state.paymentToken, msg.sender);
    }

    // -------------------------------------------------------------------------
    // 6. Views
    // -------------------------------------------------------------------------

    function getResolution(uint256 resolutionId) external view returns (ResolutionState memory) {
        if (_resolutions[resolutionId].creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        return _resolutions[resolutionId];
    }

    function getTallies(uint256 resolutionId)
        external
        view
        returns (
            uint256 yesWei,
            uint256 noWei,
            uint256 abstainWei,
            uint256 countedPositions,
            uint256 acceptedVotes
        )
    {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            revert ResolutionNotFound(resolutionId);
        }
        return (
            state.tallies[0],
            state.tallies[1],
            state.tallies[2],
            state.countedPositions,
            state.acceptedVotes
        );
    }

    function getPhase(uint256 resolutionId) public view returns (ResolutionPhase) {
        ResolutionState storage state = _resolutions[resolutionId];
        if (state.creator == address(0)) {
            return ResolutionPhase.None;
        }
        if (state.finalized) {
            return ResolutionPhase.Finalized;
        }
        if (state.settlementClosed) {
            return ResolutionPhase.ClosedForRefunds;
        }
        if (block.timestamp <= state.votingEndsAt) {
            if (block.timestamp >= state.votingStartsAt) {
                return ResolutionPhase.Open;
            }
            return ResolutionPhase.None;
        }
        return ResolutionPhase.Settling;
    }
}
