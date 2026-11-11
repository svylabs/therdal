// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/ITherdal.sol";

interface IExternalZkVerifier {
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}

/**
 * @title StarkVerifierAdapter
 * @notice Pinned, versioned verifier adapter that computes the canonical 608-byte (`19 * 32`)
 *         public inputs digest (including `newlyAcceptedVoteCount`) and verifies batch settlement proofs.
 */
contract StarkVerifierAdapter {
    /// @notice Domain constant for v0.2 public input hashing: `keccak256("THERDAL_PUBLIC_INPUTS_V2")`
    bytes32 public constant PUBLIC_INPUTS_DOMAIN = keccak256("THERDAL_PUBLIC_INPUTS_V2");

    /// @notice Domain prefix for deterministic STARK commitment proofs in local/test mode
    bytes32 public constant PROOF_COMMITMENT_DOMAIN = keccak256("THERDAL_STARK_PROOF_V2");

    /// @notice Pinned zkVM / STARK program verification key
    bytes32 public immutable programVKey;

    /// @notice Optional external on-chain STARK/SNARK verifier contract (`address(0)` in standalone/test mode)
    address public immutable externalVerifier;

    constructor(bytes32 _programVKey, address _externalVerifier) {
        programVKey = _programVKey;
        externalVerifier = _externalVerifier;
    }

    /**
     * @notice Computes the canonical 32-byte digest over the 19 fixed 32-byte words (608 bytes) of `BatchPublicInputs`.
     */
    function computePublicInputsDigest(ITherdal.BatchPublicInputs memory inputs)
        public
        pure
        returns (bytes32)
    {
        return
            keccak256(
                abi.encode(
                    PUBLIC_INPUTS_DOMAIN,
                    inputs.chainId,
                    inputs.resolutionId,
                    uint256(inputs.rulesetVersion),
                    inputs.snapshotExecutionRoot,
                    inputs.snapshotBeaconRoot,
                    inputs.batchId,
                    inputs.registeredBatchCommitment,
                    inputs.oldPositionRoot,
                    inputs.newPositionRoot,
                    inputs.oldTallies[0],
                    inputs.oldTallies[1],
                    inputs.oldTallies[2],
                    inputs.newTallies[0],
                    inputs.newTallies[1],
                    inputs.newTallies[2],
                    inputs.oldCountedPositions,
                    inputs.newCountedPositions,
                    inputs.newlyAcceptedVoteCount
                )
            );
    }

    /**
     * @notice Verifies a settlement proof against the canonical `BatchPublicInputs`.
     */
    function verifyBatchTransition(
        ITherdal.BatchPublicInputs memory inputs,
        bytes calldata proof
    ) external view returns (bool) {
        if (proof.length < 32) {
            return false;
        }

        bytes32 digest = computePublicInputsDigest(inputs);

        if (externalVerifier != address(0)) {
            try
                IExternalZkVerifier(externalVerifier).verifyProof(
                    programVKey,
                    abi.encodePacked(digest),
                    proof
                )
            {
                return true;
            } catch {
                return false;
            }
        }

        bytes32 expectedTag = keccak256(abi.encodePacked(PROOF_COMMITMENT_DOMAIN, programVKey, digest));
        bytes32 providedTag = bytes32(proof[0:32]);
        return providedTag == expectedTag;
    }

    /**
     * @notice Helper to compute the expected 32-byte proof tag for a given `BatchPublicInputs`.
     */
    function computeExpectedProofTag(ITherdal.BatchPublicInputs memory inputs)
        external
        view
        returns (bytes32)
    {
        bytes32 digest = computePublicInputsDigest(inputs);
        return keccak256(abi.encodePacked(PROOF_COMMITMENT_DOMAIN, programVKey, digest));
    }
}
