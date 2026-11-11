use crate::error::TopicError;
use crate::types::{
    CreateTopicRequest, DEFAULT_PRICE_PER_VOTE_USDC_MICROS, TopicPhase, TopicRecord, TopicView,
};
use crate::validation::{keccak256, validate_and_hash};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Abstraction over block/timestamp retrieval so domain state transitions are deterministically testable.
pub trait ChainClock {
    fn now_timestamp(&self) -> u64;
    fn current_block_number(&self) -> u64;
    fn parent_block_hash(&self, parent_block_number: u64) -> [u8; 32];
}

/// Deterministic clock used in unit tests and offline simulations.
#[derive(Debug, Clone, Copy)]
pub struct FixedChainClock {
    pub timestamp: u64,
    pub block_number: u64,
}

impl ChainClock for FixedChainClock {
    fn now_timestamp(&self) -> u64 {
        self.timestamp
    }

    fn current_block_number(&self) -> u64 {
        self.block_number
    }

    fn parent_block_hash(&self, parent_block_number: u64) -> [u8; 32] {
        let mut seed = b"THERDAL_PARENT_BLOCK_".to_vec();
        seed.extend_from_slice(&parent_block_number.to_be_bytes());
        keccak256(&seed)
    }
}

/// System wall-clock implementation for local CLI topic registry operations.
#[derive(Debug, Clone, Copy)]
pub struct SystemChainClock {
    pub simulated_block_number: u64,
}

impl Default for SystemChainClock {
    fn default() -> Self {
        Self {
            simulated_block_number: 21_500_000,
        }
    }
}

impl ChainClock for SystemChainClock {
    fn now_timestamp(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn current_block_number(&self) -> u64 {
        self.simulated_block_number
    }

    fn parent_block_hash(&self, parent_block_number: u64) -> [u8; 32] {
        let mut seed = b"THERDAL_PARENT_BLOCK_".to_vec();
        seed.extend_from_slice(&parent_block_number.to_be_bytes());
        keccak256(&seed)
    }
}

/// Storage trait decoupling pure Stage 1 topic registry logic from persistence / I/O.
pub trait TopicStore {
    fn load_topics(&self) -> Result<Vec<TopicRecord>, TopicError>;
    fn save_topics(&mut self, topics: &[TopicRecord]) -> Result<(), TopicError>;
}

/// Pure in-memory store for isolated unit tests.
#[derive(Debug, Default, Clone)]
pub struct InMemoryTopicStore {
    topics: Vec<TopicRecord>,
}

impl TopicStore for InMemoryTopicStore {
    fn load_topics(&self) -> Result<Vec<TopicRecord>, TopicError> {
        Ok(self.topics.clone())
    }

    fn save_topics(&mut self, topics: &[TopicRecord]) -> Result<(), TopicError> {
        self.topics = topics.to_vec();
        Ok(())
    }
}

/// Local JSON file store for CLI persistence.
#[derive(Debug, Clone)]
pub struct JsonFileTopicStore {
    path: PathBuf,
}

impl JsonFileTopicStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }
}

impl TopicStore for JsonFileTopicStore {
    fn load_topics(&self) -> Result<Vec<TopicRecord>, TopicError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let raw = fs::read_to_string(&self.path)
            .map_err(|e| TopicError::StorageError(format!("read {:?}: {e}", self.path)))?;
        if raw.trim().is_empty() {
            return Ok(Vec::new());
        }
        serde_json::from_str(&raw)
            .map_err(|e| TopicError::StorageError(format!("parse {:?}: {e}", self.path)))
    }

    fn save_topics(&mut self, topics: &[TopicRecord]) -> Result<(), TopicError> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .map_err(|e| TopicError::StorageError(format!("mkdir {:?}: {e}", parent)))?;
        }
        let serialized = serde_json::to_string_pretty(topics)
            .map_err(|e| TopicError::StorageError(format!("serialize topics: {e}")))?;
        fs::write(&self.path, serialized)
            .map_err(|e| TopicError::StorageError(format!("write {:?}: {e}", self.path)))
    }
}

/// Stage 1 Topic Registry service mirroring `Therdal.sol` invariants.
pub struct TopicRegistryService<C: ChainClock, S: TopicStore> {
    pub clock: C,
    pub store: S,
    pub price_per_vote_usdc_micros: u128,
}

impl<C: ChainClock, S: TopicStore> TopicRegistryService<C, S> {
    pub fn new(clock: C, store: S) -> Self {
        Self {
            clock,
            store,
            price_per_vote_usdc_micros: DEFAULT_PRICE_PER_VOTE_USDC_MICROS,
        }
    }

    /// Registers a new topic ($0 creation fee; 100% of optional `initial_sponsorship_usdc_micros` credited to pool).
    pub fn create_topic(&mut self, req: CreateTopicRequest) -> Result<TopicView, TopicError> {
        let current_block = self.clock.current_block_number();
        if current_block == 0 {
            return Err(TopicError::InvalidSnapshotBlock {
                current_block_number: 0,
            });
        }

        let now = self.clock.now_timestamp();
        let content_hash =
            validate_and_hash(&req.subject, &req.options, req.voting_ends_at, now)?;

        let snapshot_block = current_block - 1;
        let snapshot_block_hash = self.clock.parent_block_hash(snapshot_block);

        let mut topics = self.store.load_topics()?;
        let next_id = (topics.len() as u64) + 1;

        let mut sponsor_contributions = BTreeMap::new();
        if req.initial_sponsorship_usdc_micros > 0 {
            sponsor_contributions.insert(
                format!("0x{}", hex::encode(req.creator)),
                req.initial_sponsorship_usdc_micros,
            );
        }

        let record = TopicRecord {
            id: next_id,
            creator: req.creator,
            subject: req.subject,
            options: req.options,
            created_at: now,
            voting_ends_at: req.voting_ends_at,
            snapshot_block,
            snapshot_block_hash,
            content_hash,
            price_per_vote_usdc_micros: self.price_per_vote_usdc_micros,
            total_sponsored_usdc_micros: req.initial_sponsorship_usdc_micros,
            remaining_escrow_usdc_micros: req.initial_sponsorship_usdc_micros,
            sponsor_contributions,
        };

        let view = record.to_view(now);
        topics.push(record);
        self.store.save_topics(&topics)?;

        Ok(view)
    }

    /// Contributes additional USDC sponsorship (100% to pool, $0 fee) while the topic is `Open`.
    pub fn sponsor_topic(
        &mut self,
        topic_id: u64,
        sponsor: [u8; 20],
        amount_usdc_micros: u128,
    ) -> Result<TopicView, TopicError> {
        if amount_usdc_micros == 0 {
            return Err(TopicError::ZeroSponsorshipAmount);
        }

        let now = self.clock.now_timestamp();
        let mut topics = self.store.load_topics()?;
        let record = topics
            .iter_mut()
            .find(|t| t.id == topic_id)
            .ok_or(TopicError::TopicNotFound { topic_id })?;

        let phase = record.phase_at(now);
        if phase != TopicPhase::Open {
            return Err(TopicError::InvalidTopicPhase {
                current: phase,
                expected: TopicPhase::Open,
            });
        }

        record.total_sponsored_usdc_micros += amount_usdc_micros;
        record.remaining_escrow_usdc_micros += amount_usdc_micros;
        let key = format!("0x{}", hex::encode(sponsor));
        *record.sponsor_contributions.entry(key).or_insert(0) += amount_usdc_micros;

        let view = record.to_view(now);
        self.store.save_topics(&topics)?;
        Ok(view)
    }

    pub fn get_topic(&self, topic_id: u64) -> Result<TopicView, TopicError> {
        let now = self.clock.now_timestamp();
        let topics = self.store.load_topics()?;
        let record = topics
            .iter()
            .find(|t| t.id == topic_id)
            .ok_or(TopicError::TopicNotFound { topic_id })?;
        Ok(record.to_view(now))
    }

    pub fn list_topics(&self) -> Result<Vec<TopicView>, TopicError> {
        let now = self.clock.now_timestamp();
        let topics = self.store.load_topics()?;
        Ok(topics.iter().map(|t| t.to_view(now)).collect())
    }
}
