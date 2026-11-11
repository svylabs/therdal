use crate::types::TopicPhase;
use thiserror::Error;

/// Structured domain errors for Stage 1 Topic Creation (`TopicValidation.sol` parity).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum TopicError {
    #[error("subject must not be empty or whitespace-only")]
    EmptySubject,

    #[error("subject length ({byte_length} bytes) exceeds maximum ({max_bytes} bytes)")]
    SubjectTooLong {
        byte_length: usize,
        max_bytes: usize,
    },

    #[error("option count ({count}) must be between {min_options} and {max_options}")]
    InvalidOptionCount {
        count: usize,
        min_options: usize,
        max_options: usize,
    },

    #[error("option at index {option_index} must not be empty or whitespace-only")]
    EmptyOption { option_index: usize },

    #[error(
        "option at index {option_index} length ({byte_length} bytes) exceeds maximum ({max_bytes} bytes)"
    )]
    OptionTooLong {
        option_index: usize,
        byte_length: usize,
        max_bytes: usize,
    },

    #[error(
        "duplicate option at index {duplicate_index} matches option at index {first_index}"
    )]
    DuplicateOption {
        first_index: usize,
        duplicate_index: usize,
    },

    #[error(
        "voting_ends_at ({voting_ends_at}) must be strictly greater than current timestamp ({current_timestamp})"
    )]
    InvalidVotingEndTime {
        voting_ends_at: u64,
        current_timestamp: u64,
    },

    #[error("current block number ({current_block_number}) must be at least 1")]
    InvalidSnapshotBlock { current_block_number: u64 },

    #[error("topic #{topic_id} not found")]
    TopicNotFound { topic_id: u64 },

    #[error("invalid topic phase: expected {expected:?}, got {current:?}")]
    InvalidTopicPhase {
        current: TopicPhase,
        expected: TopicPhase,
    },

    #[error("sponsorship amount must be greater than zero")]
    ZeroSponsorshipAmount,

    #[error("invalid 20-byte Ethereum address '{input}': {reason}")]
    InvalidAddress { input: String, reason: String },

    #[error("topic store error: {0}")]
    StorageError(String),
}
