// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/ITherdal.sol";

interface IBlobHashReader {
    function getBlobHash(uint256 index) external view returns (bytes32);
}

/**
 * @title BatchRegistry
 * @notice Registers ordered EIP-4844 blob commitments for Therdal resolutions (permissionless submitters in v0.2).
 */
abstract contract BatchRegistry {
    uint8 public constant MAX_BLOBS_PER_BATCH = 6;
    uint8 public constant VERSIONED_HASH_PREFIX_KZG = 0x01;

    IBlobHashReader public immutable blobHashReader;

    /// @notice Stored batch commitments: `resolutionId => batchId => BatchRecord`
    mapping(uint256 => mapping(uint256 => ITherdal.BatchRecord)) internal _batches;

    error InvalidBlobVersionedHashPrefix(uint256 blobIndex, bytes1 prefix);
    error UnexpectedTrailingBlobHash(uint256 blobCount, bytes32 extraBlobHash);

    constructor(address _blobHashReader) {
        blobHashReader = IBlobHashReader(_blobHashReader);
    }

    function getBatch(uint256 resolutionId, uint256 batchId)
        public
        view
        returns (ITherdal.BatchRecord memory)
    {
        return _batches[resolutionId][batchId];
    }

    function computeBatchCommitmentRoot(bytes32[] memory blobHashes) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(blobHashes));
    }

    function _registerBatch(
        uint256 resolutionId,
        uint256 batchId,
        address submitter,
        uint8 blobCount
    ) internal returns (bytes32 commitmentRoot, bytes32[] memory blobHashes) {
        if (blobCount == 0 || blobCount > MAX_BLOBS_PER_BATCH) {
            revert ITherdal.InvalidBlobCount(blobCount);
        }

        blobHashes = new bytes32[](blobCount);
        for (uint256 i = 0; i < blobCount; i++) {
            bytes32 bh = _readBlobHash(i);
            if (bh == bytes32(0)) {
                revert ITherdal.MissingBlobHash(i);
            }
            if (uint8(bh[0]) != VERSIONED_HASH_PREFIX_KZG) {
                revert InvalidBlobVersionedHashPrefix(i, bh[0]);
            }
            blobHashes[i] = bh;
        }

        bytes32 trailing = _readBlobHash(blobCount);
        if (trailing != bytes32(0)) {
            revert UnexpectedTrailingBlobHash(blobCount, trailing);
        }

        commitmentRoot = computeBatchCommitmentRoot(blobHashes);
        _batches[resolutionId][batchId] = ITherdal.BatchRecord({
            commitmentRoot: commitmentRoot,
            submitter: submitter,
            blobCount: blobCount,
            settled: false,
            publishedAt: uint64(block.timestamp),
            newlyCountedPositions: 0,
            newlyAcceptedVotes: 0
        });
    }

    function _readBlobHash(uint256 index) internal view returns (bytes32 bh) {
        if (address(blobHashReader) != address(0)) {
            return blobHashReader.getBlobHash(index);
        }
        assembly {
            bh := blobhash(index)
        }
    }
}
