// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RLPReader
 * @notice Strict, canonical Recursive Length Prefix (RLP) decoding library for Ethereum execution
 *         block headers, state trie nodes, and account leaves.
 *         Enforces Yellow Paper Appendix B canonical encoding rules (rejects non-minimal length
 *         prefixes, single-byte `< 0x80` wrapped as `0x81`, and leading-zero integer encodings).
 */
library RLPReader {
    uint8 internal constant STRING_SHORT_START = 0x80;
    uint8 internal constant STRING_LONG_START = 0xb8;
    uint8 internal constant LIST_SHORT_START = 0xc0;
    uint8 internal constant LIST_LONG_START = 0xf8;
    uint256 internal constant SHORT_PAYLOAD_MAX = 55;

    error InvalidRLPEncoding();
    error NonCanonicalRLP();
    error RLPItemNotList();
    error RLPItemIsList();
    error RLPValueTooLarge();
    error RLPUnexpectedLength(uint256 expected, uint256 actual);

    struct RlpItem {
        uint256 length;
        uint256 memPtr;
    }

    /**
     * @notice Wraps a complete byte slice as a single canonical `RlpItem`, rejecting empty or trailing bytes.
     */
    function toRlpItem(bytes memory item) internal pure returns (RlpItem memory) {
        if (item.length == 0) {
            revert InvalidRLPEncoding();
        }
        uint256 memPtr;
        assembly ("memory-safe") {
            memPtr := add(item, 0x20)
        }
        (uint256 offset, uint256 payloadLen) = _decodeOffsetAndLength(memPtr, item.length);
        if (offset + payloadLen != item.length) {
            revert InvalidRLPEncoding();
        }
        return RlpItem({length: item.length, memPtr: memPtr});
    }

    /**
     * @notice Returns `true` if `item` encodes an RLP list (`>= 0xc0`).
     */
    function isList(RlpItem memory item) internal pure returns (bool) {
        if (item.length == 0) {
            return false;
        }
        uint8 byte0;
        uint256 ptr = item.memPtr;
        assembly ("memory-safe") {
            byte0 := byte(0, mload(ptr))
        }
        return byte0 >= LIST_SHORT_START;
    }

    /**
     * @notice Computes `keccak256` over the raw RLP-encoded bytes of `item`.
     */
    function rlpBytesKeccak256(RlpItem memory item) internal pure returns (bytes32 digest) {
        uint256 ptr = item.memPtr;
        uint256 len = item.length;
        assembly ("memory-safe") {
            digest := keccak256(ptr, len)
        }
    }

    /**
     * @notice Decodes an RLP list item into its child `RlpItem` elements.
     */
    function toList(RlpItem memory item) internal pure returns (RlpItem[] memory items) {
        if (!isList(item)) {
            revert RLPItemNotList();
        }

        (uint256 listOffset, uint256 listPayloadLen) = _decodeOffsetAndLength(
            item.memPtr,
            item.length
        );
        if (listOffset + listPayloadLen != item.length) {
            revert InvalidRLPEncoding();
        }

        uint256 count = _countListItems(item.memPtr + listOffset, listPayloadLen);
        items = new RlpItem[](count);

        uint256 currPtr = item.memPtr + listOffset;
        uint256 endPtr = currPtr + listPayloadLen;
        for (uint256 i = 0; i < count; i++) {
            uint256 elemLen = _itemLength(currPtr, endPtr - currPtr);
            items[i] = RlpItem({length: elemLen, memPtr: currPtr});
            currPtr += elemLen;
        }
    }

    /**
     * @notice Extracts the decoded byte string payload of a non-list `RlpItem`.
     */
    function toBytes(RlpItem memory item) internal pure returns (bytes memory result) {
        if (isList(item)) {
            revert RLPItemIsList();
        }
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        result = new bytes(len);
        if (len > 0) {
            uint256 destPtr;
            assembly ("memory-safe") {
                destPtr := add(result, 0x20)
            }
            _memcpy(destPtr, item.memPtr + offset, len);
        }
    }

    /**
     * @notice Decodes a canonical RLP big-endian unsigned integer (`<= 32` bytes, no leading zeros).
     */
    function toUint(RlpItem memory item) internal pure returns (uint256 result) {
        if (isList(item)) {
            revert RLPItemIsList();
        }
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (len > 32) {
            revert RLPValueTooLarge();
        }
        if (len == 0) {
            return 0;
        }

        uint256 dataPtr = item.memPtr + offset;
        uint8 firstByte;
        assembly ("memory-safe") {
            firstByte := byte(0, mload(dataPtr))
            result := shr(mul(8, sub(32, len)), mload(dataPtr))
        }
        if (firstByte == 0) {
            revert NonCanonicalRLP();
        }
    }

    /**
     * @notice Decodes a strict 32-byte RLP byte string (e.g. `stateRoot`, `codeHash`, MPT child hash).
     */
    function toBytes32Strict(RlpItem memory item) internal pure returns (bytes32 result) {
        if (isList(item)) {
            revert RLPItemIsList();
        }
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (len != 32) {
            revert RLPUnexpectedLength(32, len);
        }
        uint256 dataPtr = item.memPtr + offset;
        assembly ("memory-safe") {
            result := mload(dataPtr)
        }
    }

    function _countListItems(
        uint256 startPtr,
        uint256 payloadLen
    ) private pure returns (uint256 count) {
        uint256 currPtr = startPtr;
        uint256 endPtr = startPtr + payloadLen;
        while (currPtr < endPtr) {
            uint256 elemLen = _itemLength(currPtr, endPtr - currPtr);
            currPtr += elemLen;
            unchecked {
                ++count;
            }
        }
        if (currPtr != endPtr) {
            revert InvalidRLPEncoding();
        }
    }

    function _itemLength(uint256 memPtr, uint256 maxLen) private pure returns (uint256) {
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(memPtr, maxLen);
        return offset + len;
    }

    function _decodeOffsetAndLength(
        uint256 memPtr,
        uint256 maxLen
    ) private pure returns (uint256 offset, uint256 len) {
        if (maxLen == 0) {
            revert InvalidRLPEncoding();
        }

        uint8 byte0;
        assembly ("memory-safe") {
            byte0 := byte(0, mload(memPtr))
        }

        if (byte0 < STRING_SHORT_START) {
            return (0, 1);
        } else if (byte0 < STRING_LONG_START) {
            offset = 1;
            len = byte0 - STRING_SHORT_START;
            if (offset + len > maxLen) {
                revert InvalidRLPEncoding();
            }
            if (len == 1) {
                uint8 singlePayloadByte;
                uint256 payloadPtr = memPtr + 1;
                assembly ("memory-safe") {
                    singlePayloadByte := byte(0, mload(payloadPtr))
                }
                if (singlePayloadByte < STRING_SHORT_START) {
                    revert NonCanonicalRLP();
                }
            }
            return (offset, len);
        } else if (byte0 < LIST_SHORT_START) {
            uint256 lenOfLen = byte0 - STRING_LONG_START + 1;
            offset = 1 + lenOfLen;
            if (offset > maxLen) {
                revert InvalidRLPEncoding();
            }
            len = _readCanonicalLength(memPtr + 1, lenOfLen);
            if (offset + len > maxLen) {
                revert InvalidRLPEncoding();
            }
            return (offset, len);
        } else if (byte0 < LIST_LONG_START) {
            offset = 1;
            len = byte0 - LIST_SHORT_START;
            if (offset + len > maxLen) {
                revert InvalidRLPEncoding();
            }
            return (offset, len);
        } else {
            uint256 lenOfLen = byte0 - LIST_LONG_START + 1;
            offset = 1 + lenOfLen;
            if (offset > maxLen) {
                revert InvalidRLPEncoding();
            }
            len = _readCanonicalLength(memPtr + 1, lenOfLen);
            if (offset + len > maxLen) {
                revert InvalidRLPEncoding();
            }
            return (offset, len);
        }
    }

    function _readCanonicalLength(
        uint256 lenPtr,
        uint256 lenOfLen
    ) private pure returns (uint256 decodedLen) {
        uint8 leadingLenByte;
        assembly ("memory-safe") {
            leadingLenByte := byte(0, mload(lenPtr))
            decodedLen := shr(mul(8, sub(32, lenOfLen)), mload(lenPtr))
        }
        if (leadingLenByte == 0 || decodedLen <= SHORT_PAYLOAD_MAX) {
            revert NonCanonicalRLP();
        }
    }

    function _memcpy(uint256 dest, uint256 src, uint256 len) private pure {
        while (len >= 32) {
            assembly ("memory-safe") {
                mstore(dest, mload(src))
            }
            dest += 32;
            src += 32;
            len -= 32;
        }
        if (len > 0) {
            uint256 mask = (uint256(1) << (8 * (32 - len))) - 1;
            assembly ("memory-safe") {
                let srcPart := and(mload(src), not(mask))
                let destPart := and(mload(dest), mask)
                mstore(dest, or(destPart, srcPart))
            }
        }
    }
}
