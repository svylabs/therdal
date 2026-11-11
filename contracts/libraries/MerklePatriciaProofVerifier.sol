// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./RLPReader.sol";

/**
 * @title MerklePatriciaProofVerifier
 * @notice Verifies Ethereum Merkle Patricia Trie (MPT) inclusion proofs (EIP-1186) against an authenticated state root.
 */
library MerklePatriciaProofVerifier {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    error InvalidMPTProof();
    error InvalidMPTNodeLength(uint256 length);
    error MPTNodeHashMismatch(bytes32 expected, bytes32 actual);
    error MPTPathMismatch();

    function verifyAccountProof(
        bytes32 rootHash,
        bytes32 keyHash,
        bytes memory rlpProofNodes
    ) internal pure returns (bytes memory value) {
        RLPReader.RLPItem[] memory proof = rlpProofNodes.toRlpItem().toList();
        if (proof.length == 0) revert InvalidMPTProof();

        bytes memory keyNibbles = _toNibbles(abi.encodePacked(keyHash));
        uint256 nibbleIndex = 0;
        bytes32 expectedHash = rootHash;

        for (uint256 i = 0; i < proof.length; i++) {
            RLPReader.RLPItem memory nodeItem = proof[i];

            if (i == 0 || nodeItem.length >= 32) {
                bytes32 actualHash = nodeItem.rlpBytesKeccak256();
                if (actualHash != expectedHash) {
                    revert MPTNodeHashMismatch(expectedHash, actualHash);
                }
            }

            RLPReader.RLPItem[] memory nodeFields = nodeItem.toList();

            if (nodeFields.length == 17) {
                if (nibbleIndex == keyNibbles.length) {
                    if (i != proof.length - 1) revert InvalidMPTProof();
                    value = nodeFields[16].toBytes();
                    if (value.length == 0) revert InvalidMPTProof();
                    return value;
                }

                uint8 nibble = uint8(keyNibbles[nibbleIndex]);
                nibbleIndex += 1;

                RLPReader.RLPItem memory childRef = nodeFields[nibble];
                if (i == proof.length - 1) revert InvalidMPTProof();
                if (!childRef.isList()) {
                    expectedHash = childRef.toBytes32Strict();
                } else {
                    expectedHash = childRef.rlpBytesKeccak256();
                }
            } else if (nodeFields.length == 2) {
                bytes memory encodedPath = nodeFields[0].toBytes();
                (bool isLeaf, bytes memory nodeNibbles) = _decodeCompactPath(encodedPath);

                if (nibbleIndex + nodeNibbles.length > keyNibbles.length) {
                    revert MPTPathMismatch();
                }
                for (uint256 j = 0; j < nodeNibbles.length; j++) {
                    if (keyNibbles[nibbleIndex + j] != nodeNibbles[j]) {
                        revert MPTPathMismatch();
                    }
                }
                nibbleIndex += nodeNibbles.length;

                if (isLeaf) {
                    if (i != proof.length - 1 || nibbleIndex != keyNibbles.length) {
                        revert MPTPathMismatch();
                    }
                    value = nodeFields[1].toBytes();
                    if (value.length == 0) revert InvalidMPTProof();
                    return value;
                } else {
                    if (i == proof.length - 1) revert InvalidMPTProof();
                    RLPReader.RLPItem memory childRef = nodeFields[1];
                    if (!childRef.isList()) {
                        expectedHash = childRef.toBytes32Strict();
                    } else {
                        expectedHash = childRef.rlpBytesKeccak256();
                    }
                }
            } else {
                revert InvalidMPTNodeLength(nodeFields.length);
            }
        }

        revert InvalidMPTProof();
    }

    /**
     * @notice Extracts `[nonce, balance, storageRoot, codeHash]` from an RLP-encoded Ethereum account leaf.
     */
    function decodeAccountBalance(bytes memory rlpAccount)
        internal
        pure
        returns (
            uint256 nonce,
            uint256 balance,
            bytes32 storageRoot,
            bytes32 codeHash
        )
    {
        RLPReader.RLPItem[] memory fields = rlpAccount.toRlpItem().toList();
        if (fields.length != 4) revert InvalidMPTProof();
        nonce = fields[0].toUint();
        balance = fields[1].toUint();
        storageRoot = fields[2].toBytes32Strict();
        codeHash = fields[3].toBytes32Strict();
    }

    function _decodeCompactPath(bytes memory compactPath)
        private
        pure
        returns (bool isLeaf, bytes memory nibbles)
    {
        if (compactPath.length == 0) revert InvalidMPTProof();

        uint8 firstByte = uint8(compactPath[0]);
        uint8 prefix = firstByte >> 4;
        if (prefix > 3) revert InvalidMPTProof();
        isLeaf = (prefix >= 2);
        bool isOdd = (prefix % 2 == 1);

        uint256 nibbleCount = (compactPath.length - 1) * 2 + (isOdd ? 1 : 0);
        nibbles = new bytes(nibbleCount);

        uint256 writeIdx = 0;
        if (isOdd) {
            nibbles[0] = bytes1(firstByte & 0x0f);
            writeIdx = 1;
        } else {
            if ((firstByte & 0x0f) != 0) revert InvalidMPTProof();
        }

        for (uint256 i = 1; i < compactPath.length; i++) {
            uint8 b = uint8(compactPath[i]);
            nibbles[writeIdx++] = bytes1(b >> 4);
            nibbles[writeIdx++] = bytes1(b & 0x0f);
        }
    }

    function _toNibbles(bytes memory data) private pure returns (bytes memory nibbles) {
        nibbles = new bytes(data.length * 2);
        for (uint256 i = 0; i < data.length; i++) {
            uint8 b = uint8(data[i]);
            nibbles[i * 2] = bytes1(b >> 4);
            nibbles[i * 2 + 1] = bytes1(b & 0x0f);
        }
    }
}
