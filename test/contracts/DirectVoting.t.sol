// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../../contracts/interfaces/IDirectVoting.sol";
import {ITopicRegistry} from "../../contracts/interfaces/ITopicRegistry.sol";
import {PositionEligibility} from "../../contracts/libraries/PositionEligibility.sol";
import {SnapshotAuthenticator} from "../../contracts/libraries/SnapshotAuthenticator.sol";
import {SSZVerifier} from "../../contracts/libraries/SSZVerifier.sol";
import {TherdalController} from "../../contracts/TherdalController.sol";
import {Therdal} from "../../contracts/Therdal.sol";
import {Vm, MockStablecoin} from "../helpers/TestHelpers.sol";
import {
    MockSystemRootOracle,
    RlpEncoderHelper,
    BeaconSszTestBuilder
} from "../helpers/ProofTestHelpers.sol";

/**
 * @title DirectVotingTest
 * @notice Comprehensive Stage 2 unit, multi-position, Deneb/Electra SSZ, multi-account MPT, and
 *         cross-layer deterministic vector tests for Direct On-Chain Voting.
 */
contract DirectVotingTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant EIP4788_ADDR = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    MockStablecoin internal usdc;
    TherdalController internal controller;
    Therdal internal therdal;
    MockSystemRootOracle internal beaconOracle;

    address internal operator = address(0xD00D);
    address internal creator = address(0xC0FFEE);
    address internal alice = 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A;
    address internal bob = 0x1563915e194D8CfBA1943570603F7606A3115508;

    uint64 internal constant INITIAL_TIMESTAMP = 1_760_000_000;
    uint64 internal constant INITIAL_BLOCK = 21_500_000;
    uint64 internal constant SNAPSHOT_BLOCK = INITIAL_BLOCK - 1;
    uint64 internal constant SNAPSHOT_BEACON_SLOT = 10_240_000; // Epoch 320,000

    error AssertionFailed(string reason);

    function setUp() public {
        VM.chainId(1);
        VM.roll(INITIAL_BLOCK);
        VM.warp(INITIAL_TIMESTAMP);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        controller = new TherdalController(operator, address(usdc), 6);
        therdal = new Therdal(address(controller));

        // Deploy & etch mock EIP-4788 oracle code at canonical system contract address
        MockSystemRootOracle impl = new MockSystemRootOracle();
        VM.etch(EIP4788_ADDR, address(impl).code);
        beaconOracle = MockSystemRootOracle(EIP4788_ADDR);
    }

    // -------------------------------------------------------------------------
    // 1. Execution Layer ETH Held at Snapshot Time (Single & Multi-Account MPT)
    // -------------------------------------------------------------------------

    function test_DirectVoteWithExecutionBalanceInlineAndCached() public {
        uint256 aliceBalance = 12.5 ether;
        uint256 bobBalance = 47.25 ether;

        (bytes32 stateRoot, bytes memory proofAlice, bytes memory proofBob) = RlpEncoderHelper
            .buildTwoAccountTrie(alice, aliceBalance, bob, bobBalance);

        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(uint256(0xBEEF))
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        // Sponsor $50 USDC on topic to verify direct voting consumes $0 of SponsorEscrow
        usdc.mint(creator, 50_000_000);
        VM.prank(creator);
        usdc.approve(address(therdal), 50_000_000);

        string[] memory options = _threeOptions();
        VM.prank(creator);
        uint256 topicId = therdal.createTopic(
            "Should Ethereum raise the blob target to 12?",
            options,
            INITIAL_TIMESTAMP + 7 days,
            50_000_000
        );

        // Alice votes for Option 0 supplying inline `rlpHeader` + MPT account proof
        VM.prank(alice);
        uint256 aliceCounted = therdal.voteWithExecutionBalance(
            topicId,
            0,
            rlpHeader,
            proofAlice
        );
        _assertTrue(aliceCounted == aliceBalance, "Alice exact snapshot ETH weight");

        // Snapshot execution root is now cached on-chain
        IDirectVoting.SnapshotStateView memory snap = therdal.getSnapshotState(topicId);
        _assertTrue(snap.executionAuthenticated, "executionAuthenticated == true");
        _assertTrue(snap.snapshotExecutionRoot == stateRoot, "cached stateRoot matches");

        // Bob votes for Option 1 with empty `rlpExecutionHeader` (uses cached root!)
        VM.prank(bob);
        uint256 bobCounted = therdal.voteWithExecutionBalance(topicId, 1, "", proofBob);
        _assertTrue(bobCounted == bobBalance, "Bob exact snapshot ETH weight");

        // Verify tallies, receipts, and untouched SponsorEscrow ($0 fee for direct voting)
        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertTrue(tallies.optionWeightsWei[0] == aliceBalance, "Option 0 weight");
        _assertTrue(tallies.optionWeightsWei[1] == bobBalance, "Option 1 weight");
        _assertTrue(tallies.optionWeightsWei[2] == 0, "Option 2 weight");
        _assertTrue(tallies.optionPositionCounts[0] == 1, "Option 0 count");
        _assertTrue(tallies.optionPositionCounts[1] == 1, "Option 1 count");
        _assertTrue(tallies.totalWeightWei == aliceBalance + bobBalance, "Total weight");
        _assertTrue(tallies.totalCountedPositions == 2, "Total counted positions");
        _assertTrue(tallies.directVoteCount == 2, "directVoteCount == 2");

        _assertTrue(therdal.hasWalletVoted(topicId, alice), "hasWalletVoted(alice)");
        _assertTrue(therdal.hasWalletVoted(topicId, bob), "hasWalletVoted(bob)");
        _assertTrue(
            therdal.getTopic(topicId).remainingEscrow == 50_000_000,
            "SponsorEscrow untouched by direct votes"
        );

        bytes32 aliceKey = therdal.computeWalletPositionKey(alice);
        IDirectVoting.PositionReceipt memory receipt = therdal.getPositionReceipt(
            topicId,
            aliceKey
        );
        _assertTrue(receipt.claimed, "receipt.claimed");
        _assertTrue(
            receipt.positionType == IDirectVoting.PositionType.ExecutionWallet,
            "receipt.positionType"
        );
        _assertTrue(receipt.voter == alice, "receipt.voter");
        _assertTrue(receipt.optionIndex == 0, "receipt.optionIndex");
        _assertTrue(receipt.weightWei == aliceBalance, "receipt.weightWei");
    }

    // -------------------------------------------------------------------------
    // 2. Beacon Chain Staked ETH (0x01 Standard & 0x02 Compounding, Deneb & Electra)
    // -------------------------------------------------------------------------

    function test_DirectVoteWithBeaconStakeMultiValidatorAndRingBufferSurvival() public {
        (bytes32 stateRoot, ) = RlpEncoderHelper.buildSingleAccountTrie(alice, 0, 1 ether);
        (, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        // Alice controls Validator #0 (32 ETH, 0x01 ETH1 prefix) and Validator #1 (2048 ETH, 0x02 Pectra compounding prefix)
        BeaconSszTestBuilder.ValidatorFixture memory v0 = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 0,
            pubkeyRoot: keccak256("validator_0_pubkey"),
            withdrawalCredentials: BeaconSszTestBuilder.eth1WithdrawalCredentials(alice),
            effectiveBalanceGwei: 32_000_000_000, // 32 ETH
            slashed: false,
            activationEligibilityEpoch: 100_000,
            activationEpoch: 100_010,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });

        BeaconSszTestBuilder.ValidatorFixture memory v1 = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 1,
            pubkeyRoot: keccak256("validator_1_pubkey"),
            withdrawalCredentials: BeaconSszTestBuilder.compoundingWithdrawalCredentials(alice),
            effectiveBalanceGwei: 2_048_000_000_000, // 2,048 ETH (EIP-7251 MaxEB)
            slashed: false,
            activationEligibilityEpoch: 200_000,
            activationEpoch: 320_000, // exact boundary: activationEpoch == snapshotEpoch (320,000)
            exitEpoch: 320_001, // exact boundary: snapshotEpoch < exitEpoch
            withdrawableEpoch: 320_256
        });

        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory beaconAuth,
            IDirectVoting.ValidatorStakeProof memory proof0,
            IDirectVoting.ValidatorStakeProof memory proof1
        ) = BeaconSszTestBuilder.buildTwoValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                INITIAL_TIMESTAMP,
                v0,
                v1
            );

        // Populate EIP-4788 at creation timestamp so createTopic auto-pins `snapshotBeaconBlockRoot`
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        VM.prank(creator);
        uint256 topicId = therdal.createTopic(
            "Should validators increase the gas limit to 60M?",
            _threeOptions(),
            INITIAL_TIMESTAMP + 14 days,
            0
        );

        IDirectVoting.SnapshotStateView memory snapInitial = therdal.getSnapshotState(topicId);
        _assertTrue(
            snapInitial.snapshotBeaconBlockRoot == beaconBlockRoot,
            "snapshotBeaconBlockRoot auto-pinned at createTopic"
        );

        // Simulate 5 days passing (> 27.3h EIP-4788 ring buffer window!) and clear EIP-4788 slot
        VM.warp(INITIAL_TIMESTAMP + 5 days);
        VM.roll(INITIAL_BLOCK + 36_000);
        beaconOracle.setRoot(INITIAL_TIMESTAMP, bytes32(0));

        // Alice submits both validator proofs in one `voteWithBeaconStake` call — succeeds using pinned beacon root!
        IDirectVoting.ValidatorStakeProof[]
            memory proofs = new IDirectVoting.ValidatorStakeProof[](2);
        proofs[0] = proof0;
        proofs[1] = proof1;

        VM.prank(alice);
        uint256 totalStake = therdal.voteWithBeaconStake(topicId, 2, beaconAuth, proofs);

        uint256 expectedStake = 32 ether + 2048 ether;
        _assertTrue(totalStake == expectedStake, "32 ETH + 2048 ETH = 2080 ETH weight");
        _assertTrue(therdal.hasValidatorVoted(topicId, 0), "Validator 0 marked voted");
        _assertTrue(therdal.hasValidatorVoted(topicId, 1), "Validator 1 marked voted");

        IDirectVoting.SnapshotStateView memory snapAfter = therdal.getSnapshotState(topicId);
        _assertTrue(snapAfter.beaconAuthenticated, "beaconAuthenticated");
        _assertTrue(snapAfter.snapshotEpoch == 320_000, "snapshotEpoch == 320,000");

        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertTrue(tallies.optionWeightsWei[2] == expectedStake, "Option 2 weight == 2080 ETH");
        _assertTrue(tallies.optionPositionCounts[2] == 2, "2 validator positions counted");
        _assertTrue(tallies.directVoteCount == 1, "1 direct vote tx");
    }

    // -------------------------------------------------------------------------
    // 3. Combined Direct Vote (Execution Wallet + Electra Depth-6 Beacon Stake)
    // -------------------------------------------------------------------------

    function test_CombinedVoteDirectExecutionAndElectraBeaconStake() public {
        uint256 aliceWalletWei = 5.5 ether;
        (bytes32 stateRoot, bytes memory accountProof) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            7,
            aliceWalletWei
        );
        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        // Leave EIP-4788 empty during `createTopic` to test `childBlockTimestamp` fallback lookup + Electra depth-6 BeaconState!
        VM.prank(creator);
        uint256 topicId = therdal.createTopic(
            "Combined wallet + Electra validator vote?",
            _threeOptions(),
            INITIAL_TIMESTAMP + 3 days,
            0
        );

        BeaconSszTestBuilder.ValidatorFixture memory valFixture = BeaconSszTestBuilder
            .ValidatorFixture({
                validatorIndex: 512_345, // Arbitrary mainnet-scale validator index
                pubkeyRoot: keccak256("electra_validator_pubkey"),
                withdrawalCredentials: BeaconSszTestBuilder.compoundingWithdrawalCredentials(alice),
                effectiveBalanceGwei: 64_000_000_000, // 64 ETH
                slashed: false,
                activationEligibilityEpoch: 300_000,
                activationEpoch: 300_100,
                exitEpoch: type(uint64).max,
                withdrawableEpoch: type(uint64).max
            });

        uint64 childTs = INITIAL_TIMESTAMP + 12;
        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory beaconAuth,
            IDirectVoting.ValidatorStakeProof memory valProof
        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                childTs,
                1_000_000, // 1M active validators in registry
                valFixture,
                true // Electra depth-6 BeaconState (11-level executionHashBranch, 6-level beaconStateBranch)
            );
        beaconOracle.setRoot(childTs, beaconBlockRoot);

        IDirectVoting.ValidatorStakeProof[]
            memory valProofs = new IDirectVoting.ValidatorStakeProof[](1);
        valProofs[0] = valProof;

        IDirectVoting.DirectVoteProofBundle memory bundle = IDirectVoting.DirectVoteProofBundle({
            includeExecutionBalance: true,
            rlpExecutionHeader: rlpHeader,
            rlpAccountProofNodes: accountProof,
            beaconAuth: beaconAuth,
            validatorProofs: valProofs
        });

        VM.prank(alice);
        uint256 combinedWeight = therdal.voteDirect(topicId, 1, bundle);

        _assertTrue(combinedWeight == 69.5 ether, "5.5 ETH wallet + 64 ETH validator = 69.5 ETH");
        _assertTrue(therdal.hasWalletVoted(topicId, alice), "Wallet voted");
        _assertTrue(therdal.hasValidatorVoted(topicId, 512_345), "Validator #512345 voted");

        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertTrue(tallies.optionWeightsWei[1] == 69.5 ether, "Option 1 combined weight");
        _assertTrue(tallies.totalCountedPositions == 2, "Wallet + 1 Validator = 2 positions");
        _assertTrue(tallies.directVoteCount == 1, "1 combined direct vote tx");
    }

    // -------------------------------------------------------------------------
    // 4. Anti-Frontrunning Idempotence on Concurrent Inline Auth Submissions
    // -------------------------------------------------------------------------

    function test_InlineSnapshotAuthDoesNotRevertWhenFrontrunByStandaloneAuth() public {
        (bytes32 stateRoot, bytes memory proofAlice) = RlpEncoderHelper.buildSingleAccountTrie(
            alice,
            1,
            10 ether
        );
        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        uint256 topicId = therdal.createTopic(
            "Anti-frontrunning test?",
            _threeOptions(),
            INITIAL_TIMESTAMP + 1 days,
            0
        );

        // Relayer authenticates execution snapshot ahead of Alice's pending transaction
        bytes32 authRoot = therdal.authenticateExecutionSnapshot(topicId, rlpHeader);
        _assertTrue(authRoot == stateRoot, "Standalone auth succeeded");

        // Alice's vote still carries `rlpHeader` in calldata — must succeed without griefing revert
        VM.prank(alice);
        uint256 weight = therdal.voteWithExecutionBalance(topicId, 0, rlpHeader, proofAlice);
        _assertTrue(weight == 10 ether, "Inline header gracefully ignored once cached");
    }

    // -------------------------------------------------------------------------
    // 5. Cross-Layer Deterministic Position Key & SSZ Validator Root Vectors
    // -------------------------------------------------------------------------

    function test_CrossLayerCanonicalVotingVectors() public view {
        // Vector 1: Wallet position key (chainId = 1, alice = 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A)
        bytes32 walletKey = PositionEligibility.computeWalletPositionKey(1, alice);
        bytes32 expectedWalletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(1), alice));
        _assertTrue(walletKey == expectedWalletKey, "walletKey formula");
        _assertTrue(
            walletKey == 0xfdc983c4a6627025bb1acfb58480db21d43845f0caeddd82415a6190c3fb0ec4,
            "walletKey exact cross-layer digest"
        );

        // Vector 2: Validator position key (chainId = 1, validatorIndex = 42)
        bytes32 validatorKey = PositionEligibility.computeValidatorPositionKey(1, 42);
        bytes32 expectedValidatorKey = keccak256(
            abi.encodePacked("THERDAL_VALIDATOR", uint256(1), uint64(42))
        );
        _assertTrue(validatorKey == expectedValidatorKey, "validatorKey formula");
        _assertTrue(
            validatorKey == 0x55505d5e6780e2e33dce1a71b9bd0ea0afe46418ab1ee55f0fdb4d0e4f312de4,
            "validatorKey exact cross-layer digest"
        );

        // Vector 3: SSZ `hash_tree_root(Validator)` deterministic vector
        bytes32 pubkeyRoot = 0x1111111111111111111111111111111111111111111111111111111111111111;
        bytes32 withdrawalCreds = BeaconSszTestBuilder.eth1WithdrawalCredentials(alice);
        bytes32 validatorRoot = SSZVerifier.computeValidatorRoot(
            pubkeyRoot,
            withdrawalCreds,
            32_000_000_000,
            false,
            100,
            110,
            type(uint64).max,
            type(uint64).max
        );
        _assertTrue(
            validatorRoot == 0xd43c10cf2e1a1f61413cf26c8b470a6e2bc223a7cb985b7f025247b20dea6ae0,
            "SSZ Validator root exact cross-layer digest"
        );

        // Vector 4: Single-account MPT trie root for (alice, nonce = 5, balance = 25 ether)
        (bytes32 mptStateRoot, ) = RlpEncoderHelper.buildSingleAccountTrie(alice, 5, 25 ether);
        _assertTrue(
            mptStateRoot == 0x6c964a28f19f91df3af2d04e7dea3d12cb853416b2cab63617302e2b89e45d54,
            "MPT single-account stateRoot exact cross-layer digest"
        );
    }

    function _threeOptions() internal pure returns (string[] memory opts) {
        opts = new string[](3);
        opts[0] = "12 Blobs";
        opts[1] = "9 Blobs";
        opts[2] = "Keep at 6 Blobs";
    }

    function _assertTrue(bool condition, string memory reason) internal pure {
        if (!condition) {
            revert AssertionFailed(reason);
        }
    }
}
