// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../../contracts/interfaces/IDirectVoting.sol";
import {TherdalController} from "../../contracts/TherdalController.sol";
import {Therdal} from "../../contracts/Therdal.sol";
import {Vm, MockStablecoin} from "../helpers/TestHelpers.sol";
import {MockERC4337SmartAccount} from "../helpers/SmartAccountHelpers.sol";
import {
    MockSystemRootOracle,
    RlpEncoderHelper,
    BeaconSszTestBuilder
} from "../helpers/ProofTestHelpers.sol";

/**
 * @title SmartAccountAndStakeVotingTest
 * @notice Tests EOA voting, Smart Account (`MockERC4337SmartAccount` & `TherdalController`) direct
 *         `execute` voting, bundler-relayed `executeWithSignature` AA voting, ERC-1271 signature
 *         checks, and `0x01` / `0x02` Beacon validator stake proofs.
 */
contract SmartAccountAndStakeVotingTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address internal constant EIP4788_ADDR = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    uint256 internal constant OWNER_A_PK = 0xA11CE01;
    uint256 internal constant OWNER_B_PK = 0xB0B02;
    uint256 internal constant WRONG_PK = 0xBADBEEF;

    uint64 internal constant INITIAL_TIMESTAMP = 1_760_000_000;
    uint64 internal constant INITIAL_BLOCK = 21_500_000;
    uint64 internal constant SNAPSHOT_BLOCK = INITIAL_BLOCK - 1;
    uint64 internal constant SNAPSHOT_BEACON_SLOT = 10_240_000; // Epoch 320,000

    MockStablecoin internal usdc;
    TherdalController internal controller;
    Therdal internal therdal;
    MockSystemRootOracle internal beaconOracle;

    address internal operator = address(0xD00D);
    address internal creator = address(0xC0FFEE);
    address internal bundlerRelayer = address(0xB00D1E);

    address internal ownerA;
    address internal ownerB;
    MockERC4337SmartAccount internal smartAccountA;
    MockERC4337SmartAccount internal smartAccountB;

    error AssertionFailed(string reason);

    function setUp() public {
        VM.chainId(31_337);
        VM.roll(INITIAL_BLOCK);
        VM.warp(INITIAL_TIMESTAMP);

        ownerA = VM.addr(OWNER_A_PK);
        ownerB = VM.addr(OWNER_B_PK);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        controller = new TherdalController(operator, address(usdc), 6);
        therdal = new Therdal(address(controller));

        smartAccountA = new MockERC4337SmartAccount(ownerA);
        smartAccountB = new MockERC4337SmartAccount(ownerB);

        MockSystemRootOracle impl = new MockSystemRootOracle();
        VM.etch(EIP4788_ADDR, address(impl).code);
        beaconOracle = MockSystemRootOracle(EIP4788_ADDR);
    }

    // -------------------------------------------------------------------------
    // 1. Smart Account Direct `execute`: Contract MPT Leaf + `0x01` Stake
    // -------------------------------------------------------------------------

    function test_SmartAccountDirectExecuteCombinedWalletAndValidatorStake() public {
        uint256 treasuryEth = 85 ether;
        uint64 validatorStakeGwei = 64_000_000_000; // 64 ETH

        // Build contract account leaf with non-empty storageRoot and actual runtime codeHash
        (bytes32 stateRoot, bytes memory accountProof) = RlpEncoderHelper.buildCustomAccountTrie(
            address(smartAccountA),
            1,
            treasuryEth,
            keccak256("smart_account_non_empty_storage_root"),
            address(smartAccountA).codehash
        );

        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(uint256(0x4788))
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        BeaconSszTestBuilder.ValidatorFixture memory val = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 77,
            pubkeyRoot: keccak256("sa_validator_77"),
            withdrawalCredentials: BeaconSszTestBuilder.eth1WithdrawalCredentials(
                address(smartAccountA)
            ),
            effectiveBalanceGwei: validatorStakeGwei,
            slashed: false,
            activationEligibilityEpoch: 200_000,
            activationEpoch: 200_010,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });

        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory valProof
        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                INITIAL_TIMESTAMP,
                500,
                val,
                false
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        uint256 topicId = _createDefaultTopic();

        IDirectVoting.ValidatorStakeProof[]
            memory valProofs = new IDirectVoting.ValidatorStakeProof[](1);
        valProofs[0] = valProof;

        IDirectVoting.DirectVoteProofBundle memory bundle = IDirectVoting.DirectVoteProofBundle({
            includeExecutionBalance: true,
            rlpExecutionHeader: rlpHeader,
            rlpAccountProofNodes: accountProof,
            beaconAuth: authProof,
            validatorProofs: valProofs
        });

        bytes memory voteCalldata = abi.encodeCall(therdal.voteDirect, (topicId, 0, bundle));

        VM.prank(ownerA);
        bytes memory ret = smartAccountA.execute(address(therdal), 0, voteCalldata);
        uint256 creditedWei = abi.decode(ret, (uint256));

        uint256 expectedWei = treasuryEth + uint256(validatorStakeGwei) * 1 gwei;
        _assertEq(creditedWei, expectedWei, "SmartAccount combined weight mismatch");
        _assertTrue(
            therdal.hasWalletVoted(topicId, address(smartAccountA)),
            "SmartAccount wallet should be marked voted"
        );
        _assertTrue(therdal.hasValidatorVoted(topicId, 77), "Validator #77 should be marked voted");

        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertEq(tallies.optionWeightsWei[0], expectedWei, "Option 0 weight mismatch");
        _assertEq(tallies.totalCountedPositions, 2, "Should count wallet + validator");
        _assertEq(tallies.directVoteCount, 1, "Should count 1 atomic direct vote");
    }

    // -------------------------------------------------------------------------
    // 2. Relayed / Bundler AA Smart Account Vote (`executeWithSignature` + `0x02` Stake)
    // -------------------------------------------------------------------------

    function test_BundlerRelayedSmartAccountVoteWithCompoundingValidator() public {
        uint256 smartAccountEth = 40 ether;
        uint64 compoundingStakeGwei = 2_048_000_000_000; // 2,048 ETH Pectra MaxEB validator

        (bytes32 stateRoot, bytes memory accountProof) = RlpEncoderHelper.buildCustomAccountTrie(
            address(smartAccountB),
            1,
            smartAccountEth,
            keccak256("smart_account_b_storage"),
            address(smartAccountB).codehash
        );

        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(uint256(0x9999))
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        BeaconSszTestBuilder.ValidatorFixture memory val = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 512,
            pubkeyRoot: keccak256("pectra_compounding_512"),
            withdrawalCredentials: BeaconSszTestBuilder.compoundingWithdrawalCredentials(
                address(smartAccountB)
            ),
            effectiveBalanceGwei: compoundingStakeGwei,
            slashed: false,
            activationEligibilityEpoch: 300_000,
            activationEpoch: 310_000,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });

        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory valProof
        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                INITIAL_TIMESTAMP,
                1_000,
                val,
                true // Electra/Pectra 64-leaf BeaconState depth
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        uint256 topicId = _createDefaultTopic();

        IDirectVoting.ValidatorStakeProof[]
            memory valProofs = new IDirectVoting.ValidatorStakeProof[](1);
        valProofs[0] = valProof;

        IDirectVoting.DirectVoteProofBundle memory bundle = IDirectVoting.DirectVoteProofBundle({
            includeExecutionBalance: true,
            rlpExecutionHeader: rlpHeader,
            rlpAccountProofNodes: accountProof,
            beaconAuth: authProof,
            validatorProofs: valProofs
        });

        bytes memory voteCalldata = abi.encodeCall(therdal.voteDirect, (topicId, 1, bundle));
        uint64 sigDeadline = INITIAL_TIMESTAMP + 3_600;
        bytes32 digest = smartAccountB.getExecuteDigest(
            address(therdal),
            0,
            voteCalldata,
            0,
            sigDeadline
        );
        bytes memory sig = _signCompact65(OWNER_B_PK, digest);

        // Bundler/relayer EOA pays gas and submits — ownerB never transacts on-chain!
        VM.prank(bundlerRelayer);
        smartAccountB.executeWithSignature(address(therdal), 0, voteCalldata, sigDeadline, sig);

        uint256 expectedWeight = smartAccountEth + uint256(compoundingStakeGwei) * 1 gwei;
        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertEq(tallies.optionWeightsWei[1], expectedWeight, "Relayed AA Option 1 weight");
        _assertTrue(
            therdal.hasWalletVoted(topicId, address(smartAccountB)),
            "SmartAccountB wallet voted"
        );
        _assertTrue(therdal.hasValidatorVoted(topicId, 512), "Validator #512 voted");
        _assertEq(smartAccountB.nonce(), 1, "SmartAccountB nonce incremented");
    }

    // -------------------------------------------------------------------------
    // 3. Mixed EOA + Smart Account Multi-Stakeholder Topic & Root Caching
    // -------------------------------------------------------------------------

    function test_MixedEoaAndSmartAccountSignalingOnSameTopic() public {
        address eoaVoter = ownerA;
        uint256 eoaBalance = 18.5 ether;
        uint256 saBalance = 110 ether;

        (bytes32 stateRoot, bytes memory proofEoa, bytes memory proofSa) = RlpEncoderHelper
            .buildTwoAccountTrie(eoaVoter, eoaBalance, address(smartAccountB), saBalance);

        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(uint256(0xABCD))
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        BeaconSszTestBuilder.ValidatorFixture memory v0 = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 0,
            pubkeyRoot: keccak256("eoa_val_0"),
            withdrawalCredentials: BeaconSszTestBuilder.eth1WithdrawalCredentials(eoaVoter),
            effectiveBalanceGwei: 32_000_000_000,
            slashed: false,
            activationEligibilityEpoch: 100,
            activationEpoch: 110,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });
        BeaconSszTestBuilder.ValidatorFixture memory v1 = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 1,
            pubkeyRoot: keccak256("sa_val_1"),
            withdrawalCredentials: BeaconSszTestBuilder.compoundingWithdrawalCredentials(
                address(smartAccountB)
            ),
            effectiveBalanceGwei: 96_000_000_000,
            slashed: false,
            activationEligibilityEpoch: 100,
            activationEpoch: 110,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });

        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory valProofEoa,
            IDirectVoting.ValidatorStakeProof memory valProofSa
        ) = BeaconSszTestBuilder.buildTwoValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                INITIAL_TIMESTAMP,
                v0,
                v1
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        uint256 topicId = _createDefaultTopic();

        // Step 1: EOA votes Option 0, authenticating both Execution and Beacon snapshots on-chain
        {
            IDirectVoting.ValidatorStakeProof[]
                memory eoaVals = new IDirectVoting.ValidatorStakeProof[](1);
            eoaVals[0] = valProofEoa;

            IDirectVoting.DirectVoteProofBundle memory eoaBundle = IDirectVoting
                .DirectVoteProofBundle({
                    includeExecutionBalance: true,
                    rlpExecutionHeader: rlpHeader,
                    rlpAccountProofNodes: proofEoa,
                    beaconAuth: authProof,
                    validatorProofs: eoaVals
                });

            VM.prank(eoaVoter);
            therdal.voteDirect(topicId, 0, eoaBundle);
        }

        // Step 2: SmartAccountB votes Option 1 using cached roots (empty header & empty beaconAuth!)
        {
            IDirectVoting.ValidatorStakeProof[]
                memory saVals = new IDirectVoting.ValidatorStakeProof[](1);
            saVals[0] = valProofSa;

            IDirectVoting.BeaconSnapshotAuthProof memory emptyAuth;
            IDirectVoting.DirectVoteProofBundle memory saBundle = IDirectVoting
                .DirectVoteProofBundle({
                    includeExecutionBalance: true,
                    rlpExecutionHeader: "",
                    rlpAccountProofNodes: proofSa,
                    beaconAuth: emptyAuth,
                    validatorProofs: saVals
                });

            bytes memory callData = abi.encodeCall(therdal.voteDirect, (topicId, 1, saBundle));
            VM.prank(ownerB);
            smartAccountB.execute(address(therdal), 0, callData);
        }

        IDirectVoting.TopicTallyView memory tallies = therdal.getTopicTallies(topicId);
        _assertEq(tallies.optionWeightsWei[0], 50.5 ether, "EOA Option 0 weight (18.5 + 32 ETH)");
        _assertEq(tallies.optionWeightsWei[1], 206 ether, "SA Option 1 weight (110 + 96 ETH)");
        _assertEq(tallies.totalWeightWei, 256.5 ether, "Combined total weight");
        _assertEq(tallies.totalCountedPositions, 4, "2 wallets + 2 validators");
        _assertEq(tallies.directVoteCount, 2, "2 direct votes");
    }

    // -------------------------------------------------------------------------
    // 4. TherdalController Treasury Smart Account + ERC-1271 Verification
    // -------------------------------------------------------------------------

    function test_ControllerSmartAccountVoteAndErc1271Signatures() public {
        bytes32 testHash = keccak256("therdal_offline_ballot_digest");
        bytes memory sigA = _signCompact65(OWNER_A_PK, testHash);
        bytes memory badSig = _signCompact65(WRONG_PK, testHash);

        _assertTrue(
            smartAccountA.isValidSignature(testHash, sigA) == bytes4(0x1626ba7e),
            "ERC-1271 valid owner sig should return magic value"
        );
        _assertTrue(
            smartAccountA.isValidSignature(testHash, badSig) == bytes4(0xffffffff),
            "ERC-1271 wrong signer should return 0xffffffff"
        );

        // TherdalController itself can vote via `controller.execute` if holding ETH at snapshot
        (bytes32 stateRoot, bytes memory ctrlProof) = RlpEncoderHelper.buildCustomAccountTrie(
            address(controller),
            1,
            15 ether,
            keccak256("ctrl_storage"),
            address(controller).codehash
        );
        (bytes memory rlpHeader, bytes32 snapshotHash) = RlpEncoderHelper.buildExecutionHeader(
            SNAPSHOT_BLOCK,
            stateRoot,
            INITIAL_TIMESTAMP - 12,
            bytes32(0)
        );
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        uint256 topicId = _createDefaultTopic();
        bytes memory voteData = abi.encodeCall(
            therdal.voteWithExecutionBalance,
            (topicId, 0, rlpHeader, ctrlProof)
        );

        VM.prank(operator);
        controller.execute(address(therdal), 0, voteData);

        _assertTrue(
            therdal.hasWalletVoted(topicId, address(controller)),
            "TherdalController smart account should have voted"
        );
    }

    // -------------------------------------------------------------------------
    // 5. Adversarial & Security Checks (Unauthorized EOA Claim, Replay, Expiry)
    // -------------------------------------------------------------------------

    function test_RevertWhen_OwnerEoaDirectlyClaimsSmartAccountValidator() public {
        bytes32 snapshotHash = keccak256("snap_adv");
        VM.setBlockhash(SNAPSHOT_BLOCK, snapshotHash);

        BeaconSszTestBuilder.ValidatorFixture memory val = BeaconSszTestBuilder.ValidatorFixture({
            validatorIndex: 9,
            pubkeyRoot: keccak256("sa_val_9"),
            withdrawalCredentials: BeaconSszTestBuilder.eth1WithdrawalCredentials(
                address(smartAccountA)
            ),
            effectiveBalanceGwei: 32_000_000_000,
            slashed: false,
            activationEligibilityEpoch: 100,
            activationEpoch: 110,
            exitEpoch: type(uint64).max,
            withdrawableEpoch: type(uint64).max
        });

        (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory valProof
        ) = BeaconSszTestBuilder.buildSingleValidatorBeaconFixture(
                snapshotHash,
                SNAPSHOT_BEACON_SLOT,
                INITIAL_TIMESTAMP,
                50,
                val,
                false
            );
        beaconOracle.setRoot(INITIAL_TIMESTAMP, beaconBlockRoot);

        uint256 topicId = _createDefaultTopic();

        IDirectVoting.ValidatorStakeProof[]
            memory proofs = new IDirectVoting.ValidatorStakeProof[](1);
        proofs[0] = valProof;

        // Even though `ownerA` owns `smartAccountA`, calling `Therdal` directly makes `msg.sender == ownerA != smartAccountA`
        VM.prank(ownerA);
        VM.expectRevert(
            abi.encodeWithSelector(
                IDirectVoting.UnauthorizedWithdrawalAddress.selector,
                uint64(9),
                ownerA,
                address(smartAccountA)
            )
        );
        therdal.voteWithBeaconStake(topicId, 0, authProof, proofs);
    }

    function test_RevertWhen_SmartAccountRelayedSignatureExpiredOrWrongSigner() public {
        bytes memory dummyCall = abi.encodeCall(therdal.getPhase, (1));
        uint64 expiredDeadline = INITIAL_TIMESTAMP - 1;
        bytes32 digest = smartAccountA.getExecuteDigest(
            address(therdal),
            0,
            dummyCall,
            0,
            expiredDeadline
        );
        bytes memory sig = _signCompact65(OWNER_A_PK, digest);

        VM.expectRevert(
            abi.encodeWithSelector(
                MockERC4337SmartAccount.ExpiredSignature.selector,
                expiredDeadline,
                uint256(INITIAL_TIMESTAMP)
            )
        );
        smartAccountA.executeWithSignature(address(therdal), 0, dummyCall, expiredDeadline, sig);

        uint64 validDeadline = INITIAL_TIMESTAMP + 600;
        bytes32 digest2 = smartAccountA.getExecuteDigest(
            address(therdal),
            0,
            dummyCall,
            0,
            validDeadline
        );
        bytes memory wrongSig = _signCompact65(WRONG_PK, digest2);

        VM.expectRevert(
            abi.encodeWithSelector(
                MockERC4337SmartAccount.InvalidOwnerSignature.selector,
                VM.addr(WRONG_PK),
                ownerA
            )
        );
        smartAccountA.executeWithSignature(
            address(therdal),
            0,
            dummyCall,
            validDeadline,
            wrongSig
        );
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    function _createDefaultTopic() internal returns (uint256 topicId) {
        string[] memory opts = new string[](2);
        opts[0] = "Support";
        opts[1] = "Oppose";

        VM.prank(creator);
        topicId = therdal.createTopic(
            "Should Ethereum prioritize L1 execution scaling in the next hardfork?",
            opts,
            INITIAL_TIMESTAMP + 7 days,
            0
        );
    }

    function _signCompact65(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _assertTrue(bool cond, string memory reason) internal pure {
        if (!cond) revert AssertionFailed(reason);
    }

    function _assertEq(uint256 a, uint256 b, string memory reason) internal pure {
        if (a != b) revert AssertionFailed(reason);
    }
}
