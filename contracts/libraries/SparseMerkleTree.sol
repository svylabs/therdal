// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SparseMerkleTree
 * @notice Position-based uniqueness keys (`THERDAL_WALLET` and `THERDAL_VALIDATOR`) and 256-bit SMT helpers.
 */
library SparseMerkleTree {
    bytes1 internal constant LEAF_NODE_PREFIX = 0x00;
    bytes1 internal constant INTERNAL_NODE_PREFIX = 0x01;
    bytes32 internal constant EMPTY_LEAF = bytes32(0);

    /**
     * @notice Computes the domain-separated SMT key for an execution-layer wallet balance position.
     *         walletKey = H(domain="THERDAL_WALLET", chainId, account)
     */
    function computeWalletKey(uint256 chainId, address account) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("THERDAL_WALLET", chainId, account));
    }

    /**
     * @notice Computes the domain-separated SMT key for a beacon-chain validator stake position.
     *         validatorKey = H(domain="THERDAL_VALIDATOR", chainId, validatorIndex)
     */
    function computeValidatorKey(uint256 chainId, uint64 validatorIndex) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("THERDAL_VALIDATOR", chainId, validatorIndex));
    }

    /**
     * @notice Computes the canonical occupied leaf hash for a counted position key.
     */
    function computeOccupiedLeaf(bytes32 positionKey) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(LEAF_NODE_PREFIX, "THERDAL_SMT_LEAF_V1", positionKey));
    }

    /**
     * @notice Computes the parent hash of two SMT child nodes, with empty-subtree compression `hashNode(0, 0) = 0`.
     */
    function hashNode(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        if (left == bytes32(0) && right == bytes32(0)) {
            return bytes32(0);
        }
        return keccak256(abi.encodePacked(INTERNAL_NODE_PREFIX, left, right));
    }

    /**
     * @notice Verifies that `positionKey` has an empty leaf (`bytes32(0)`) in the SMT rooted at `root`.
     */
    function verifyNonMembership(
        bytes32 root,
        bytes32 positionKey,
        bytes32[] memory siblings
    ) internal pure returns (bool) {
        if (siblings.length > 256) return false;
        return computeRoot(positionKey, EMPTY_LEAF, siblings) == root;
    }

    /**
     * @notice Verifies that `positionKey` is present in the SMT rooted at `root`.
     */
    function verifyMembership(
        bytes32 root,
        bytes32 positionKey,
        bytes32[] memory siblings
    ) internal pure returns (bool) {
        if (siblings.length > 256) return false;
        bytes32 leaf = computeOccupiedLeaf(positionKey);
        return computeRoot(positionKey, leaf, siblings) == root;
    }

    /**
     * @notice Computes the SMT root given a 256-bit key, leaf value, and sibling array (LSB to MSB).
     */
    function computeRoot(
        bytes32 key,
        bytes32 leafValue,
        bytes32[] memory siblings
    ) internal pure returns (bytes32 currentHash) {
        currentHash = leafValue;
        uint256 path = uint256(key);
        uint256 len = siblings.length;

        for (uint256 i = 0; i < len; i++) {
            bytes32 sibling = siblings[i];
            if ((path & 1) == 0) {
                currentHash = hashNode(currentHash, sibling);
            } else {
                currentHash = hashNode(sibling, currentHash);
            }
            path >>= 1;
        }
    }
}
