use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Minimum number of free-text options per topic (`TopicValidation.MIN_OPTIONS`).
pub const MIN_OPTIONS: usize = 2;

/// Maximum number of free-text options per topic (`TopicValidation.MAX_OPTIONS`).
pub const MAX_OPTIONS: usize = 16;

/// Maximum UTF-8 byte length of a topic subject (`TopicValidation.MAX_SUBJECT_BYTES`).
pub const MAX_SUBJECT_BYTES: usize = 512;

/// Maximum UTF-8 byte length of each free-text option (`TopicValidation.MAX_OPTION_BYTES`).
pub const MAX_OPTION_BYTES: usize = 256;

/// Canonical 16-byte domain tag for cross-layer topic commitment hashing.
pub const TOPIC_DOMAIN_TAG: &[u8; 16] = b"THERDAL_TOPIC_V1";

/// Default estimated settlement price per valid vote in 6-decimal micro-USDC (`$0.01 = 10,000`).
pub const DEFAULT_PRICE_PER_VOTE_USDC_MICROS: u128 = 10_000;

/// Stage 1 lifecycle phase of a topic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TopicPhase {
    None,
    Open,
    Closed,
}

/// Input parameters for registering a new topic in Stage 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CreateTopicRequest {
    pub creator: [u8; 20],
    pub subject: String,
    pub options: Vec<String>,
    pub voting_ends_at: u64,
    pub initial_sponsorship_usdc_micros: u128,
}

/// Persisted state of a registered topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicRecord {
    pub id: u64,
    pub creator: [u8; 20],
    pub subject: String,
    pub options: Vec<String>,
    pub created_at: u64,
    pub voting_ends_at: u64,
    pub snapshot_block: u64,
    pub snapshot_block_hash: [u8; 32],
    pub content_hash: [u8; 32],
    pub price_per_vote_usdc_micros: u128,
    pub total_sponsored_usdc_micros: u128,
    pub remaining_escrow_usdc_micros: u128,
    pub sponsor_contributions: BTreeMap<String, u128>,
}

/// Enriched read view of a topic evaluated at a specific timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicView {
    pub id: u64,
    pub creator: String,
    pub subject: String,
    pub options: Vec<String>,
    pub created_at: u64,
    pub voting_ends_at: u64,
    pub snapshot_block: u64,
    pub snapshot_block_hash: String,
    pub content_hash: String,
    pub price_per_vote_usdc_micros: u128,
    pub total_sponsored_usdc_micros: u128,
    pub remaining_escrow_usdc_micros: u128,
    pub phase: TopicPhase,
}

impl TopicRecord {
    pub fn phase_at(&self, now_timestamp: u64) -> TopicPhase {
        if now_timestamp <= self.voting_ends_at {
            TopicPhase::Open
        } else {
            TopicPhase::Closed
        }
    }

    pub fn to_view(&self, now_timestamp: u64) -> TopicView {
        TopicView {
            id: self.id,
            creator: format!("0x{}", hex::encode(self.creator)),
            subject: self.subject.clone(),
            options: self.options.clone(),
            created_at: self.created_at,
            voting_ends_at: self.voting_ends_at,
            snapshot_block: self.snapshot_block,
            snapshot_block_hash: format!("0x{}", hex::encode(self.snapshot_block_hash)),
            content_hash: format!("0x{}", hex::encode(self.content_hash)),
            price_per_vote_usdc_micros: self.price_per_vote_usdc_micros,
            total_sponsored_usdc_micros: self.total_sponsored_usdc_micros,
            remaining_escrow_usdc_micros: self.remaining_escrow_usdc_micros,
            phase: self.phase_at(now_timestamp),
        }
    }
}
