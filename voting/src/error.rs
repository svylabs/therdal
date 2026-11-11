use therdal_topics::{TopicError, TopicPhase};
use thiserror::Error;

/// Structured domain errors for Stage 2 Direct On-Chain Voting (`IDirectVoting.sol` + proof libraries).
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VotingError {
    #[error(transparent)]
    Topic(#[from] TopicError),

    #[error("InvalidTopicPhase: current phase is {current:?}, expected {expected:?}")]
    InvalidTopicPhase {
        current: TopicPhase,
        expected: TopicPhase,
    },

    #[error("InvalidOptionIndex: option index {option_index} is out of bounds for {option_count} options")]
    InvalidOptionIndex {
        option_index: u32,
        option_count: u32,
    },

    #[error("EmptyDirectVoteProof: must prove execution balance, at least one beacon validator, or both")]
    EmptyDirectVoteProof,

    #[error("ExecutionSnapshotAlreadyAuthenticated: topic #{topic_id}")]
    ExecutionSnapshotAlreadyAuthenticated { topic_id: u64 },

    #[error("BeaconSnapshotAlreadyAuthenticated: topic #{topic_id}")]
    BeaconSnapshotAlreadyAuthenticated { topic_id: u64 },

    #[error("ExecutionSnapshotNotAuthenticated: topic #{topic_id}")]
    ExecutionSnapshotNotAuthenticated { topic_id: u64 },

    #[error("BeaconSnapshotNotAuthenticated: topic #{topic_id}")]
    BeaconSnapshotNotAuthenticated { topic_id: u64 },

    #[error("PositionAlreadyVoted: topic #{topic_id}, positionKey {position_key}")]
    PositionAlreadyVoted {
        topic_id: u64,
        position_key: String,
    },

    #[error("ZeroVotingWeight: proven snapshot position has zero ETH weight")]
    ZeroVotingWeight,

    #[error("InvalidRLPEncoding")]
    InvalidRlpEncoding,

    #[error("NonCanonicalRLP")]
    NonCanonicalRlp,

    #[error("RLPItemNotList")]
    RlpItemNotList,

    #[error("RLPItemIsList")]
    RlpItemIsList,

    #[error("RLPValueTooLarge")]
    RlpValueTooLarge,

    #[error("RLPUnexpectedLength: expected {expected} bytes, got {actual}")]
    RlpUnexpectedLength { expected: usize, actual: usize },

    #[error("ExecutionHeaderHashMismatch: expected {expected}, actual {actual}")]
    ExecutionHeaderHashMismatch { expected: String, actual: String },

    #[error("InvalidRLPHeaderFieldCount: {count}")]
    InvalidRlpHeaderFieldCount { count: usize },

    #[error("ExecutionBlockNumberMismatch: expected {expected}, actual {actual}")]
    ExecutionBlockNumberMismatch { expected: u64, actual: u64 },

    #[error("EmptyExecutionStateRoot")]
    EmptyExecutionStateRoot,

    #[error("BeaconRootUnavailable: timestamp {timestamp}")]
    BeaconRootUnavailable { timestamp: u64 },

    #[error("InvalidBeaconStateRootProof")]
    InvalidBeaconStateRootProof,

    #[error("InvalidBeaconSlotProof")]
    InvalidBeaconSlotProof,

    #[error("InvalidExecutionConsensusAlignment")]
    InvalidExecutionConsensusAlignment,

    #[error("EmptyStateRoot")]
    EmptyStateRoot,

    #[error("InvalidMPTProof")]
    InvalidMptProof,

    #[error("AccountNotFoundInTrie")]
    AccountNotFoundInTrie,

    #[error("InvalidMPTNodeLength: {field_count}")]
    InvalidMptNodeLength { field_count: usize },

    #[error("MPTNodeHashMismatch: expected {expected}, actual {actual}")]
    MptNodeHashMismatch { expected: String, actual: String },

    #[error("MPTPathMismatch")]
    MptPathMismatch,

    #[error("ValidatorIndexOutOfRange: {validator_index}")]
    ValidatorIndexOutOfRange { validator_index: u64 },

    #[error("ValidatorSlashed: validator #{validator_index}")]
    ValidatorSlashed { validator_index: u64 },

    #[error("ValidatorNotActiveAtSnapshot: validator #{validator_index} (activation={activation_epoch}, exit={exit_epoch}, snapshot={snapshot_epoch})")]
    ValidatorNotActiveAtSnapshot {
        validator_index: u64,
        activation_epoch: u64,
        exit_epoch: u64,
        snapshot_epoch: u64,
    },

    #[error("UnsupportedWithdrawalPrefix: validator #{validator_index} has prefix 0x{prefix:02x}")]
    UnsupportedWithdrawalPrefix { validator_index: u64, prefix: u8 },

    #[error("UnauthorizedWithdrawalAddress: validator #{validator_index} requires {expected_voter}, got {credential_address}")]
    UnauthorizedWithdrawalAddress {
        validator_index: u64,
        expected_voter: String,
        credential_address: String,
    },

    #[error("InvalidValidatorProof: validator #{validator_index}")]
    InvalidValidatorProof { validator_index: u64 },

    #[error("InvalidHexInput: {0}")]
    InvalidHexInput(String),

    #[error("StorageError: {0}")]
    StorageError(String),
}
