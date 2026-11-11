// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../contracts/StarkVerifierAdapter.sol";
import "../../contracts/interfaces/ITherdal.sol";

/**
 * @title RustProverCompatibilityTest
 * @notice Verifies 100% bit-for-bit cryptographic compatibility between the Rust `therdal-prover` v0.2
 *         (`therdal-cli demo-e2e` non-sequential batch settlement) and `StarkVerifierAdapter.sol`.
 */
contract RustProverCompatibilityTest {
    bytes32 internal constant PROGRAM_VKEY = keccak256("THERDAL_BATCH_PROGRAM_V2");

    function testRustProverNonSequentialProofTagsVerifyOnChain() public {
        StarkVerifierAdapter adapter = new StarkVerifierAdapter(PROGRAM_VKEY, address(0));

        bytes32 execRoot = 0x79c6e011fd6456df9742e5753dfdf441f1c3b9ddc6bc111d4631619f0cde12e2;
        bytes32 beaconRoot = 0xf6199a60cfe4b6578800be80edbb387041218076ff840599ac729b4b01eccc16;

        // 1. Out-of-order Batch #2 proved FIRST by `therdal-cli demo-e2e` (+4 positions, +2 accepted votes)
        bytes32 batch2Commitment = 0x852dff919bd61daab259f77b5352d85dfe9926432dd52717077c760743c09bfd;
        bytes32 batch2NewPosRoot = 0xf15098ba2fe6c8db920182e3fda1129432e1e44d808134fc3650de5123536018;
        bytes32 batch2RustProofTag = 0xfae10f4e403b8c8881ab4afdb4f18174ba7757fae237f1f4e9f7d5060267ac85;

        ITherdal.BatchPublicInputs memory inputs2 = ITherdal.BatchPublicInputs({
            chainId: 1,
            resolutionId: 1,
            rulesetVersion: 1,
            snapshotExecutionRoot: execRoot,
            snapshotBeaconRoot: beaconRoot,
            batchId: 2,
            registeredBatchCommitment: batch2Commitment,
            oldPositionRoot: bytes32(0),
            newPositionRoot: batch2NewPosRoot,
            oldTallies: [uint256(0), uint256(0), uint256(0)],
            newTallies: [uint256(152 ether), uint256(149 ether), uint256(0)],
            oldCountedPositions: 0,
            newCountedPositions: 4,
            newlyAcceptedVoteCount: 2
        });

        require(
            adapter.verifyBatchTransition(inputs2, abi.encodePacked(batch2RustProofTag)),
            "Batch 2 Rust v0.2 proof tag failed Solidity verification"
        );

        // 2. Out-of-order Batch #1 proved SECOND by `therdal-cli demo-e2e` (+1 position, +1 accepted vote)
        bytes32 batch1Commitment = 0x2a235a9e0d991be64e8051ec0c9641c76357dd84181914b155f874c2b7919daf;
        bytes32 batch1NewPosRoot = 0x4746b1ddcef8015591272635f354ff18e522a4e50b0d841c3e504de71f7a7977;
        bytes32 batch1RustProofTag = 0x56402a650353be2eb49ca221e43a512d740d10459ad850c6b05863336089785e;

        ITherdal.BatchPublicInputs memory inputs1 = ITherdal.BatchPublicInputs({
            chainId: 1,
            resolutionId: 1,
            rulesetVersion: 1,
            snapshotExecutionRoot: execRoot,
            snapshotBeaconRoot: beaconRoot,
            batchId: 1,
            registeredBatchCommitment: batch1Commitment,
            oldPositionRoot: batch2NewPosRoot,
            newPositionRoot: batch1NewPosRoot,
            oldTallies: [uint256(152 ether), uint256(149 ether), uint256(0)],
            newTallies: [uint256(152 ether), uint256(149 ether), uint256(40 ether)],
            oldCountedPositions: 4,
            newCountedPositions: 5,
            newlyAcceptedVoteCount: 1
        });

        require(
            adapter.verifyBatchTransition(inputs1, abi.encodePacked(batch1RustProofTag)),
            "Batch 1 Rust v0.2 proof tag failed Solidity verification"
        );
    }
}
