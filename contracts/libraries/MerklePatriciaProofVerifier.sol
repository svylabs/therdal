// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RLPReader} from "./RLPReader.sol";

/**
 * @title MerklePatriciaProofVerifier
 * @notice Verifies Ethereum Execution Layer Merkle Patricia Trie (MPT) account inclusion proofs
 *         (EIP-1186) against an authenticated `snapshotExecutionRoot`.
 */
library MerklePatriciaProofVerifier {
    using RLPReader for RLPReader.RlpItem;
    using RLPReader for bytes;

    /// @notice Maximum nodes in a 64-nibble (`keccak256(address)`) Ethereum state trie inclusion proof
    uint256 internal constant MAX_TRIE_PROOF_NODES = 65;

    error EmptyStateRoot();
    error InvalidMPTProof();
    error AccountNotFoundInTrie();
    error InvalidMPTNodeLength(uint256 fieldCount);
    error MPTNodeHashMismatch(bytes32 expected, bytes32 actual);
    error MPTPathMismatch();

    /**
     * @notice Verifies an RLP-encoded list of MPT proof nodes for `keyHash = keccak256(abi.encodePacked(account))`
     *         against `rootHash`, returning the RLP-encoded account tuple `[nonce, balance, storageRoot, codeHash]`.
     */
    function verifyAccountProof(
        bytes32 rootHash,
        bytes32 keyHash,
        bytes memory rlpProofNodes
    ) internal pure returns (bytes memory accountRlp) {
        if (rootHash == bytes32(0)) {
            revert EmptyStateRoot();
        }

        RLPReader.RlpItem[] memory proof = rlpProofNodes.toRlpItem().toList();
        if (proof.length == 0 || proof.length > MAX_TRIE_PROOF_NODES) {
            revert InvalidMPTProof();
        }

        bytes memory keyNibbles = _toNibbles(abi.encodePacked(keyHash));
        uint256 nibbleIndex = 0;
        bytes32 expectedHash = rootHash;
        bool expectedEmbedded = false;

        for (uint256 i = 0; i < proof.length; i++) {
            RLPReader.RlpItem memory nodeItem = proof[i];
            bytes32 actualHash = nodeItem.rlpBytesKeccak256();

            if (i == 0) {
                if (actualHash != expectedHash) {
                    revert MPTNodeHashMismatch(expectedHash, actualHash);
                }
            } else if (expectedEmbedded) {
                if (nodeItem.length >= 32 || actualHash != expectedHash) {
                    revert InvalidMPTProof();
                }
            } else {
                if (nodeItem.length < 32) {
                    revert InvalidMPTProof();
                }
                if (actualHash != expectedHash) {
                    revert MPTNodeHashMismatch(expectedHash, actualHash);
                }
            }

            RLPReader.RlpItem[] memory nodeFields = nodeItem.toList();

            if (nodeFields.length == 17) {
                if (nibbleIndex == keyNibbles.length) {
                    if (i != proof.length - 1) {
                        revert InvalidMPTProof();
                    }
                    accountRlp = nodeFields[16].toBytes();
                    if (accountRlp.length == 0) {
                        revert AccountNotFoundInTrie();
                    }
                    return accountRlp;
                }

                uint8 nibble = uint8(keyNibbles[nibbleIndex]);
                nibbleIndex += 1;

                if (i == proof.length - 1) {
                    revert InvalidMPTProof();
                }

                (expectedHash, expectedEmbedded) = _resolveChildRef(nodeFields[nibble]);
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
                    accountRlp = nodeFields[1].toBytes();
                    if (accountRlp.length == 0) {
                        revert AccountNotFoundInTrie();
                    }
                    return accountRlp;
                } else {
                    if (nodeNibbles.length == 0 || i == proof.length - 1) {
                        revert InvalidMPTProof();
                    }
                    (expectedHash, expectedEmbedded) = _resolveChildRef(nodeFields[1]);
                }
            } else {
                revert InvalidMPTNodeLength(nodeFields.length);
            }
        }

        revert InvalidMPTProof();
    }

    /**
     * @notice Decodes `[nonce, balance, storageRoot, codeHash]` from an RLP-encoded Ethereum account leaf.
     */
    function decodeAccount(
        bytes memory rlpAccount
    )
        internal
        pure
        returns (uint256 nonce, uint256 balance, bytes32 storageRoot, bytes32 codeHash)
    {
        RLPReader.RlpItem[] memory fields = rlpAccount.toRlpItem().toList();
        if (fields.length != 4) {
            revert InvalidMPTProof();
        }
        nonce = fields[0].toUint();
        balance = fields[1].toUint();
        storageRoot = fields[2].toBytes32Strict();
        codeHash = fields[3].toBytes32Strict();
    }

    function _resolveChildRef(
        RLPReader.RlpItem memory childRef
    ) private pure returns (bytes32 expectedHash, bool expectedEmbedded) {
        if (childRef.isList()) {
            if (childRef.length >= 32) {
                revert InvalidMPTProof();
            }
            return (childRef.rlpBytesKeccak256(), true);
        }
        // Empty string `0x80` in a branch slot means the nibble path is absent in the trie
        if (childRef.length == 1) {
            bytes memory raw = childRef.toBytes();
            if (raw.length == 0) {
                revert AccountNotFoundInTrie();
            }
        }
        return (childRef.toBytes32Strict(), false);
    }

    function _decodeCompactPath(
        bytes memory compactPath
    ) private pure returns (bool isLeaf, bytes memory nibbles) {
        if (compactPath.length == 0) {
            revert InvalidMPTProof();
        }

        uint8 firstByte = uint8(compactPath[0]);
        uint8 prefix = firstByte >> 4;
        if (prefix > 3) {
            revert InvalidMPTProof();
        }
        isLeaf = (prefix >= 2);
        bool isOdd = (prefix % 2 == 1);

        uint256 nibbleCount = (compactPath.length - 1) * 2 + (isOdd ? 1 : 0);
        nibbles = new bytes(nibbleCount);

        uint256 writeIdx = 0;
        if (isOdd) {
            nibbles[0] = bytes1(firstByte & 0x0f);
            writeIdx = 1;
        } else {
            if ((firstByte & 0x0f) != 0) {
                revert InvalidMPTProof();
            }
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
