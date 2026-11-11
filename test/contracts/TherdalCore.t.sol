// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../contracts/Therdal.sol";
import "../../contracts/TherdalController.sol";
import "../../contracts/StarkVerifierAdapter.sol";
import "../../contracts/libraries/MerklePatriciaProofVerifier.sol";
import "../../contracts/libraries/SparseMerkleTree.sol";
import "../../contracts/libraries/SSZVerifier.sol";
import "../helpers/TestHelpers.sol";

interface Vm {
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newBlockNumber) external;
    function prank(address msgSender) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
}

/**
 * @title TherdalCoreTest
 * @notice End-to-end unit and integration tests for Therdal Protocol v0.2:
 *         - $100 USDC creation deposit ($10 dev fee to TherdalController + $90 escrow)
 *         - Permissionless blob submitters & non-sequential batch settlement (skipping malformed batches)
 *         - 25% Developer / 25% Submitter / 50% Prover fee split on `newlyAcceptedVoteCount`
 *         - Pro-rata pull refunds matching Section 9.3 ($90 creator + $60 sponsor, $50 unused -> $30 + $20)
 *         - Multi-stablecoin (18-decimal DAI) + DAO operator handoff + price freeze guarantees
 */
contract TherdalCoreTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    bytes32 internal constant PROGRAM_VKEY = keccak256("THERDAL_BATCH_PROGRAM_V2");
    address internal constant EIP2935_ADDR = 0x0000F90827F1C53a10cb7A02335B175320002935;
    address internal constant EIP4788_ADDR = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    MockStablecoin internal usdc;
    MockStablecoin internal dai;
    TherdalController internal controller;
    StarkVerifierAdapter internal verifier;
    MockBlobHashReader internal blobReader;
    Therdal internal therdal;

    address internal controllerSigner = address(0xD00D);
    address internal daoTimelock = address(0xDA00);
    address internal creator = address(0xA11CE);
    address internal sponsorAddr = address(0x5005);
    address internal spamSubmitter = address(0xBAD1);
    address internal submitterA = address(0xB0B1);
    address internal submitterB = address(0xB0B2);
    address internal prover1 = address(0xCAFE1);
    address internal prover2 = address(0xCAFE2);

    uint64 internal constant SNAPSHOT_BLOCK = 1000;
    uint64 internal constant SNAPSHOT_TIMESTAMP = 1_700_000_000;
    uint64 internal constant SNAPSHOT_EPOCH = 250_000;

    bytes32 internal sampleExecutionStateRoot;
    bytes internal sampleRlpHeader;
    bytes32 internal sampleHeaderHash;

    function setUp() public {
        vm.roll(2000);
        vm.warp(1_700_001_000);

        MockSystemContract mockTemplate = new MockSystemContract();
        vm.etch(EIP2935_ADDR, address(mockTemplate).code);
        vm.etch(EIP4788_ADDR, address(mockTemplate).code);

        usdc = new MockStablecoin("USD Coin", "USDC", 6);
        dai = new MockStablecoin("Dai Stablecoin", "DAI", 18);

        controller = new TherdalController(controllerSigner, address(usdc), 6);
        blobReader = new MockBlobHashReader();
        verifier = new StarkVerifierAdapter(PROGRAM_VKEY, address(0));
        therdal = new Therdal(address(controller), address(verifier), address(blobReader));

        sampleExecutionStateRoot = keccak256("SAMPLE_EXECUTION_STATE_ROOT");
        sampleRlpHeader = RLPEncoderHelper.encodeExecutionHeader(
            sampleExecutionStateRoot,
            SNAPSHOT_BLOCK,
            SNAPSHOT_TIMESTAMP
        );
        sampleHeaderHash = keccak256(sampleRlpHeader);
        MockSystemContract(EIP2935_ADDR).set(SNAPSHOT_BLOCK, sampleHeaderHash);

        usdc.mint(creator, 1_000_000_000); // $1,000 USDC
        usdc.mint(sponsorAddr, 1_000_000_000); // $1,000 USDC
    }

    function testV02FeeSplittingNonSequentialSettlementAndProRataRefunds() public {
        // 1. Creator approves $100 USDC (100_000_000) and creates resolution
        vm.prank(creator);
        usdc.approve(address(therdal), 100_000_000);

        ITherdal.ResolutionConfig memory cfg = ITherdal.ResolutionConfig({
            questionURI: "ipfs://therdal-v02-fee-split",
            snapshotBlockNumber: SNAPSHOT_BLOCK,
            snapshotBeaconTimestamp: 0,
            snapshotEpoch: SNAPSHOT_EPOCH,
            votingStartsAt: uint64(block.timestamp),
            votingEndsAt: uint64(block.timestamp + 3600),
            settlementDeadline: uint64(block.timestamp + 86400),
            rulesetVersion: 1,
            paymentToken: address(0), // uses default USDC
            extraSponsorAmount: 0
        });

        vm.prank(creator);
        uint256 resId = therdal.createResolution(cfg);
        require(resId == 1, "Expected resolutionId 1");

        // Verify $10 USDC went to TherdalController (developer smart account) and $90 USDC is in escrow
        require(usdc.balanceOf(address(controller)) == 10_000_000, "Controller should hold $10 creation fee");
        require(therdal.remainingEscrow(resId) == 90_000_000, "Escrow should hold $90");
        require(therdal.contributorEscrow(resId, creator) == 90_000_000, "Creator refundable basis must be $90");

        // 2. Additional Sponsor contributes $60 USDC (100% into escrow -> total C = $150 USDC)
        vm.prank(sponsorAddr);
        usdc.approve(address(therdal), 60_000_000);
        vm.prank(sponsorAddr);
        therdal.sponsor(resId, 60_000_000);

        require(therdal.totalEscrowContributed(resId) == 150_000_000, "Total escrow C should be $150");
        require(therdal.remainingEscrow(resId) == 150_000_000, "Remaining escrow should be $150");

        // 3. Permissionless blob publications during Open window:
        //    - Batch 0: spamSubmitter posts a malformed blob (never settled!)
        //    - Batch 1: submitterA posts valid blob (4,000 accepted votes across 4,500 positions)
        //    - Batch 2: submitterB posts valid blob (6,000 accepted votes across 7,000 positions)
        bytes32[] memory blob = new bytes32[](1);

        blob[0] = bytes32(uint256(0x01) << 248 | uint256(0xDEAD));
        blobReader.setBlobHashes(blob);
        vm.prank(spamSubmitter);
        require(therdal.publishBatch(resId, 1) == 0, "Expected batch 0");

        blob[0] = bytes32(uint256(0x01) << 248 | uint256(0xAAAA));
        blobReader.setBlobHashes(blob);
        vm.prank(submitterA);
        require(therdal.publishBatch(resId, 1) == 1, "Expected batch 1");

        blob[0] = bytes32(uint256(0x01) << 248 | uint256(0xBBBB));
        blobReader.setBlobHashes(blob);
        vm.prank(submitterB);
        require(therdal.publishBatch(resId, 1) == 2, "Expected batch 2");

        // Submitters get $0 at publication time
        require(usdc.balanceOf(submitterA) == 0 && usdc.balanceOf(submitterB) == 0, "Zero upfront payout");

        // 4. Controller changes global pricePerVote to $0.05/vote -> MUST NOT affect Resolution #1's frozen $0.01/vote!
        vm.prank(controllerSigner);
        controller.setPricePerVoteUsdMicros(50_000);
        require(therdal.getResolution(resId).pricePerVote == 10_000, "Resolution #1 price must remain frozen at $0.01");

        // 5. Authenticate snapshot and warp into Settling phase
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
        vm.warp(block.timestamp + 3601);

        // 6. NON-SEQUENTIAL SETTLEMENT: Prover 2 settles Batch #2 FIRST (skipping Batch #0 and Batch #1)!
        //    6,000 newly accepted votes -> Fee F = $60 USDC:
        //      - 25% Developer (controller): +$15 USDC (total = $10 + $15 = $25 USDC)
        //      - 25% submitterB:             +$15 USDC
        //      - 50% prover2:                +$30 USDC
        bytes32 rootAfterBatch2 = keccak256("SMT_AFTER_BATCH_2");
        uint256[3] memory talliesAfter2 = [uint256(5000 ether), uint256(2000 ether), uint256(0)];
        bytes memory proofBatch2 = _buildValidProof(
            resId,
            2,
            therdal.getBatch(resId, 2).commitmentRoot,
            bytes32(0),
            rootAfterBatch2,
            [uint256(0), uint256(0), uint256(0)],
            talliesAfter2,
            0,
            7000, // 7000 positions (some voters claimed multiple validators)
            6000  // 6000 newly accepted valid votes
        );

        vm.prank(prover2);
        therdal.settleBatch(resId, 2, rootAfterBatch2, talliesAfter2, 7000, 6000, proofBatch2);

        require(usdc.balanceOf(address(controller)) == 25_000_000, "Controller should have $10 + $15 = $25");
        require(usdc.balanceOf(submitterB) == 15_000_000, "submitterB should receive $15 (25%)");
        require(usdc.balanceOf(prover2) == 30_000_000, "prover2 should receive $30 (50%)");

        // 7. Prover 1 settles Batch #1 SECOND (still bypassing malformed Batch #0)!
        //    4,000 newly accepted votes -> Fee F = $40 USDC:
        //      - 25% Developer (controller): +$10 USDC (total = $35 USDC)
        //      - 25% submitterA:             +$10 USDC
        //      - 50% prover1:                +$20 USDC
        bytes32 rootAfterBatch1 = keccak256("SMT_AFTER_BATCH_2_AND_1");
        uint256[3] memory talliesAfter1 = [uint256(8000 ether), uint256(3500 ether), uint256(500 ether)];
        bytes memory proofBatch1 = _buildValidProof(
            resId,
            1,
            therdal.getBatch(resId, 1).commitmentRoot,
            rootAfterBatch2,
            rootAfterBatch1,
            talliesAfter2,
            talliesAfter1,
            7000,
            11500, // +4500 positions
            4000   // 4000 newly accepted valid votes
        );

        vm.prank(prover1);
        therdal.settleBatch(resId, 1, rootAfterBatch1, talliesAfter1, 11500, 4000, proofBatch1);

        require(usdc.balanceOf(address(controller)) == 35_000_000, "Controller should have $35 USDC");
        require(usdc.balanceOf(submitterA) == 10_000_000, "submitterA should receive $10 (25%)");
        require(usdc.balanceOf(prover1) == 20_000_000, "prover1 should receive $20 (50%)");
        require(usdc.balanceOf(spamSubmitter) == 0, "Malformed batch submitter gets $0");

        // Remaining unused escrow U = $150 - $100 = $50 USDC!
        require(therdal.remainingEscrow(resId) == 50_000_000, "Expected $50 unused escrow");

        // 8. Warp past settlementDeadline and call closeSettlementAndEnableRefunds (Section 9.3)
        vm.warp(block.timestamp + 90_000);
        therdal.closeSettlementAndEnableRefunds(resId);
        require(therdal.frozenUnusedEscrow(resId) == 50_000_000, "Frozen U must be $50");

        // Section 9.3 exact check:
        // Creator ($90 / $150 of $50) -> claims $30 USDC!
        // Sponsor ($60 / $150 of $50) -> claims $20 USDC!
        uint256 creatorBalBefore = usdc.balanceOf(creator);
        vm.prank(creator);
        uint256 creatorRefund = therdal.claimRefund(resId);
        require(creatorRefund == 30_000_000, "Creator must receive $30 USDC pro-rata refund");
        require(usdc.balanceOf(creator) == creatorBalBefore + 30_000_000, "Creator USDC balance mismatch");

        uint256 sponsorBalBefore = usdc.balanceOf(sponsorAddr);
        vm.prank(sponsorAddr);
        uint256 sponsorRefund = therdal.claimRefund(resId);
        require(sponsorRefund == 20_000_000, "Sponsor must receive $20 USDC pro-rata refund");
        require(usdc.balanceOf(sponsorAddr) == sponsorBalBefore + 20_000_000, "Sponsor USDC balance mismatch");
    }

    function testMultiStablecoin18DecimalsAndDaoSmartAccountHandoff() public {
        // 1. Operator allowlists 18-decimal DAI and hands off TherdalController to DAO Timelock
        vm.prank(controllerSigner);
        controller.configureStablecoin(address(dai), 18, true);

        vm.prank(controllerSigner);
        controller.transferOperator(daoTimelock);
        require(controller.operator() == daoTimelock, "Operator should now be DAO Timelock");

        // 2. Creator creates resolution denominated in 18-decimal DAI ($100 = 100e18 DAI: 10e18 fee + 90e18 escrow)
        dai.mint(creator, 500 ether);
        vm.prank(creator);
        dai.approve(address(therdal), 100 ether);

        ITherdal.ResolutionConfig memory cfg = ITherdal.ResolutionConfig({
            questionURI: "ipfs://dai-18-decimal-resolution",
            snapshotBlockNumber: SNAPSHOT_BLOCK,
            snapshotBeaconTimestamp: 0,
            snapshotEpoch: SNAPSHOT_EPOCH,
            votingStartsAt: uint64(block.timestamp),
            votingEndsAt: uint64(block.timestamp + 3600),
            settlementDeadline: uint64(block.timestamp + 86400),
            rulesetVersion: 1,
            paymentToken: address(dai),
            extraSponsorAmount: 0
        });

        vm.prank(creator);
        uint256 resId = therdal.createResolution(cfg);

        require(dai.balanceOf(address(controller)) == 10 ether, "Controller should hold 10 DAI creation fee");
        require(therdal.remainingEscrow(resId) == 90 ether, "Escrow should hold 90 DAI");
        require(therdal.getResolution(resId).pricePerVote == 0.01 ether, "Frozen DAI pricePerVote should be 0.01 DAI");

        // 3. DAO withdraws 10 DAI from TherdalController treasury
        address daoTreasury = address(0x7777);
        vm.prank(daoTimelock);
        controller.withdrawToken(address(dai), daoTreasury, 10 ether);
        require(dai.balanceOf(daoTreasury) == 10 ether, "DAO treasury withdrawal failed");
    }

    function _buildValidProof(
        uint256 resolutionId,
        uint256 batchId,
        bytes32 commitmentRoot,
        bytes32 oldPositionRoot,
        bytes32 newPositionRoot,
        uint256[3] memory oldTallies,
        uint256[3] memory newTallies,
        uint256 oldCounted,
        uint256 newCounted,
        uint256 newlyAcceptedVotes
    ) internal view returns (bytes memory) {
        ITherdal.ResolutionState memory state = therdal.getResolution(resolutionId);
        ITherdal.BatchPublicInputs memory inputs = ITherdal.BatchPublicInputs({
            chainId: block.chainid,
            resolutionId: resolutionId,
            rulesetVersion: state.rulesetVersion,
            snapshotExecutionRoot: state.snapshotExecutionRoot,
            snapshotBeaconRoot: state.snapshotBeaconRoot,
            batchId: batchId,
            registeredBatchCommitment: commitmentRoot,
            oldPositionRoot: oldPositionRoot,
            newPositionRoot: newPositionRoot,
            oldTallies: oldTallies,
            newTallies: newTallies,
            oldCountedPositions: oldCounted,
            newCountedPositions: newCounted,
            newlyAcceptedVoteCount: newlyAcceptedVotes
        });
        bytes32 tag = verifier.computeExpectedProofTag(inputs);
        return abi.encodePacked(tag);
    }
}
