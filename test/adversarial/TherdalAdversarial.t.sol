// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../contracts/Therdal.sol";
import "../../contracts/TherdalController.sol";
import "../../contracts/StarkVerifierAdapter.sol";
import "../helpers/TestHelpers.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newBlockNumber) external;
    function prank(address msgSender) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
}

/**
 * @title TherdalAdversarialTest
 * @notice Adversarial test vectors for Therdal Protocol v0.2:
 *         - Insufficient escrow reverts batch settlement (`InsufficientEscrowBalance`, Section 9.4)
 *         - Blacklisted USDC submitter cannot DoS prover/developer settlement payouts
 *         - Double settlement & inflated `newlyAcceptedVoteCount` rejected
 *         - Double refund claims & unauthorized controller mutations rejected
 */
contract TherdalAdversarialTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant PROGRAM_VKEY = keccak256("THERDAL_BATCH_PROGRAM_V2");
    address internal constant EIP2935_ADDR = 0x0000F90827F1C53a10cb7A02335B175320002935;

    MockStablecoin internal usdc;
    TherdalController internal controller;
    StarkVerifierAdapter internal verifier;
    MockBlobHashReader internal blobReader;
    Therdal internal therdal;

    address internal operator = address(0xD00D);
    address internal creator = address(0xA11CE);
    address internal submitter = address(0xB0B);
    address internal prover = address(0xCAFE);
    address internal attacker = address(0xBAD);

    uint64 internal constant SNAPSHOT_BLOCK = 1000;
    uint64 internal constant SNAPSHOT_TIMESTAMP = 1_700_000_000;
    bytes internal sampleRlpHeader;

    function setUp() public {
        vm.roll(2000);
        vm.warp(1_700_001_000);

        MockSystemContract mockTemplate = new MockSystemContract();
        vm.etch(EIP2935_ADDR, address(mockTemplate).code);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        controller = new TherdalController(operator, address(usdc), 6);
        blobReader = new MockBlobHashReader();
        verifier = new StarkVerifierAdapter(PROGRAM_VKEY, address(0));
        therdal = new Therdal(address(controller), address(verifier), address(blobReader));

        sampleRlpHeader = RLPEncoderHelper.encodeExecutionHeader(
            keccak256("ADV_EXEC_ROOT"),
            SNAPSHOT_BLOCK,
            SNAPSHOT_TIMESTAMP
        );
        MockSystemContract(EIP2935_ADDR).set(SNAPSHOT_BLOCK, keccak256(sampleRlpHeader));

        usdc.mint(creator, 500_000_000); // $500 USDC
    }

    function testRevertWhenEscrowInsufficientForBatch() public {
        // Creator's $90 escrow funds at most 9,000 votes at $0.01/vote.
        // Trying to settle a batch with 9,001 newly accepted votes ($90.01) MUST revert!
        uint256 resId = _createDefaultResolution();

        bytes32[] memory blob = new bytes32[](1);
        blob[0] = bytes32(uint256(0x01) << 248 | uint256(0x1111));
        blobReader.setBlobHashes(blob);

        vm.prank(submitter);
        therdal.publishBatch(resId, 1);

        _authenticateSnapshot(resId);
        vm.warp(block.timestamp + 3601);

        bytes32 newRoot = keccak256("ROOT_9001");
        uint256[3] memory newTallies = [uint256(9001 ether), uint256(0), uint256(0)];
        bytes memory proof = _buildProof(resId, 0, newRoot, newTallies, 9001, 9001);

        vm.prank(prover);
        (bool ok, ) = address(therdal).call(
            abi.encodeWithSelector(
                Therdal.settleBatch.selector,
                resId,
                0,
                newRoot,
                newTallies,
                9001,
                9001,
                proof
            )
        );
        require(!ok, "Underfunded batch (9,001 votes > $90 capacity) must revert");
    }

    function testBlacklistedSubmitterCannotDoSProverOrDeveloperPayout() public {
        uint256 resId = _createDefaultResolution();

        bytes32[] memory blob = new bytes32[](1);
        blob[0] = bytes32(uint256(0x01) << 248 | uint256(0x2222));
        blobReader.setBlobHashes(blob);

        vm.prank(submitter);
        therdal.publishBatch(resId, 1);

        // Submitter gets blacklisted on USDC before proof settlement
        usdc.setBlacklisted(submitter, true);

        _authenticateSnapshot(resId);
        vm.warp(block.timestamp + 3601);

        // Settle 1,000 accepted votes ($10 USDC fee: $2.50 dev, $2.50 submitter, $5.00 prover)
        bytes32 newRoot = keccak256("ROOT_1000");
        uint256[3] memory newTallies = [uint256(1000 ether), uint256(0), uint256(0)];
        bytes memory proof = _buildProof(resId, 0, newRoot, newTallies, 1000, 1000);

        vm.prank(prover);
        therdal.settleBatch(resId, 0, newRoot, newTallies, 1000, 1000, proof);

        // Prover received $5.00 USDC, Controller received $10 creation + $2.50 = $12.50 USDC
        require(usdc.balanceOf(prover) == 5_000_000, "Prover must receive $5.00 USDC");
        require(usdc.balanceOf(address(controller)) == 12_500_000, "Controller must receive $2.50 USDC");
        require(
            therdal.claimableTokenRewards(address(usdc), submitter) == 2_500_000,
            "Blacklisted submitter's $2.50 USDC must be credited to claimableTokenRewards"
        );

        // Double settlement of batch 0 must revert
        vm.prank(prover);
        (bool okReplay, ) = address(therdal).call(
            abi.encodeWithSelector(
                Therdal.settleBatch.selector,
                resId,
                0,
                newRoot,
                newTallies,
                1000,
                1000,
                proof
            )
        );
        require(!okReplay, "Replay settlement of batch 0 must revert");

        // Finalize (all 1 batches settled) and verify double refund claim reverts
        therdal.finalizeResolution(resId);
        vm.prank(creator);
        uint256 refund = therdal.claimRefund(resId);
        require(refund == 80_000_000, "Creator should recover remaining $80 USDC");

        vm.prank(creator);
        (bool okDoubleRefund, ) = address(therdal).call(
            abi.encodeWithSelector(Therdal.claimRefund.selector, resId)
        );
        require(!okDoubleRefund, "Second refund claim must revert");
    }

    function testUnauthorizedControllerCallsRejected() public {
        vm.prank(attacker);
        (bool ok1, ) = address(controller).call(
            abi.encodeWithSelector(TherdalController.setPricePerVoteUsdMicros.selector, 1)
        );
        require(!ok1, "Attacker cannot change pricePerVote");

        vm.prank(attacker);
        (bool ok2, ) = address(controller).call(
            abi.encodeWithSelector(TherdalController.transferOperator.selector, attacker)
        );
        require(!ok2, "Attacker cannot hijack controller operator");
    }

    function _createDefaultResolution() internal returns (uint256) {
        vm.prank(creator);
        usdc.approve(address(therdal), 100_000_000);

        ITherdal.ResolutionConfig memory cfg = ITherdal.ResolutionConfig({
            questionURI: "ipfs://adv-v02",
            snapshotBlockNumber: SNAPSHOT_BLOCK,
            snapshotBeaconTimestamp: 0,
            snapshotEpoch: 0,
            votingStartsAt: uint64(block.timestamp),
            votingEndsAt: uint64(block.timestamp + 3600),
            settlementDeadline: uint64(block.timestamp + 86400),
            rulesetVersion: 1,
            paymentToken: address(0),
            extraSponsorAmount: 0
        });
        vm.prank(creator);
        return therdal.createResolution(cfg);
    }

    function _authenticateSnapshot(uint256 resId) internal {
        therdal.authenticateSnapshot(
            resId,
            ITherdal.SnapshotAuthProof({
                rlpExecutionHeader: sampleRlpHeader,
                beaconBlockRoot: bytes32(0),
                beaconStateRoot: bytes32(0),
                stateRootBranch: new bytes32[](0),
                executionHashBranch: new bytes32[](0),
                executionHashLeafIndex: 0
            })
        );
    }

    function _buildProof(
        uint256 resId,
        uint256 batchId,
        bytes32 newRoot,
        uint256[3] memory newTallies,
        uint256 newCounted,
        uint256 newlyAcceptedVotes
    ) internal view returns (bytes memory) {
        ITherdal.ResolutionState memory state = therdal.getResolution(resId);
        ITherdal.BatchPublicInputs memory inputs = ITherdal.BatchPublicInputs({
            chainId: block.chainid,
            resolutionId: resId,
            rulesetVersion: state.rulesetVersion,
            snapshotExecutionRoot: state.snapshotExecutionRoot,
            snapshotBeaconRoot: state.snapshotBeaconRoot,
            batchId: batchId,
            registeredBatchCommitment: therdal.getBatch(resId, batchId).commitmentRoot,
            oldPositionRoot: state.positionRoot,
            newPositionRoot: newRoot,
            oldTallies: state.tallies,
            newTallies: newTallies,
            oldCountedPositions: state.countedPositions,
            newCountedPositions: newCounted,
            newlyAcceptedVoteCount: newlyAcceptedVotes
        });
        return abi.encodePacked(verifier.computeExpectedProofTag(inputs));
    }
}
