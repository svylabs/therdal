// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SSZVerifier
 * @notice SHA-256 Simple Serialize (SSZ) Merkleization and branch verification helpers for Ethereum Beacon chain proofs.
 */
library SSZVerifier {
    address internal constant SHA256_PRECOMPILE = address(0x02);

    error SHA256PrecompileFailed();

    function verifyBranch(
        bytes32 root,
        bytes32 leaf,
        bytes32[] memory branch,
        uint256 index
    ) internal view returns (bool isValid) {
        bytes32 value = leaf;
        uint256 len = branch.length;

        for (uint256 i = 0; i < len; i++) {
            if (((index >> i) & 1) == 1) {
                value = sha256Pair(branch[i], value);
            } else {
                value = sha256Pair(value, branch[i]);
            }
        }
        return value == root;
    }

    function sha256Pair(bytes32 left, bytes32 right) internal view returns (bytes32 result) {
        bytes memory input = abi.encodePacked(left, right);
        (bool ok, bytes memory out) = SHA256_PRECOMPILE.staticcall(input);
        if (!ok || out.length != 32) revert SHA256PrecompileFailed();
        result = abi.decode(out, (bytes32));
    }

    function toLittleEndian64Chunk(uint64 value) internal pure returns (bytes32 chunk) {
        uint256 le = 0;
        uint64 v = value;
        for (uint256 i = 0; i < 8; i++) {
            le |= uint256(uint8(v & 0xff)) << ((31 - i) * 8);
            v >>= 8;
        }
        chunk = bytes32(le);
    }

    function toBoolChunk(bool value) internal pure returns (bytes32) {
        return value ? bytes32(uint256(1) << 248) : bytes32(0);
    }

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
        bytes32 n01 = sha256Pair(toLittleEndian64Chunk(effectiveBalanceGwei), toBoolChunk(slashed));
        bytes32 n02 = sha256Pair(
            toLittleEndian64Chunk(activationEligibilityEpoch),
            toLittleEndian64Chunk(activationEpoch)
        );
        bytes32 n03 = sha256Pair(toLittleEndian64Chunk(exitEpoch), toLittleEndian64Chunk(withdrawableEpoch));

        bytes32 n10 = sha256Pair(n00, n01);
        bytes32 n11 = sha256Pair(n02, n03);

        return sha256Pair(n10, n11);
    }
}
