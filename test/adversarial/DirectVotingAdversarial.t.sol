// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../../contracts/interfaces/IDirectVoting.sol";
import {ITopicRegistry} from "../../contracts/interfaces/ITopicRegistry.sol";
import {MerklePatriciaProofVerifier} from "../../contracts/libraries/MerklePatriciaProofVerifier.sol";
import {RLPReader} from "../../contracts/libraries/RLPReader.sol";
import {SnapshotAuthenticator} from "../../contracts/libraries/SnapshotAuthenticator.sol";
import {TherdalController} from "../../contracts/TherdalController.sol";
import {Therdal} from "../../contracts/Therdal.sol";
import {Vm, MockStablecoin} from "../helpers/TestHelpers.sol";
import {
    MockSystemRootOracle,
    RlpEncoderHelper,
    BeaconSszTestBuilder
} from "../helpers/ProofTestHelpers.sol";

/**
 * @title DirectVotingAdversarialTest
 * @notice Adversarial, malformed-input, replay, and security boundary tests for Stage 2 Direct Voting.
 */
contract DirectVotingAdversarialTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant EIP4788_ADDR = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    MockStablecoin internal usdc;
    TherdalController internal controller;
    Therdal internal therdal;
    MockSystemRootOracle internal beaconOracle;

    address internal operator = address(0xD00D);
    address internal alice = 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A;
    address internal bob = 0x1563915e194D8CfBA1943570603F7606A3115508;

    uint64 internal constant INITIAL_TIMESTAMP = 1_760_000_000;
    uint64 internal constant INITIAL_BLOCK = 21_500_000;
    uint64 internal constant SNAPSHOT_BLOCK = INITIAL_BLOCK - 1;
    uint64 internal constant SNAPSHOT_SLOT = 10_240_000; // Epoch 320,000

    function setUp() public {
        VM.chainId(1);
        VM.roll(INITIAL_BLOCK);
        VM.warp(INITIAL_TIMESTAMP);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        controller = new TherdalController(operator, address(usdc), 6);
        therdal = new Therdal(address(controller));

        MockSystemRootOracle impl = new MockSystemRootOracle();
        VM.etch(EIP4788_ADDR, address(impl).code);
        beaconOracle = MockSystemRootOracle(EIP4788_ADDR);
    }

    // -------------------------------------------------------------------------
    // 1. Replay & Double-Voting Prevention (Wallet & Validator Positions)
    // -------------------------------------------------------------------------

    function test_RevertOnWalletAndValidatorPositionReplay() public {
        (bytes32 stateRoot, bytes memory aliceProof) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            1,
            15 ether
        );
        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        BeaconSszTestBuilder.ValidatorFixture memory val = _validAliceValidator(7);
        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory beaconAuth,
            IDirectVoting.ValidatorStakeProof memory valProof
        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_SLOT,
                INITIAL_TIMESTAMP,
                100,
                val,
                false
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        uint256 topicId = _createDefaultTopic();

        // First wallet vote succeeds
        VM.prank(alice);
        therdal.voteWithExecutionBalance(topicId, 0, rlpHeader, aliceProof);

        // Second wallet vote on same or different option reverts with PositionAlreadyVoted
        bytes32 aliceWalletKey = therdal.computeWalletPositionKey(alice);
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(
                IDirectVoting.PositionAlreadyVoted.selector,
                topicId,
                aliceWalletKey
            )
        );
        therdal.voteWithExecutionBalance(topicId, 1, "", aliceProof);

        // Duplicate validator index inside a single call reverts atomically
        IDirectVoting.ValidatorStakeProof[]
            memory dupProofs = new IDirectVoting.ValidatorStakeProof[](2);
        dupProofs[0] = valProof;
        dupProofs[1] = valProof;

        bytes32 valKey = therdal.computeValidatorPositionKey(7);
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(IDirectVoting.PositionAlreadyVoted.selector, topicId, valKey)
        );
        therdal.voteWithBeaconStake(topicId, 0, beaconAuth, dupProofs);

        // Valid single validator vote succeeds, then replay via voteDirect reverts
        IDirectVoting.ValidatorStakeProof[]
            memory singleProof = new IDirectVoting.ValidatorStakeProof[](1);
        singleProof[0] = valProof;
        VM.prank(alice);
        therdal.voteWithBeaconStake(topicId, 0, beaconAuth, singleProof);

        IDirectVoting.DirectVoteProofBundle memory replayBundle = IDirectVoting
            .DirectVoteProofBundle({
                includeExecutionBalance: false,
                rlpExecutionHeader: "",
                rlpAccountProofNodes: "",
                beaconAuth: beaconAuth,
                validatorProofs: singleProof
            });
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(IDirectVoting.PositionAlreadyVoted.selector, topicId, valKey)
        );
        therdal.voteDirect(topicId, 1, replayBundle);
    }

    // -------------------------------------------------------------------------
    // 2. Validator Index Substitution, Slashing, Inactive Epoch & Bad Credentials
    // -------------------------------------------------------------------------

    function test_RevertOnValidatorIndexSubstitutionAndIneligibleValidators() public {
        (bytes32 stateRoot, ) = RlpEncoderHelper.buildSingleAccountTrie(alice, 0, 1 ether);
        (, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        // Case A: Validator index substitution attack (proof for index 7 submitted as index 8)
        {
            BeaconSszTestBuilder.ValidatorFixture memory v = _validAliceValidator(7);
            (
                bytes32 bRoot,
                IDirectVoting.BeaconSnapshotAuthProof memory bAuth,
                IDirectVoting.ValidatorStakeProof memory vProof
            ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                    snapshotHash,
                    SNAPSHOT_SLOT,
                    INITIAL_TIMESTAMP,
                    100,
                    v,
                    false
                );
            beaconOracle.setRoot(INITIAL_TIMESTAMP, bRoot);
            uint256 topicA = _createDefaultTopic();

            vProof.validatorIndex = 8; // Tamper index to forge a fresh validatorKey
            IDirectVoting.ValidatorStakeProof[]
                memory arr = new IDirectVoting.ValidatorStakeProof[](1);
            arr[0] = vProof;

            VM.prank(alice);
            VM.expectRevert(
                abi.encodeWithSelector(IDirectVoting.InvalidValidatorProof.selector, uint64(8))
            );
            therdal.voteWithBeaconStake(topicA, 0, bAuth, arr);
        }

        // Case B: Slashed validator rejected
        {
            BeaconSszTestBuilder.ValidatorFixture memory slashedVal = _validAliceValidator(3);
            slashedVal.slashed = true;
            (
                bytes32 bRoot,
                IDirectVoting.BeaconSnapshotAuthProof memory bAuth,
                IDirectVoting.ValidatorStakeProof memory vProof
            ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                    snapshotHash,
                    SNAPSHOT_SLOT,
                    INITIAL_TIMESTAMP,
                    100,
                    slashedVal,
                    false
                );
            beaconOracle.setRoot(INITIAL_TIMESTAMP, bRoot);
            uint256 topicB = _createDefaultTopic();

            IDirectVoting.ValidatorStakeProof[]
                memory arr = new IDirectVoting.ValidatorStakeProof[](1);
            arr[0] = vProof;

            VM.prank(alice);
            VM.expectRevert(
                abi.encodeWithSelector(IDirectVoting.ValidatorSlashed.selector, uint64(3))
            );
            therdal.voteWithBeaconStake(topicB, 0, bAuth, arr);
        }

        // Case C: Exited validator (`exitEpoch == snapshotEpoch == 320,000`) rejected
        {
            BeaconSszTestBuilder.ValidatorFixture memory exitedVal = _validAliceValidator(4);
            exitedVal.exitEpoch = 320_000;
            (
                bytes32 bRoot,
                IDirectVoting.BeaconSnapshotAuthProof memory bAuth,
                IDirectVoting.ValidatorStakeProof memory vProof
            ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                    snapshotHash,
                    SNAPSHOT_SLOT,
                    INITIAL_TIMESTAMP,
                    100,
                    exitedVal,
                    false
                );
            beaconOracle.setRoot(INITIAL_TIMESTAMP, bRoot);
            uint256 topicC = _createDefaultTopic();

            IDirectVoting.ValidatorStakeProof[]
                memory arr = new IDirectVoting.ValidatorStakeProof[](1);
            arr[0] = vProof;

            VM.prank(alice);
            VM.expectRevert(
                abi.encodeWithSelector(
                    IDirectVoting.ValidatorNotActiveAtSnapshot.selector,
                    uint64(4),
                    exitedVal.activationEpoch,
                    uint64(320_000),
                    uint64(320_000)
                )
            );
            therdal.voteWithBeaconStake(topicC, 0, bAuth, arr);
        }

        // Case D: Legacy 0x00 BLS withdrawal prefix & wrong withdrawal address rejected
        {
            BeaconSszTestBuilder.ValidatorFixture memory blsVal = _validAliceValidator(5);
            blsVal.withdrawalCredentials = BeaconSszTestBuilder.blsWithdrawalCredentials(
                keccak256("bls_key")
            );
            (
                bytes32 bRoot,
                IDirectVoting.BeaconSnapshotAuthProof memory bAuth,
                IDirectVoting.ValidatorStakeProof memory vProof
            ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                    snapshotHash,
                    SNAPSHOT_SLOT,
                    INITIAL_TIMESTAMP,
                    100,
                    blsVal,
                    false
                );
            beaconOracle.setRoot(INITIAL_TIMESTAMP, bRoot);
            uint256 topicD = _createDefaultTopic();

            IDirectVoting.ValidatorStakeProof[]
                memory arr = new IDirectVoting.ValidatorStakeProof[](1);
            arr[0] = vProof;

            VM.prank(alice);
            VM.expectRevert(
                abi.encodeWithSelector(
                    IDirectVoting.UnsupportedWithdrawalPrefix.selector,
                    uint64(5),
                    uint8(0x00)
                )
            );
            therdal.voteWithBeaconStake(topicD, 0, bAuth, arr);

            // Bob tries to vote using Alice's valid 0x01 validator
            BeaconSszTestBuilder.ValidatorFixture memory aliceVal = _validAliceValidator(6);
            (
                bytes32 bRoot2,
                IDirectVoting.BeaconSnapshotAuthProof memory bAuth2,
                IDirectVoting.ValidatorStakeProof memory aliceValProof
            ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                    snapshotHash,
                    SNAPSHOT_SLOT,
                    INITIAL_TIMESTAMP,
                    100,
                    aliceVal,
                    false
                );
            beaconOracle.setRoot(INITIAL_TIMESTAMP, bRoot2);
            uint256 topicE = _createDefaultTopic();
            arr[0] = aliceValProof;

            VM.prank(bob);
            VM.expectRevert(
                abi.encodeWithSelector(
                    IDirectVoting.UnauthorizedWithdrawalAddress.selector,
                    uint64(6),
                    bob,
                    alice
                )
            );
            therdal.voteWithBeaconStake(topicE, 0, bAuth2, arr);
        }
    }

    // -------------------------------------------------------------------------
    // 3. Forged Headers, Unaligned Beacon Roots, Non-Canonical RLP & Missing Accounts
    // -------------------------------------------------------------------------

    function test_RevertOnForgedSnapshotsMalformedRLPAndWrongAccountProof() public {
        // Zero-balance account reverts with ZeroVotingWeight
        (bytes32 zeroStateRoot, bytes memory zeroProof) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            1,
            0
        );
        (bytes memory zeroHeader, bytes32 zeroBlockHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            zeroStateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, zeroBlockHash);
        uint256 zeroTopic = _createDefaultTopic();

        VM.prank(alice);
        VM.expectRevert(IDirectVoting.ZeroVotingWeight.selector);
        therdal.voteWithExecutionBalance(zeroTopic, 0, zeroHeader, zeroProof);

        // Valid multi-account trie for Alice; Bob submits Alice's proof under Bob's msg.sender -> path mismatch / not found
        (bytes32 stateRoot, bytes memory aliceProof) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            1,
            5 ether
        );
        (bytes memory validHeader, bytes32 validBlockHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, validBlockHash);
        uint256 topicId = _createDefaultTopic();

        // Forged header hash rejected
        (bytes memory forgedHeader, bytes32 forgedHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            keccak256("forged_state_root"),
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.expectRevert(
            abi.encodeWithSelector(
                SnapshotAuthenticator.ExecutionHeaderHashMismatch.selector,
                validBlockHash,
                forgedHash
            )
        );
        therdal.authenticateExecutionSnapshot(topicId, forgedHeader);

        // Bob submitting Alice's MPT proof fails path verification
        VM.prank(bob);
        VM.expectRevert(MerklePatriciaProofVerifier.MPTPathMismatch.selector);
        therdal.voteWithExecutionBalance(topicId, 0, validHeader, aliceProof);

        // Non-canonical RLP (`0x81 0x05` for single byte `< 0x80`) rejected by RLPReader
        bytes memory nonCanonicalProof = hex"c28105";
        VM.prank(alice);
        VM.expectRevert(RLPReader.NonCanonicalRLP.selector);
        therdal.voteWithExecutionBalance(topicId, 0, validHeader, nonCanonicalProof);

        // Unaligned Beacon snapshot (executionHashBranch points to a different execution block hash) rejected
        BeaconSszTestBuilder.ValidatorFixture memory val = _validAliceValidator(0);
        (
            bytes32 unalignedBeaconRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory unalignedAuth,

        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                keccak256("wrong_execution_block_hash"),
                SNAPSHOT_SLOT,
                INITIAL_TIMESTAMP,
                10,
                val,
                false
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, unalignedBeaconRoot);
        uint256 unalignedTopic = _createDefaultTopic();

        VM.expectRevert(SnapshotAuthenticator.InvalidExecutionConsensusAlignment.selector);
        therdal.authenticateBeaconSnapshot(unalignedTopic, unalignedAuth);
    }

    // -------------------------------------------------------------------------
    // 4. Phase, Option Bounds, Empty Proofs & Redundant Standalone Auth Reverts
    // -------------------------------------------------------------------------

    function test_RevertOnClosedPhaseOutOfRangeOptionAndEmptyBundles() public {
        (bytes32 stateRoot, bytes memory aliceProof) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            1,
            2 ether
        );
        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);
        uint256 topicId = _createDefaultTopic();

        // Missing topic reverts
        VM.expectRevert(abi.encodeWithSelector(ITopicRegistry.TopicNotFound.selector, 999));
        therdal.getTopicTallies(999);

        // Out-of-bounds optionIndex (3 options -> indices 0, 1, 2; index 3 reverts)
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(IDirectVoting.InvalidOptionIndex.selector, uint32(3), uint32(3))
        );
        therdal.voteWithExecutionBalance(topicId, 3, rlpHeader, aliceProof);

        // Unauthenticated execution snapshot with empty inline header reverts
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(IDirectVoting.ExecutionSnapshotNotAuthenticated.selector, topicId)
        );
        therdal.voteWithExecutionBalance(topicId, 0, "", aliceProof);

        // Empty validator array or empty DirectVoteProofBundle reverts
        IDirectVoting.BeaconSnapshotAuthProof memory emptyAuth;
        IDirectVoting.ValidatorStakeProof[]
            memory emptyVals = new IDirectVoting.ValidatorStakeProof[](0);

        VM.prank(alice);
        VM.expectRevert(IDirectVoting.EmptyDirectVoteProof.selector);
        therdal.voteWithBeaconStake(topicId, 0, emptyAuth, emptyVals);

        IDirectVoting.DirectVoteProofBundle memory emptyBundle = IDirectVoting
            .DirectVoteProofBundle({
                includeExecutionBalance: false,
                rlpExecutionHeader: "",
                rlpAccountProofNodes: "",
                beaconAuth: emptyAuth,
                validatorProofs: emptyVals
            });
        VM.prank(alice);
        VM.expectRevert(IDirectVoting.EmptyDirectVoteProof.selector);
        therdal.voteDirect(topicId, 0, emptyBundle);

        // Redundant standalone `authenticateExecutionSnapshot` reverts
        therdal.authenticateExecutionSnapshot(topicId, rlpHeader);
        VM.expectRevert(
            abi.encodeWithSelector(
                IDirectVoting.ExecutionSnapshotAlreadyAuthenticated.selector,
                topicId
            )
        );
        therdal.authenticateExecutionSnapshot(topicId, rlpHeader);

        // Warp past votingEndsAt -> Closed phase rejects direct votes
        VM.warp(INITIAL_TIMESTAMP + 2 days);
        VM.prank(alice);
        VM.expectRevert(
            abi.encodeWithSelector(
                ITopicRegistry.InvalidTopicPhase.selector,
                ITopicRegistry.TopicPhase.Closed,
                ITopicRegistry.TopicPhase.Open
            )
        );
        therdal.voteWithExecutionBalance(topicId, 0, "", aliceProof);
    }

    function _createDefaultTopic() internal returns (uint256) {
        string[] memory opts = new string[](3);
        opts[0] = "Option A";
        opts[1] = "Option B";
        opts[2] = "Option C";
        return therdal.createTopic("Test direct voting subject?", opts, INITIAL_TIMESTAMP + 1 days, 0);
    }

    function _validAliceValidator(
        uint64 validatorIndex
    ) internal view returns (BeaconSszTestBuilder.ValidatorFixture memory) {
        return
            BeaconSszTestBuilder.ValidatorFixture({
                validatorIndex: validatorIndex,
                pubkeyRoot: keccak256(abi.encodePacked("val_pubkey_", validatorIndex)),
                withdrawalCredentials: BeaconSszTestBuilder.eth1WithdrawalCredentials(alice),
                effectiveBalanceGwei: 32_000_000_000,
                slashed: false,
                activationEligibilityEpoch: 100_000,
                activationEpoch: 100_010,
                exitEpoch: type(uint64).max,
                withdrawableEpoch: type(uint64).max
            });
    }
}
