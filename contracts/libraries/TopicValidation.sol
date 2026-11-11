// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "../interfaces/ITopicRegistry.sol";

/**
 * @title TopicValidation
 * @notice Pure domain validation and deterministic cross-layer hashing for Stage 1 Topic Creation.
 */
library TopicValidation {
    /// @notice Minimum number of free-text options per topic
    uint256 public constant MIN_OPTIONS = 2;

    /// @notice Maximum number of free-text options per topic
    uint256 public constant MAX_OPTIONS = 16;

    /// @notice Maximum UTF-8 byte length of a topic subject
    uint256 public constant MAX_SUBJECT_BYTES = 512;

    /// @notice Maximum UTF-8 byte length of each free-text option
    uint256 public constant MAX_OPTION_BYTES = 256;

    /// @notice Canonical domain separation tag for cross-layer topic commitment hashing
    bytes internal constant TOPIC_DOMAIN_TAG = "THERDAL_TOPIC_V1";

    /**
     * @notice Validates `subject`, `options`, and `votingEndsAt` against `currentTimestamp`,
     *         returning the canonical cross-layer `contentHash`.
     */
    function validateAndHash(
        string calldata subject,
        string[] calldata options,
        uint64 votingEndsAt,
        uint64 currentTimestamp
    ) internal pure returns (bytes32 contentHash) {
        validateSubject(subject);
        validateOptions(options);
        validateVotingWindow(votingEndsAt, currentTimestamp);
        contentHash = computeContentHash(subject, options, votingEndsAt);
    }

    /**
     * @notice Ensures `subject` is within `[1, MAX_SUBJECT_BYTES]` and contains non-whitespace text.
     */
    function validateSubject(string calldata subject) internal pure {
        bytes calldata raw = bytes(subject);
        uint256 len = raw.length;
        if (len == 0) {
            revert ITopicRegistry.EmptySubject();
        }
        if (len > MAX_SUBJECT_BYTES) {
            revert ITopicRegistry.SubjectTooLong(len, MAX_SUBJECT_BYTES);
        }
        (uint256 start, uint256 end) = _trimmedBounds(raw);
        if (start >= end) {
            revert ITopicRegistry.EmptySubject();
        }
    }

    /**
     * @notice Ensures `options` count is in `[MIN_OPTIONS, MAX_OPTIONS]`, each option is non-empty
     *         and at most `MAX_OPTION_BYTES`, and no two options share identical trimmed content.
     */
    function validateOptions(string[] calldata options) internal pure {
        uint256 count = options.length;
        if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
            revert ITopicRegistry.InvalidOptionCount(count, MIN_OPTIONS, MAX_OPTIONS);
        }

        bytes32[] memory trimmedHashes = new bytes32[](count);

        for (uint256 i = 0; i < count; i++) {
            bytes calldata raw = bytes(options[i]);
            uint256 len = raw.length;
            if (len == 0) {
                revert ITopicRegistry.EmptyOption(i);
            }
            if (len > MAX_OPTION_BYTES) {
                revert ITopicRegistry.OptionTooLong(i, len, MAX_OPTION_BYTES);
            }

            (uint256 start, uint256 end) = _trimmedBounds(raw);
            if (start >= end) {
                revert ITopicRegistry.EmptyOption(i);
            }

            bytes32 trimmedHash = keccak256(raw[start:end]);
            for (uint256 j = 0; j < i; j++) {
                if (trimmedHashes[j] == trimmedHash) {
                    revert ITopicRegistry.DuplicateOption(j, i);
                }
            }
            trimmedHashes[i] = trimmedHash;
        }
    }

    /**
     * @notice Ensures `votingEndsAt` is strictly in the future relative to `currentTimestamp`.
     */
    function validateVotingWindow(uint64 votingEndsAt, uint64 currentTimestamp) internal pure {
        if (votingEndsAt <= currentTimestamp) {
            revert ITopicRegistry.InvalidVotingEndTime(votingEndsAt, currentTimestamp);
        }
    }

    /**
     * @notice Computes the canonical 32-byte cross-layer commitment for a topic:
     *         `keccak256("THERDAL_TOPIC_V1" || keccak256(subject) || uint64(options.length) || keccak256(optionHashes) || uint64(votingEndsAt))`
     *         Total outer preimage is fixed at 96 bytes (16 + 32 + 8 + 32 + 8).
     */
    function computeContentHash(
        string calldata subject,
        string[] calldata options,
        uint64 votingEndsAt
    ) internal pure returns (bytes32) {
        bytes32 subjectHash = keccak256(bytes(subject));
        uint256 count = options.length;
        if (count > type(uint64).max) {
            revert ITopicRegistry.InvalidOptionCount(count, MIN_OPTIONS, MAX_OPTIONS);
        }
        // casting to 'uint64' is safe because count <= type(uint64).max is checked above
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 optionCount = uint64(count);
        bytes32[] memory optionHashes = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            optionHashes[i] = keccak256(bytes(options[i]));
        }
        bytes32 optionsHash = keccak256(abi.encodePacked(optionHashes));

        return
            keccak256(
                abi.encodePacked(
                    TOPIC_DOMAIN_TAG,
                    subjectHash,
                    optionCount,
                    optionsHash,
                    votingEndsAt
                )
            );
    }

    function _trimmedBounds(bytes calldata raw) private pure returns (uint256 start, uint256 end) {
        end = raw.length;
        while (start < end && _isAsciiWhitespace(raw[start])) {
            unchecked {
                ++start;
            }
        }
        while (end > start && _isAsciiWhitespace(raw[end - 1])) {
            unchecked {
                --end;
            }
        }
    }

    function _isAsciiWhitespace(bytes1 ch) private pure returns (bool) {
        return ch == 0x20 || ch == 0x09 || ch == 0x0a || ch == 0x0d;
    }
}
