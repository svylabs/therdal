// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SSZVerifier
 * @notice SHA-256 Simple Serialize (SSZ) Merkleization and inclusion verification library for
 *         Ethereum Beacon Chain headers, execution payload alignment, and `Validator` stake proofs.
 */
library SSZVerifier {
    /// @notice EVM SHA-256 precompile address
    address internal constant SHA256_PRECOMPILE = address(0x02);

    /// @notice Slots per Beacon Chain epoch
    uint64 internal constant SLOTS_PER_EPOCH = 32;

    /// @notice Tree depth of `BeaconBlockHeader` (`5` fields -> `8` leaves -> depth `3`)
    uint256 internal constant BEACON_HEADER_DEPTH = 3;

    /// @notice 0-based leaf index of `slot` within `BeaconBlockHeader`
    uint256 internal constant BEACON_HEADER_SLOT_INDEX = 0;

    /// @notice 0-based leaf index of `state_root` within `BeaconBlockHeader`
    uint256 internal constant BEACON_HEADER_STATE_ROOT_INDEX = 3;

    /// @notice Binary Merkle tree depth of `VALIDATOR_REGISTRY_LIMIT` (`2**40`)
    uint256 internal constant VALIDATOR_REGISTRY_DEPTH = 40;

    /// @notice Maximum number of validators in `List[Validator, 2**40]`
    uint64 internal constant VALIDATOR_REGISTRY_LIMIT = uint64(1) << 40;

    /// @notice Field index of `validators` within `BeaconState` across all forks (Phase0..Electra)
    uint256 internal constant BEACON_STATE_VALIDATORS_FIELD_INDEX = 11;

    /// @notice `BeaconState` top-level SSZ tree depth in Deneb (`28` fields -> `32` chunks)
    uint256 internal constant BEACON_STATE_DENEB_DEPTH = 5;

    /// @notice `BeaconState` top-level SSZ tree depth in Electra/Pectra (`37` fields -> `64` chunks)
    uint256 internal constant BEACON_STATE_ELECTRA_DEPTH = 6;

    /// @notice 0-based leaf index of `latest_execution_payload_header.block_hash` inside `BeaconState`:
    ///         field `24` (`latest_execution_payload_header`) * `32` (`ExecutionPayloadHeader` chunks) + `12` (`block_hash`) = `780`
    uint256 internal constant EXECUTION_BLOCK_HASH_LEAF_INDEX = (24 << 5) | 12;

    /// @notice Branch length from `latest_execution_payload_header.block_hash` to `BeaconState` root in Deneb (`5 + 5 = 10`)
    uint256 internal constant EXECUTION_ALIGN_DENEB_DEPTH = 10;

    /// @notice Branch length from `latest_execution_payload_header.block_hash` to `BeaconState` root in Electra (`5 + 6 = 11`)
    uint256 internal constant EXECUTION_ALIGN_ELECTRA_DEPTH = 11;

    error SHA256PrecompileFailed();

    /**
     * @notice Verifies a SHA-256 SSZ Merkle inclusion branch from `leaf` at 0-based `leafIndex` up to `root`.
     */
    function verifyBranch(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata branch,
        uint256 leafIndex
    ) internal view returns (bool) {
        bytes32 cur = computeBranchRoot(leaf, branch, leafIndex);
        return cur == root;
    }

    /**
     * @notice Traverses a SHA-256 SSZ Merkle branch upward from `leaf` along the bits of `leafIndex`.
     */
    function computeBranchRoot(
        bytes32 leaf,
        bytes32[] calldata branch,
        uint256 leafIndex
    ) internal view returns (bytes32 cur) {
        cur = leaf;
        uint256 len = branch.length;
        for (uint256 i = 0; i < len; i++) {
            if (((leafIndex >> i) & 1) == 1) {
                cur = sha256Pair(branch[i], cur);
            } else {
                cur = sha256Pair(cur, branch[i]);
            }
        }
    }

    /**
     * @notice Computes `SHA256(left || right)` using EVM precompile `0x02`.
     */
    function sha256Pair(bytes32 left, bytes32 right) internal view returns (bytes32 digest) {
        bytes memory input = abi.encodePacked(left, right);
        (bool ok, bytes memory out) = SHA256_PRECOMPILE.staticcall(input);
        if (!ok || out.length != 32) {
            revert SHA256PrecompileFailed();
        }
        digest = abi.decode(out, (bytes32));
    }

    /**
     * @notice Encodes a `uint64` as a 32-byte SSZ little-endian chunk (`bytes[0..8] = le(value), bytes[8..32] = 0`).
     */
    function toLittleEndian64Chunk(uint64 value) internal pure returns (bytes32 chunk) {
        uint256 le = 0;
        uint256 v = uint256(value);
        for (uint256 i = 0; i < 8; i++) {
            le |= (v & 0xff) << ((31 - i) * 8);
            v >>= 8;
        }
        chunk = bytes32(le);
    }

    /**
     * @notice Decodes and validates a canonical 32-byte SSZ little-endian `uint64` chunk.
     *         Returns `(false, 0)` if any padding byte in `chunk[8..32]` is non-zero.
     */
    function decodeLittleEndian64Chunk(
        bytes32 chunk
    ) internal pure returns (bool valid, uint64 value) {
        uint256 raw = uint256(chunk);
        // Low 192 bits (bytes 8..31) MUST be zero in canonical SSZ uint64 chunking
        if ((raw & ((uint256(1) << 192) - 1)) != 0) {
            return (false, 0);
        }
        uint256 acc = 0;
        for (uint256 i = 0; i < 8; i++) {
            uint256 byteVal = (raw >> ((31 - i) * 8)) & 0xff;
            acc |= byteVal << (i * 8);
        }
        // casting to 'uint64' is safe because acc accumulates 8 bytes (<= type(uint64).max)
        // forge-lint: disable-next-line(unsafe-typecast)
        return (true, uint64(acc));
    }

    /**
     * @notice Encodes a `bool` as a 32-byte SSZ chunk (`0x0100...00` for `true`, `0x0000...00` for `false`).
     */
    function toBoolChunk(bool value) internal pure returns (bytes32) {
        return value ? bytes32(uint256(1) << 248) : bytes32(0);
    }

    /**
     * @notice Computes `hash_tree_root(Validator)` for an 8-field Beacon Chain `Validator` SSZ container.
     */
    function computeValidatorRoot(
        bytes32 pubkeyRoot,
        bytes32 withdrawalCredentials,
        uint64 effectiveBalanceGwei,
        bool slashed,
        uint64 activationEligibilityEpoch,
        uint64 activationEpoch,
        uint64 exitEpoch,
        uint64 withdrawableEpoch
    ) internal view returns (bytes32) {
        bytes32 n00 = sha256Pair(pubkeyRoot, withdrawalCredentials);
        bytes32 n01 = sha256Pair(
            toLittleEndian64Chunk(effectiveBalanceGwei),
            toBoolChunk(slashed)
        );
        bytes32 n02 = sha256Pair(
            toLittleEndian64Chunk(activationEligibilityEpoch),
            toLittleEndian64Chunk(activationEpoch)
        );
        bytes32 n03 = sha256Pair(
            toLittleEndian64Chunk(exitEpoch),
            toLittleEndian64Chunk(withdrawableEpoch)
        );

        bytes32 n10 = sha256Pair(n00, n01);
        bytes32 n11 = sha256Pair(n02, n03);

        return sha256Pair(n10, n11);
    }

    /**
     * @notice Verifies a `Validator` root at `validatorIndex` inside `snapshotBeaconRoot` (`BeaconState`):
     *         1. Walks the depth-40 `validators` data tree strictly along the bits of `validatorIndex`
     *            (binding `validatorIndex` cryptographically so no validator leaf can be replayed under another index).
     *         2. Validates `validatorsLengthChunk` (`validatorIndex < validatorCount <= 2**40`) and mixes in length.
     *         3. Walks the `BeaconState` container branch (`5` levels in Deneb, `6` levels in Electra) at field `11`.
     */
    function verifyValidatorInBeaconState(
        bytes32 snapshotBeaconRoot,
        uint64 validatorIndex,
        bytes32 validatorRoot,
        bytes32[] calldata validatorBranch,
        bytes32 validatorsLengthChunk,
        bytes32[] calldata beaconStateBranch
    ) internal view returns (bool) {
        if (snapshotBeaconRoot == bytes32(0)) {
            return false;
        }
        if (validatorIndex >= VALIDATOR_REGISTRY_LIMIT) {
            return false;
        }
        if (validatorBranch.length != VALIDATOR_REGISTRY_DEPTH) {
            return false;
        }
        if (
            beaconStateBranch.length != BEACON_STATE_DENEB_DEPTH &&
            beaconStateBranch.length != BEACON_STATE_ELECTRA_DEPTH
        ) {
            return false;
        }

        (bool validLen, uint64 validatorCount) = decodeLittleEndian64Chunk(validatorsLengthChunk);
        if (
            !validLen ||
            validatorIndex >= validatorCount ||
            validatorCount > VALIDATOR_REGISTRY_LIMIT
        ) {
            return false;
        }

        bytes32 validatorsDataRoot = computeBranchRoot(
            validatorRoot,
            validatorBranch,
            uint256(validatorIndex)
        );
        bytes32 validatorsListRoot = sha256Pair(validatorsDataRoot, validatorsLengthChunk);
        bytes32 computedBeaconStateRoot = computeBranchRoot(
            validatorsListRoot,
            beaconStateBranch,
            BEACON_STATE_VALIDATORS_FIELD_INDEX
        );

        return computedBeaconStateRoot == snapshotBeaconRoot;
    }
}
