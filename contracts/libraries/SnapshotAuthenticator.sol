// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITherdal.sol";
import "./RLPReader.sol";
import "./SSZVerifier.sol";

/**
 * @title SnapshotAuthenticator
 * @notice Authenticates pinned execution block numbers and beacon timestamps against Ethereum's
 *         `BLOCKHASH` opcode, EIP-2935 History Storage, and EIP-4788 Beacon Roots contract.
 */
library SnapshotAuthenticator {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    /// @notice EIP-2935 historical block hashes system contract address
    address internal constant EIP2935_HISTORY_STORAGE = 0x0000F90827F1C53a10cb7A02335B175320002935;

    /// @notice EIP-4788 beacon block root system contract address
    address internal constant EIP4788_BEACON_ROOTS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    /// @notice Minimum fields in an Ethereum execution block header
    uint256 internal constant MIN_EXECUTION_HEADER_FIELDS = 15;

    /// @notice Generalized leaf index of `state_root` within `BeaconBlockHeader`
    uint256 internal constant BEACON_HEADER_STATE_ROOT_INDEX = 3;

    /// @notice Tree depth of `BeaconBlockHeader`
    uint256 internal constant BEACON_HEADER_DEPTH = 3;

    error BlockHashUnavailable(uint64 blockNumber);
    error ExecutionHeaderHashMismatch(bytes32 expected, bytes32 actual);
    error InvalidRLPHeaderFieldCount(uint256 count);
    error ExecutionBlockNumberMismatch(uint64 expected, uint64 actual);
    error BeaconRootUnavailable(uint64 timestamp);
    error BeaconBlockRootMismatch(bytes32 expected, bytes32 actual);
    error InvalidBeaconStateRootProof();
    error InvalidExecutionConsensusAlignment();

    /**
     * @notice Authenticates the execution state root (and beacon state root if `snapshotBeaconTimestamp != 0`)
     *         for a resolution's pinned snapshot block/timestamp.
     */
    function authenticate(
        uint64 snapshotBlockNumber,
        uint64 snapshotBeaconTimestamp,
        ITherdal.SnapshotAuthProof calldata proof
    )
        internal
        view
        returns (
            bytes32 executionBlockHash,
            bytes32 snapshotExecutionRoot,
            bytes32 snapshotBeaconRoot
        )
    {
        // 1. Resolve canonical execution block hash for pinned snapshotBlockNumber
        executionBlockHash = getCanonicalExecutionBlockHash(snapshotBlockNumber);

        // 2. Verify RLP-encoded execution header matches canonical block hash
        bytes32 headerHash = keccak256(proof.rlpExecutionHeader);
        if (headerHash != executionBlockHash) {
            revert ExecutionHeaderHashMismatch(executionBlockHash, headerHash);
        }

        // 3. Decode execution header and extract stateRoot (index 3) and number (index 8)
        RLPReader.RLPItem[] memory fields = proof.rlpExecutionHeader.toRlpItem().toList();
        if (fields.length < MIN_EXECUTION_HEADER_FIELDS) {
            revert InvalidRLPHeaderFieldCount(fields.length);
        }

        uint64 decodedBlockNumber = uint64(fields[8].toUint());
        if (decodedBlockNumber != snapshotBlockNumber) {
            revert ExecutionBlockNumberMismatch(snapshotBlockNumber, decodedBlockNumber);
        }

        snapshotExecutionRoot = fields[3].toBytes32Strict();

        // 4. If validator stake voting is enabled for this resolution, authenticate beaconStateRoot
        if (snapshotBeaconTimestamp != 0) {
            bytes32 canonicalBeaconRoot = getCanonicalBeaconBlockRoot(snapshotBeaconTimestamp);
            if (canonicalBeaconRoot != proof.beaconBlockRoot) {
                revert BeaconBlockRootMismatch(canonicalBeaconRoot, proof.beaconBlockRoot);
            }

            if (
                proof.stateRootBranch.length != BEACON_HEADER_DEPTH ||
                !SSZVerifier.verifyBranch(
                    canonicalBeaconRoot,
                    proof.beaconStateRoot,
                    proof.stateRootBranch,
                    BEACON_HEADER_STATE_ROOT_INDEX
                )
            ) {
                revert InvalidBeaconStateRootProof();
            }

            if (
                proof.executionHashBranch.length == 0 ||
                !SSZVerifier.verifyBranch(
                    proof.beaconStateRoot,
                    executionBlockHash,
                    proof.executionHashBranch,
                    proof.executionHashLeafIndex
                )
            ) {
                revert InvalidExecutionConsensusAlignment();
            }

            snapshotBeaconRoot = proof.beaconStateRoot;
        }
    }

    function getCanonicalExecutionBlockHash(uint64 blockNumber)
        internal
        view
        returns (bytes32 canonicalHash)
    {
        if (blockNumber >= block.number) {
            revert BlockHashUnavailable(blockNumber);
        }

        if (block.number - blockNumber <= 256) {
            canonicalHash = blockhash(blockNumber);
            if (canonicalHash != bytes32(0)) {
                return canonicalHash;
            }
        }

        (bool ok, bytes memory ret) = EIP2935_HISTORY_STORAGE.staticcall(abi.encode(uint256(blockNumber)));
        if (ok && ret.length == 32) {
            canonicalHash = abi.decode(ret, (bytes32));
        }

        if (canonicalHash == bytes32(0)) {
            revert BlockHashUnavailable(blockNumber);
        }
    }

    function getCanonicalBeaconBlockRoot(uint64 timestamp)
        internal
        view
        returns (bytes32 beaconRoot)
    {
        if (timestamp == 0) {
            revert BeaconRootUnavailable(timestamp);
        }

        (bool ok, bytes memory ret) = EIP4788_BEACON_ROOTS.staticcall(abi.encode(uint256(timestamp)));
        if (ok && ret.length == 32) {
            beaconRoot = abi.decode(ret, (bytes32));
        }

        if (beaconRoot == bytes32(0)) {
            revert BeaconRootUnavailable(timestamp);
        }
    }
}
