// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../interfaces/IDirectVoting.sol";
import {RLPReader} from "./RLPReader.sol";
import {SSZVerifier} from "./SSZVerifier.sol";

/**
 * @title SnapshotAuthenticator
 * @notice Authenticates a topic's Execution Layer `snapshotExecutionRoot` (`stateRoot`) and
 *         Beacon Chain `snapshotBeaconRoot` (`state_root`) + `snapshotEpoch` against the
 *         pinned `snapshotBlockHash`, EIP-2935 History Storage, and EIP-4788 Beacon Roots.
 */
library SnapshotAuthenticator {
    using RLPReader for RLPReader.RlpItem;
    using RLPReader for bytes;

    /// @notice EIP-2935 historical execution block hashes system contract address
    address internal constant EIP2935_HISTORY_STORAGE = 0x0000F90827F1C53a10cb7A02335B175320002935;

    /// @notice EIP-4788 parent beacon block root system contract address
    address internal constant EIP4788_BEACON_ROOTS = 0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02;

    /// @notice Minimum fields in a post-Merge / Cancun Ethereum execution block header
    uint256 internal constant MIN_EXECUTION_HEADER_FIELDS = 15;

    error BlockHashUnavailable(uint64 blockNumber);
    error ExecutionHeaderHashMismatch(bytes32 expected, bytes32 actual);
    error InvalidRLPHeaderFieldCount(uint256 count);
    error ExecutionBlockNumberMismatch(uint64 expected, uint256 actual);
    error EmptyExecutionStateRoot();
    error BeaconRootUnavailable(uint64 timestamp);
    error InvalidBeaconStateRootProof();
    error InvalidBeaconSlotProof();
    error InvalidExecutionConsensusAlignment();

    /**
     * @notice Best-effort read of `parentBeaconBlockRoot` from EIP-4788 during `createTopic`.
     *         In block `B`, `EIP4788(block.timestamp)` holds the Beacon Block root of parent block `B - 1`
     *         (matching `snapshotBlock = B - 1`), preventing EIP-4788's 8,191-slot ring buffer expiry.
     *         Returns `bytes32(0)` gracefully on local test environments without EIP-4788 deployed.
     */
    function tryReadParentBeaconRoot(uint64 timestamp) internal view returns (bytes32 beaconRoot) {
        if (timestamp == 0 || EIP4788_BEACON_ROOTS.code.length == 0) {
            return bytes32(0);
        }
        (bool ok, bytes memory ret) = EIP4788_BEACON_ROOTS.staticcall(
            abi.encode(uint256(timestamp))
        );
        if (ok && ret.length == 32) {
            beaconRoot = abi.decode(ret, (bytes32));
        }
    }

    /**
     * @notice Authenticates `snapshotExecutionRoot` (`stateRoot`) from an RLP-encoded execution block header
     *         against `pinnedBlockHash` (or `BLOCKHASH` / EIP-2935 fallback) and `expectedBlockNumber`.
     */
    function authenticateExecutionHeader(
        uint64 expectedBlockNumber,
        bytes32 pinnedBlockHash,
        bytes calldata rlpExecutionHeader
    ) internal view returns (bytes32 canonicalBlockHash, bytes32 snapshotExecutionRoot) {
        canonicalBlockHash = pinnedBlockHash != bytes32(0)
            ? pinnedBlockHash
            : getCanonicalExecutionBlockHash(expectedBlockNumber);

        bytes32 headerHash = keccak256(rlpExecutionHeader);
        if (headerHash != canonicalBlockHash) {
            revert ExecutionHeaderHashMismatch(canonicalBlockHash, headerHash);
        }

        bytes memory headerMem = rlpExecutionHeader;
        RLPReader.RlpItem[] memory fields = headerMem.toRlpItem().toList();
        if (fields.length < MIN_EXECUTION_HEADER_FIELDS) {
            revert InvalidRLPHeaderFieldCount(fields.length);
        }

        uint256 decodedBlockNumber = fields[8].toUint();
        if (decodedBlockNumber != uint256(expectedBlockNumber)) {
            revert ExecutionBlockNumberMismatch(expectedBlockNumber, decodedBlockNumber);
        }

        snapshotExecutionRoot = fields[3].toBytes32Strict();
        if (snapshotExecutionRoot == bytes32(0)) {
            revert EmptyExecutionStateRoot();
        }
    }

    /**
     * @notice Authenticates `snapshotBeaconRoot` and `snapshotEpoch = beaconSlot / 32` aligned with
     *         `pinnedExecutionBlockHash` via `BeaconState.latest_execution_payload_header.block_hash`.
     */
    function authenticateBeaconSnapshot(
        uint64 expectedBlockNumber,
        bytes32 pinnedExecutionBlockHash,
        bytes32 pinnedBeaconBlockRoot,
        IDirectVoting.BeaconSnapshotAuthProof calldata proof
    )
        internal
        view
        returns (
            bytes32 canonicalBeaconBlockRoot,
            bytes32 snapshotBeaconRoot,
            uint64 snapshotEpoch
        )
    {
        bytes32 executionHash = pinnedExecutionBlockHash != bytes32(0)
            ? pinnedExecutionBlockHash
            : getCanonicalExecutionBlockHash(expectedBlockNumber);

        canonicalBeaconBlockRoot = pinnedBeaconBlockRoot != bytes32(0)
            ? pinnedBeaconBlockRoot
            : getCanonicalBeaconBlockRoot(proof.childBlockTimestamp);

        if (
            proof.beaconStateRoot == bytes32(0) ||
            proof.stateRootBranch.length != SSZVerifier.BEACON_HEADER_DEPTH ||
            !SSZVerifier.verifyBranch(
                canonicalBeaconBlockRoot,
                proof.beaconStateRoot,
                proof.stateRootBranch,
                SSZVerifier.BEACON_HEADER_STATE_ROOT_INDEX
            )
        ) {
            revert InvalidBeaconStateRootProof();
        }

        if (
            proof.slotBranch.length != SSZVerifier.BEACON_HEADER_DEPTH ||
            !SSZVerifier.verifyBranch(
                canonicalBeaconBlockRoot,
                SSZVerifier.toLittleEndian64Chunk(proof.beaconSlot),
                proof.slotBranch,
                SSZVerifier.BEACON_HEADER_SLOT_INDEX
            )
        ) {
            revert InvalidBeaconSlotProof();
        }

        uint256 alignLen = proof.executionHashBranch.length;
        if (
            (alignLen != SSZVerifier.EXECUTION_ALIGN_DENEB_DEPTH &&
                alignLen != SSZVerifier.EXECUTION_ALIGN_ELECTRA_DEPTH) ||
            !SSZVerifier.verifyBranch(
                proof.beaconStateRoot,
                executionHash,
                proof.executionHashBranch,
                SSZVerifier.EXECUTION_BLOCK_HASH_LEAF_INDEX
            )
        ) {
            revert InvalidExecutionConsensusAlignment();
        }

        snapshotBeaconRoot = proof.beaconStateRoot;
        snapshotEpoch = proof.beaconSlot / SSZVerifier.SLOTS_PER_EPOCH;
    }

    /**
     * @notice Resolves a historical execution block hash via `BLOCKHASH` (`<= 256` blocks) or EIP-2935.
     */
    function getCanonicalExecutionBlockHash(
        uint64 blockNumber
    ) internal view returns (bytes32 canonicalHash) {
        if (blockNumber >= block.number) {
            revert BlockHashUnavailable(blockNumber);
        }

        if (block.number - blockNumber <= 256) {
            canonicalHash = blockhash(blockNumber);
            if (canonicalHash != bytes32(0)) {
                return canonicalHash;
            }
        }

        if (EIP2935_HISTORY_STORAGE.code.length > 0) {
            (bool ok, bytes memory ret) = EIP2935_HISTORY_STORAGE.staticcall(
                abi.encode(uint256(blockNumber))
            );
            if (ok && ret.length == 32) {
                canonicalHash = abi.decode(ret, (bytes32));
            }
        }

        if (canonicalHash == bytes32(0)) {
            revert BlockHashUnavailable(blockNumber);
        }
    }

    /**
     * @notice Queries the EIP-4788 Beacon Roots contract for a canonical parent beacon block root.
     */
    function getCanonicalBeaconBlockRoot(
        uint64 timestamp
    ) internal view returns (bytes32 beaconRoot) {
        if (timestamp == 0 || EIP4788_BEACON_ROOTS.code.length == 0) {
            revert BeaconRootUnavailable(timestamp);
        }

        (bool ok, bytes memory ret) = EIP4788_BEACON_ROOTS.staticcall(
            abi.encode(uint256(timestamp))
        );
        if (ok && ret.length == 32) {
            beaconRoot = abi.decode(ret, (bytes32));
        }

        if (beaconRoot == bytes32(0)) {
            revert BeaconRootUnavailable(timestamp);
        }
    }
}
