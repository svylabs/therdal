// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RLPReader
 * @notice Minimal, gas-efficient RLP decoding library for Ethereum block headers, accounts, and MPT nodes.
 */
library RLPReader {
    uint8 internal constant STRING_SHORT_START = 0x80;
    uint8 internal constant STRING_LONG_START = 0xb8;
    uint8 internal constant LIST_SHORT_START = 0xc0;
    uint8 internal constant LIST_LONG_START = 0xf8;

    error InvalidRLPEncoding();
    error RLPItemNotList();
    error RLPItemIsList();
    error RLPValueTooLarge();
    error RLPUnexpectedLength(uint256 expected, uint256 actual);

    struct RLPItem {
        uint256 length;
        uint256 memPtr;
    }

    function toRlpItem(bytes memory item) internal pure returns (RLPItem memory) {
        uint256 memPtr;
        assembly {
            memPtr := add(item, 0x20)
        }
        return RLPItem(item.length, memPtr);
    }

    function isList(RLPItem memory item) internal pure returns (bool) {
        if (item.length == 0) return false;
        uint8 byte0;
        uint256 memPtr = item.memPtr;
        assembly {
            byte0 := byte(0, mload(memPtr))
        }
        return byte0 >= LIST_SHORT_START;
    }

    function toList(RLPItem memory item) internal pure returns (RLPItem[] memory) {
        if (!isList(item)) revert RLPItemNotList();

        (uint256 listOffset, uint256 listLength) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (listOffset + listLength != item.length) revert InvalidRLPEncoding();

        uint256 count = _countItems(item.memPtr + listOffset, listLength);
        RLPItem[] memory result = new RLPItem[](count);

        uint256 currPtr = item.memPtr + listOffset;
        uint256 endPtr = currPtr + listLength;
        for (uint256 i = 0; i < count; i++) {
            uint256 itemLen = _itemLength(currPtr, endPtr - currPtr);
            result[i] = RLPItem(itemLen, currPtr);
            currPtr += itemLen;
        }

        if (currPtr != endPtr) revert InvalidRLPEncoding();
        return result;
    }

    function toBytes(RLPItem memory item) internal pure returns (bytes memory) {
        if (item.length == 0) return new bytes(0);
        if (isList(item)) revert RLPItemIsList();

        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (offset + len != item.length) revert InvalidRLPEncoding();

        bytes memory result = new bytes(len);
        uint256 srcPtr = item.memPtr + offset;
        uint256 destPtr;
        assembly {
            destPtr := add(result, 0x20)
        }
        _memcpy(destPtr, srcPtr, len);
        return result;
    }

    function toBytes32Strict(RLPItem memory item) internal pure returns (bytes32) {
        if (isList(item)) revert RLPItemIsList();
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (offset + len != item.length) revert InvalidRLPEncoding();
        if (len != 32) revert RLPUnexpectedLength(32, len);

        bytes32 result;
        uint256 srcPtr = item.memPtr + offset;
        assembly {
            result := mload(srcPtr)
        }
        return result;
    }

    function toUint(RLPItem memory item) internal pure returns (uint256) {
        if (item.length == 0) return 0;
        if (isList(item)) revert RLPItemIsList();

        (uint256 offset, uint256 len) = _decodeOffsetAndLength(item.memPtr, item.length);
        if (offset + len != item.length) revert InvalidRLPEncoding();
        if (len == 0) return 0;
        if (len > 32) revert RLPValueTooLarge();

        uint256 result;
        uint256 srcPtr = item.memPtr + offset;
        assembly {
            result := mload(srcPtr)
            result := shr(mul(8, sub(32, len)), result)
        }
        return result;
    }

    function rlpBytesKeccak256(RLPItem memory item) internal pure returns (bytes32 result) {
        uint256 ptr = item.memPtr;
        uint256 len = item.length;
        assembly {
            result := keccak256(ptr, len)
        }
    }

    function _countItems(uint256 memPtr, uint256 totalLength) private pure returns (uint256 count) {
        uint256 currPtr = memPtr;
        uint256 endPtr = memPtr + totalLength;
        while (currPtr < endPtr) {
            uint256 itemLen = _itemLength(currPtr, endPtr - currPtr);
            currPtr += itemLen;
            count++;
        }
        if (currPtr != endPtr) revert InvalidRLPEncoding();
    }

    function _itemLength(uint256 memPtr, uint256 maxLen) private pure returns (uint256) {
        (uint256 offset, uint256 len) = _decodeOffsetAndLength(memPtr, maxLen);
        return offset + len;
    }

    function _decodeOffsetAndLength(uint256 memPtr, uint256 maxLen)
        private
        pure
        returns (uint256 offset, uint256 len)
    {
        if (maxLen == 0) revert InvalidRLPEncoding();

        uint8 byte0;
        assembly {
            byte0 := byte(0, mload(memPtr))
        }

        if (byte0 < STRING_SHORT_START) {
            return (0, 1);
        } else if (byte0 < STRING_LONG_START) {
            offset = 1;
            len = byte0 - STRING_SHORT_START;
        } else if (byte0 < LIST_SHORT_START) {
            uint256 byteLen = byte0 - STRING_LONG_START + 1;
            offset = 1 + byteLen;
            if (offset > maxLen) revert InvalidRLPEncoding();
            uint256 dataPtr = memPtr + 1;
            assembly {
                len := shr(mul(8, sub(32, byteLen)), mload(dataPtr))
            }
        } else if (byte0 < LIST_LONG_START) {
            offset = 1;
            len = byte0 - LIST_SHORT_START;
        } else {
            uint256 byteLen = byte0 - LIST_LONG_START + 1;
            offset = 1 + byteLen;
            if (offset > maxLen) revert InvalidRLPEncoding();
            uint256 dataPtr = memPtr + 1;
            assembly {
                len := shr(mul(8, sub(32, byteLen)), mload(dataPtr))
            }
        }

        if (offset + len > maxLen) revert InvalidRLPEncoding();
    }

    function _memcpy(uint256 dest, uint256 src, uint256 len) private pure {
        while (len >= 32) {
            assembly {
                mstore(dest, mload(src))
            }
            dest += 32;
            src += 32;
            len -= 32;
        }
        if (len > 0) {
            uint256 mask = (1 << (8 * (32 - len))) - 1;
            assembly {
                let srcpart := and(mload(src), not(mask))
                let destpart := and(mload(dest), mask)
                mstore(dest, or(destpart, srcpart))
            }
        }
    }
}
