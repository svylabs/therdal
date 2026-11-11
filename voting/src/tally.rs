//! Deterministic Stage 2 Direct Voting tally engine and storage traits mirroring `contracts/Therdal.sol`.

use crate::eligibility::{
    BeaconSnapshotAuthProof, ValidatorStakeProof, authenticate_beacon_snapshot,
    authenticate_execution_header, compute_validator_position_key, compute_wallet_position_key,
    parse_bytes32, parse_hex_bytes, verify_execution_balance_proof, verify_validator_stake_proof,
};
use crate::error::VotingError;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use therdal_topics::{ChainClock, TopicError, TopicPhase, TopicRecord, TopicStore};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PositionType {
    ExecutionWallet,
    BeaconValidator,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionReceipt {
    pub claimed: bool,
    pub position_type: PositionType,
    pub voter: String,
    pub validator_index: Option<u64>,
    pub option_index: u32,
    pub weight_wei: u128,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectVoteProofBundle {
    pub include_execution_balance: bool,
    pub rlp_execution_header_hex: String,
    pub rlp_account_proof_nodes_hex: String,
    pub beacon_block_root_hex: Option<String>,
    pub beacon_auth: Option<BeaconSnapshotAuthProof>,
    pub validator_proofs: Vec<ValidatorStakeProof>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicVoteState {
    pub topic_id: u64,
    pub snapshot_beacon_block_root: Option<String>,
    pub snapshot_execution_root: Option<String>,
    pub snapshot_beacon_root: Option<String>,
    pub snapshot_epoch: u64,
    pub option_weights_wei: BTreeMap<u32, u128>,
    pub option_position_counts: BTreeMap<u32, u64>,
    pub total_weight_wei: u128,
    pub total_counted_positions: u64,
    pub direct_vote_count: u64,
    pub position_receipts: BTreeMap<String, PositionReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TopicTallyView {
    pub topic_id: u64,
    pub subject: String,
    pub options: Vec<String>,
    pub phase: TopicPhase,
    pub snapshot_block: u64,
    pub snapshot_block_hash: String,
    pub execution_authenticated: bool,
    pub snapshot_execution_root: Option<String>,
    pub beacon_authenticated: bool,
    pub snapshot_beacon_root: Option<String>,
    pub snapshot_epoch: u64,
    pub option_weights_wei: Vec<u128>,
    pub option_position_counts: Vec<u64>,
    pub total_weight_wei: u128,
    pub total_counted_positions: u64,
    pub direct_vote_count: u64,
}

pub trait VoteStore {
    fn load_vote_states(&self) -> Result<BTreeMap<u64, TopicVoteState>, VotingError>;
    fn save_vote_states(&mut self, states: &BTreeMap<u64, TopicVoteState>) -> Result<(), VotingError>;
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryVoteStore {
    states: BTreeMap<u64, TopicVoteState>,
}

impl VoteStore for InMemoryVoteStore {
    fn load_vote_states(&self) -> Result<BTreeMap<u64, TopicVoteState>, VotingError> {
        Ok(self.states.clone())
    }

    fn save_vote_states(
        &mut self,
        states: &BTreeMap<u64, TopicVoteState>,
    ) -> Result<(), VotingError> {
        self.states = states.clone();
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct JsonFileVoteStore {
    path: PathBuf,
}

impl JsonFileVoteStore {
    pub fn new(path: impl AsRef<Path>) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
        }
    }
}

impl VoteStore for JsonFileVoteStore {
    fn load_vote_states(&self) -> Result<BTreeMap<u64, TopicVoteState>, VotingError> {
        if !self.path.exists() {
            return Ok(BTreeMap::new());
        }
        let raw = fs::read_to_string(&self.path)
            .map_err(|e| VotingError::StorageError(format!("read {:?}: {e}", self.path)))?;
        if raw.trim().is_empty() {
            return Ok(BTreeMap::new());
        }
        serde_json::from_str(&raw)
            .map_err(|e| VotingError::StorageError(format!("parse {:?}: {e}", self.path)))
    }

    fn save_vote_states(
        &mut self,
        states: &BTreeMap<u64, TopicVoteState>,
    ) -> Result<(), VotingError> {
        if let Some(parent) = self.path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)
                .map_err(|e| VotingError::StorageError(format!("mkdir {:?}: {e}", parent)))?;
        }
        let serialized = serde_json::to_string_pretty(states)
            .map_err(|e| VotingError::StorageError(format!("serialize votes: {e}")))?;
        fs::write(&self.path, serialized)
            .map_err(|e| VotingError::StorageError(format!("write {:?}: {e}", self.path)))
    }
}

/// Stage 2 Direct Voting service mirroring `Therdal.sol`.
pub struct DirectVotingService<C: ChainClock, TS: TopicStore, VS: VoteStore> {
    pub chain_id: u64,
    pub clock: C,
    pub topic_store: TS,
    pub vote_store: VS,
}

impl<C: ChainClock, TS: TopicStore, VS: VoteStore> DirectVotingService<C, TS, VS> {
    pub fn new(chain_id: u64, clock: C, topic_store: TS, vote_store: VS) -> Self {
        Self {
            chain_id,
            clock,
            topic_store,
            vote_store,
        }
    }

    pub fn pin_beacon_block_root(
        &mut self,
        topic_id: u64,
        beacon_block_root: &[u8; 32],
    ) -> Result<(), VotingError> {
        let _ = self.load_topic(topic_id)?;
        let mut states = self.vote_store.load_vote_states()?;
        let entry = states.entry(topic_id).or_insert_with(|| TopicVoteState {
            topic_id,
            ..TopicVoteState::default()
        });
        entry.snapshot_beacon_block_root = Some(format!("0x{}", hex::encode(beacon_block_root)));
        self.vote_store.save_vote_states(&states)
    }

    pub fn authenticate_execution_snapshot(
        &mut self,
        topic_id: u64,
        rlp_execution_header: &[u8],
    ) -> Result<[u8; 32], VotingError> {
        let topic = self.load_topic(topic_id)?;
        let mut states = self.vote_store.load_vote_states()?;
        let state = states.entry(topic_id).or_insert_with(|| TopicVoteState {
            topic_id,
            ..TopicVoteState::default()
        });
        if state.snapshot_execution_root.is_some() {
            return Err(VotingError::ExecutionSnapshotAlreadyAuthenticated { topic_id });
        }
        let exec_root = authenticate_execution_header(
            topic.snapshot_block,
            &topic.snapshot_block_hash,
            rlp_execution_header,
        )?;
        state.snapshot_execution_root = Some(format!("0x{}", hex::encode(exec_root)));
        self.vote_store.save_vote_states(&states)?;
        Ok(exec_root)
    }

    pub fn authenticate_beacon_snapshot(
        &mut self,
        topic_id: u64,
        oracle_beacon_block_root: Option<&[u8; 32]>,
        proof: &BeaconSnapshotAuthProof,
    ) -> Result<([u8; 32], u64), VotingError> {
        let topic = self.load_topic(topic_id)?;
        let mut states = self.vote_store.load_vote_states()?;
        let state = states.entry(topic_id).or_insert_with(|| TopicVoteState {
            topic_id,
            ..TopicVoteState::default()
        });
        if state.snapshot_beacon_root.is_some() {
            return Err(VotingError::BeaconSnapshotAlreadyAuthenticated { topic_id });
        }

        let canonical_beacon_root = if let Some(ref pinned_hex) = state.snapshot_beacon_block_root {
            parse_bytes32(pinned_hex)?
        } else if let Some(root) = oracle_beacon_block_root {
            *root
        } else {
            return Err(VotingError::BeaconRootUnavailable {
                timestamp: proof.child_block_timestamp,
            });
        };

        let (beacon_state_root, snapshot_epoch) = authenticate_beacon_snapshot(
            &topic.snapshot_block_hash,
            &canonical_beacon_root,
            proof,
        )?;

        if state.snapshot_beacon_block_root.is_none() {
            state.snapshot_beacon_block_root =
                Some(format!("0x{}", hex::encode(canonical_beacon_root)));
        }
        state.snapshot_beacon_root = Some(format!("0x{}", hex::encode(beacon_state_root)));
        state.snapshot_epoch = snapshot_epoch;
        self.vote_store.save_vote_states(&states)?;
        Ok((beacon_state_root, snapshot_epoch))
    }

    pub fn vote_with_execution_balance(
        &mut self,
        topic_id: u64,
        option_index: u32,
        voter: [u8; 20],
        rlp_execution_header: &[u8],
        rlp_account_proof_nodes: &[u8],
    ) -> Result<u128, VotingError> {
        self.vote_direct(
            topic_id,
            option_index,
            voter,
            &DirectVoteProofBundle {
                include_execution_balance: true,
                rlp_execution_header_hex: format!("0x{}", hex::encode(rlp_execution_header)),
                rlp_account_proof_nodes_hex: format!("0x{}", hex::encode(rlp_account_proof_nodes)),
                beacon_block_root_hex: None,
                beacon_auth: None,
                validator_proofs: Vec::new(),
            },
        )
    }

    pub fn vote_with_beacon_stake(
        &mut self,
        topic_id: u64,
        option_index: u32,
        voter: [u8; 20],
        oracle_beacon_block_root: Option<&[u8; 32]>,
        beacon_auth: Option<BeaconSnapshotAuthProof>,
        validator_proofs: Vec<ValidatorStakeProof>,
    ) -> Result<u128, VotingError> {
        if validator_proofs.is_empty() {
            return Err(VotingError::EmptyDirectVoteProof);
        }
        self.vote_direct(
            topic_id,
            option_index,
            voter,
            &DirectVoteProofBundle {
                include_execution_balance: false,
                rlp_execution_header_hex: String::new(),
                rlp_account_proof_nodes_hex: String::new(),
                beacon_block_root_hex: oracle_beacon_block_root
                    .map(|r| format!("0x{}", hex::encode(r))),
                beacon_auth,
                validator_proofs,
            },
        )
    }

    pub fn vote_direct(
        &mut self,
        topic_id: u64,
        option_index: u32,
        voter: [u8; 20],
        bundle: &DirectVoteProofBundle,
    ) -> Result<u128, VotingError> {
        if !bundle.include_execution_balance && bundle.validator_proofs.is_empty() {
            return Err(VotingError::EmptyDirectVoteProof);
        }

        let topic = self.validate_open_vote_target(topic_id, option_index)?;
        let mut states = self.vote_store.load_vote_states()?;
        let mut state = states.get(&topic_id).cloned().unwrap_or(TopicVoteState {
            topic_id,
            ..TopicVoteState::default()
        });

        let mut total_added_wei = 0u128;
        let voter_hex = format!("0x{}", hex::encode(voter));

        if bundle.include_execution_balance {
            let exec_root = if let Some(ref cached_hex) = state.snapshot_execution_root {
                parse_bytes32(cached_hex)?
            } else {
                let header_bytes = parse_hex_bytes(&bundle.rlp_execution_header_hex)?;
                if header_bytes.is_empty() {
                    return Err(VotingError::ExecutionSnapshotNotAuthenticated { topic_id });
                }
                let root = authenticate_execution_header(
                    topic.snapshot_block,
                    &topic.snapshot_block_hash,
                    &header_bytes,
                )?;
                state.snapshot_execution_root = Some(format!("0x{}", hex::encode(root)));
                root
            };

            let wallet_key = compute_wallet_position_key(self.chain_id, &voter);
            let wallet_key_hex = format!("0x{}", hex::encode(wallet_key));
            if state.position_receipts.contains_key(&wallet_key_hex) {
                return Err(VotingError::PositionAlreadyVoted {
                    topic_id,
                    position_key: wallet_key_hex,
                });
            }

            let proof_bytes = parse_hex_bytes(&bundle.rlp_account_proof_nodes_hex)?;
            let weight_wei = verify_execution_balance_proof(&exec_root, &voter, &proof_bytes)?;

            record_position(
                &mut state,
                wallet_key_hex,
                PositionType::ExecutionWallet,
                None,
                &voter_hex,
                option_index,
                weight_wei,
            );
            total_added_wei += weight_wei;
        }

        if !bundle.validator_proofs.is_empty() {
            let (beacon_root, snapshot_epoch) =
                if let Some(ref cached_hex) = state.snapshot_beacon_root {
                    (parse_bytes32(cached_hex)?, state.snapshot_epoch)
                } else {
                    let Some(ref b_auth) = bundle.beacon_auth else {
                        return Err(VotingError::BeaconSnapshotNotAuthenticated { topic_id });
                    };
                    let canonical_b_root =
                        if let Some(ref pinned) = state.snapshot_beacon_block_root {
                            parse_bytes32(pinned)?
                        } else if let Some(ref provided) = bundle.beacon_block_root_hex {
                            parse_bytes32(provided)?
                        } else {
                            return Err(VotingError::BeaconRootUnavailable {
                                timestamp: b_auth.child_block_timestamp,
                            });
                        };
                    let (b_state_root, epoch) = authenticate_beacon_snapshot(
                        &topic.snapshot_block_hash,
                        &canonical_b_root,
                        b_auth,
                    )?;
                    if state.snapshot_beacon_block_root.is_none() {
                        state.snapshot_beacon_block_root =
                            Some(format!("0x{}", hex::encode(canonical_b_root)));
                    }
                    state.snapshot_beacon_root = Some(format!("0x{}", hex::encode(b_state_root)));
                    state.snapshot_epoch = epoch;
                    (b_state_root, epoch)
                };

            for vp in &bundle.validator_proofs {
                let val_key = compute_validator_position_key(self.chain_id, vp.validator_index);
                let val_key_hex = format!("0x{}", hex::encode(val_key));
                if state.position_receipts.contains_key(&val_key_hex) {
                    return Err(VotingError::PositionAlreadyVoted {
                        topic_id,
                        position_key: val_key_hex,
                    });
                }

                let stake_wei =
                    verify_validator_stake_proof(&beacon_root, snapshot_epoch, &voter, vp)?;

                record_position(
                    &mut state,
                    val_key_hex,
                    PositionType::BeaconValidator,
                    Some(vp.validator_index),
                    &voter_hex,
                    option_index,
                    stake_wei,
                );
                total_added_wei += stake_wei;
            }
        }

        state.direct_vote_count += 1;
        states.insert(topic_id, state);
        self.vote_store.save_vote_states(&states)?;

        Ok(total_added_wei)
    }

    pub fn get_topic_tallies(&self, topic_id: u64) -> Result<TopicTallyView, VotingError> {
        let topic = self.load_topic(topic_id)?;
        let now = self.clock.now_timestamp();
        let states = self.vote_store.load_vote_states()?;
        let state = states.get(&topic_id).cloned().unwrap_or_default();

        let opt_count = topic.options.len() as u32;
        let mut weights = Vec::with_capacity(topic.options.len());
        let mut counts = Vec::with_capacity(topic.options.len());
        for idx in 0..opt_count {
            weights.push(*state.option_weights_wei.get(&idx).unwrap_or(&0));
            counts.push(*state.option_position_counts.get(&idx).unwrap_or(&0));
        }

        Ok(TopicTallyView {
            topic_id,
            subject: topic.subject.clone(),
            options: topic.options.clone(),
            phase: topic.phase_at(now),
            snapshot_block: topic.snapshot_block,
            snapshot_block_hash: format!("0x{}", hex::encode(topic.snapshot_block_hash)),
            execution_authenticated: state.snapshot_execution_root.is_some(),
            snapshot_execution_root: state.snapshot_execution_root,
            beacon_authenticated: state.snapshot_beacon_root.is_some(),
            snapshot_beacon_root: state.snapshot_beacon_root,
            snapshot_epoch: state.snapshot_epoch,
            option_weights_wei: weights,
            option_position_counts: counts,
            total_weight_wei: state.total_weight_wei,
            total_counted_positions: state.total_counted_positions,
            direct_vote_count: state.direct_vote_count,
        })
    }

    pub fn has_wallet_voted(&self, topic_id: u64, account: &[u8; 20]) -> Result<bool, VotingError> {
        let _ = self.load_topic(topic_id)?;
        let states = self.vote_store.load_vote_states()?;
        let Some(state) = states.get(&topic_id) else {
            return Ok(false);
        };
        let key_hex = format!(
            "0x{}",
            hex::encode(compute_wallet_position_key(self.chain_id, account))
        );
        Ok(state.position_receipts.contains_key(&key_hex))
    }

    pub fn has_validator_voted(
        &self,
        topic_id: u64,
        validator_index: u64,
    ) -> Result<bool, VotingError> {
        let _ = self.load_topic(topic_id)?;
        let states = self.vote_store.load_vote_states()?;
        let Some(state) = states.get(&topic_id) else {
            return Ok(false);
        };
        let key_hex = format!(
            "0x{}",
            hex::encode(compute_validator_position_key(self.chain_id, validator_index))
        );
        Ok(state.position_receipts.contains_key(&key_hex))
    }

    fn load_topic(&self, topic_id: u64) -> Result<TopicRecord, VotingError> {
        let topics = self.topic_store.load_topics()?;
        topics
            .into_iter()
            .find(|t| t.id == topic_id)
            .ok_or_else(|| VotingError::Topic(TopicError::TopicNotFound { topic_id }))
    }

    fn validate_open_vote_target(
        &self,
        topic_id: u64,
        option_index: u32,
    ) -> Result<TopicRecord, VotingError> {
        let topic = self.load_topic(topic_id)?;
        let now = self.clock.now_timestamp();
        let phase = topic.phase_at(now);
        if phase != TopicPhase::Open {
            return Err(VotingError::InvalidTopicPhase {
                current: phase,
                expected: TopicPhase::Open,
            });
        }
        let opt_count = topic.options.len() as u32;
        if option_index >= opt_count {
            return Err(VotingError::InvalidOptionIndex {
                option_index,
                option_count: opt_count,
            });
        }
        Ok(topic)
    }
}

fn record_position(
    state: &mut TopicVoteState,
    position_key_hex: String,
    position_type: PositionType,
    validator_index: Option<u64>,
    voter_hex: &str,
    option_index: u32,
    weight_wei: u128,
) {
    state.position_receipts.insert(
        position_key_hex,
        PositionReceipt {
            claimed: true,
            position_type,
            voter: voter_hex.to_string(),
            validator_index,
            option_index,
            weight_wei,
        },
    );
    *state.option_weights_wei.entry(option_index).or_insert(0) += weight_wei;
    *state
        .option_position_counts
        .entry(option_index)
        .or_insert(0) += 1;
    state.total_weight_wei += weight_wei;
    state.total_counted_positions += 1;
}
