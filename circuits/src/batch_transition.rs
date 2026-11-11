use crate::blob_binding::{
    BlobBindingWitness, BlobError, PositionType, verify_and_decode_blobs,
};
use crate::snapshot_eligibility::{
    EligibilityError, ValidatorEligibilityWitness, WalletEligibilityWitness, verify_vote_signature,
};
use crate::{keccak256, u64_to_u256_be, u128_to_u256_be};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BatchTransitionError {
    #[error("blob binding error: {0}")]
    Blob(#[from] BlobError),
    #[error("eligibility error: {0}")]
    Eligibility(#[from] EligibilityError),
}

/// Computes `walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))`
/// matching `SparseMerkleTree.sol`.
pub fn compute_wallet_key(chain_id: u64, account: &[u8; 20]) -> [u8; 32] {
    keccak256(
        &[
            b"THERDAL_WALLET".as_slice(),
            &u64_to_u256_be(chain_id),
            account,
        ]
        .concat(),
    )
}

/// Computes `validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))`
/// matching `SparseMerkleTree.sol`.
pub fn compute_validator_key(chain_id: u64, validator_index: u64) -> [u8; 32] {
    keccak256(
        &[
            b"THERDAL_VALIDATOR".as_slice(),
            &u64_to_u256_be(chain_id),
            &validator_index.to_be_bytes(),
        ]
        .concat(),
    )
}

/// Computes `keccak256(abi.encodePacked(bytes1(0x00), "THERDAL_SMT_LEAF_V1", positionKey))`
/// matching `SparseMerkleTree.sol`.
pub fn compute_occupied_leaf(position_key: &[u8; 32]) -> [u8; 32] {
    keccak256(&[&[0x00u8], b"THERDAL_SMT_LEAF_V1".as_slice(), position_key].concat())
}

/// Computes `hashNode(left, right)` matching `SparseMerkleTree.sol`.
pub fn hash_smt_node(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    if left == &[0u8; 32] && right == &[0u8; 32] {
        return [0u8; 32];
    }
    keccak256(&[&[0x01u8], left.as_slice(), right.as_slice()].concat())
}

/// 256-bit Sparse Merkle Tree tracking already-counted ETH positions (`walletKey` and `validatorKey`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PositionSmt {
    occupied_keys: BTreeMap<[u8; 32], [u8; 32]>,
}

impl PositionSmt {
    pub fn new() -> Self {
        Self {
            occupied_keys: BTreeMap::new(),
        }
    }

    pub fn contains(&self, key: &[u8; 32]) -> bool {
        self.occupied_keys.contains_key(key)
    }

    /// Inserts `key` if not already present. Returns `true` if newly inserted, `false` if duplicate.
    pub fn insert(&mut self, key: [u8; 32]) -> bool {
        if self.occupied_keys.contains_key(&key) {
            return false;
        }
        self.occupied_keys.insert(key, compute_occupied_leaf(&key));
        true
    }

    pub fn len(&self) -> usize {
        self.occupied_keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.occupied_keys.is_empty()
    }

    /// Computes the canonical 256-bit SMT root over all occupied keys (bit 0 = LSB to bit 255 = MSB).
    pub fn root(&self) -> [u8; 32] {
        let entries: Vec<([u8; 32], [u8; 32])> = self
            .occupied_keys
            .iter()
            .map(|(k, v)| (*k, *v))
            .collect();
        Self::compute_subtree_root(&entries, 0)
    }

    fn compute_subtree_root(entries: &[([u8; 32], [u8; 32])], depth: usize) -> [u8; 32] {
        if entries.is_empty() {
            return [0u8; 32];
        }
        if depth == 256 {
            return entries[0].1;
        }

        let mut left = Vec::new();
        let mut right = Vec::new();
        for &(key, leaf) in entries {
            if Self::get_bit_lsb(&key, depth) == 0 {
                left.push((key, leaf));
            } else {
                right.push((key, leaf));
            }
        }

        let left_hash = Self::compute_subtree_root(&left, depth + 1);
        let right_hash = Self::compute_subtree_root(&right, depth + 1);
        hash_smt_node(&left_hash, &right_hash)
    }

    fn get_bit_lsb(key: &[u8; 32], bit_idx: usize) -> u8 {
        let byte_idx = 31 - (bit_idx / 8);
        let bit_offset = bit_idx % 8;
        (key[byte_idx] >> bit_offset) & 1
    }
}

/// Canonical v0.2 public inputs structure matching `ITherdal.BatchPublicInputs` and `StarkVerifierAdapter.sol`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatchPublicInputs {
    pub chain_id: u64,
    pub resolution_id: u64,
    pub ruleset_version: u32,
    pub snapshot_execution_root: [u8; 32],
    pub snapshot_beacon_root: [u8; 32],
    pub batch_id: u64,
    pub registered_batch_commitment: [u8; 32],
    pub old_position_root: [u8; 32],
    pub new_position_root: [u8; 32],
    pub old_tallies: [u128; 3],
    pub new_tallies: [u128; 3],
    pub old_counted_positions: u64,
    pub new_counted_positions: u64,
    pub newly_accepted_vote_count: u64,
}

impl BatchPublicInputs {
    /// Computes the exact 608-byte (`19 * 32`) ABI-encoded Keccak-256 digest matching `StarkVerifierAdapter.sol` (v0.2).
    pub fn compute_digest(&self) -> [u8; 32] {
        let domain = keccak256(b"THERDAL_PUBLIC_INPUTS_V2");
        let mut encoded = Vec::with_capacity(19 * 32);
        encoded.extend_from_slice(&domain);
        encoded.extend_from_slice(&u64_to_u256_be(self.chain_id));
        encoded.extend_from_slice(&u64_to_u256_be(self.resolution_id));
        encoded.extend_from_slice(&u64_to_u256_be(self.ruleset_version as u64));
        encoded.extend_from_slice(&self.snapshot_execution_root);
        encoded.extend_from_slice(&self.snapshot_beacon_root);
        encoded.extend_from_slice(&u64_to_u256_be(self.batch_id));
        encoded.extend_from_slice(&self.registered_batch_commitment);
        encoded.extend_from_slice(&self.old_position_root);
        encoded.extend_from_slice(&self.new_position_root);
        encoded.extend_from_slice(&u128_to_u256_be(self.old_tallies[0]));
        encoded.extend_from_slice(&u128_to_u256_be(self.old_tallies[1]));
        encoded.extend_from_slice(&u128_to_u256_be(self.old_tallies[2]));
        encoded.extend_from_slice(&u128_to_u256_be(self.new_tallies[0]));
        encoded.extend_from_slice(&u128_to_u256_be(self.new_tallies[1]));
        encoded.extend_from_slice(&u128_to_u256_be(self.new_tallies[2]));
        encoded.extend_from_slice(&u64_to_u256_be(self.old_counted_positions));
        encoded.extend_from_slice(&u64_to_u256_be(self.new_counted_positions));
        encoded.extend_from_slice(&u64_to_u256_be(self.newly_accepted_vote_count));
        keccak256(&encoded)
    }

    /// Computes the 32-byte deterministic STARK proof commitment tag matching `StarkVerifierAdapter.sol` (v0.2).
    pub fn compute_proof_tag(&self, program_vkey: &[u8; 32]) -> [u8; 32] {
        let proof_domain = keccak256(b"THERDAL_STARK_PROOF_V2");
        let digest = self.compute_digest();
        keccak256(&[proof_domain.as_slice(), program_vkey, &digest].concat())
    }
}

/// Complete private witness for proving a batch transition.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchWitness {
    pub chain_id: u64,
    pub resolution_id: u64,
    pub ruleset_version: u32,
    pub snapshot_epoch: u64,
    pub voting_ends_at: u64,
    pub snapshot_execution_root: [u8; 32],
    pub snapshot_beacon_root: [u8; 32],
    pub batch_id: u64,
    pub registered_batch_commitment: [u8; 32],
    pub blobs: Vec<BlobBindingWitness>,
    pub wallet_witnesses: BTreeMap<[u8; 20], WalletEligibilityWitness>,
    pub validator_witnesses: BTreeMap<u64, ValidatorEligibilityWitness>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchTransitionOutput {
    pub public_inputs: BatchPublicInputs,
    pub updated_smt: PositionSmt,
    pub newly_counted_positions: u64,
    pub newly_accepted_vote_count: u64,
    pub skipped_duplicate_positions: u64,
    pub rejected_votes: u64,
}

/// Executes the deterministic batch state transition over `blobs`, updating `smt`, `tallies`,
/// `counted_positions`, and authenticating `newly_accepted_vote_count` (per Section 9.2: a single
/// voter aggregating multiple validator positions in one valid vote counts as 1 accepted vote).
pub fn execute_batch_transition(
    mut smt: PositionSmt,
    old_tallies: [u128; 3],
    old_counted_positions: u64,
    witness: &BatchWitness,
) -> Result<BatchTransitionOutput, BatchTransitionError> {
    let old_position_root = smt.root();

    let decoded_votes = verify_and_decode_blobs(
        witness.resolution_id,
        witness.chain_id,
        witness.batch_id,
        witness.registered_batch_commitment,
        &witness.blobs,
    )?;

    let mut new_tallies = old_tallies;
    let mut new_counted_positions = old_counted_positions;
    let mut newly_accepted_vote_count = 0u64;
    let mut skipped_duplicates = 0u64;
    let mut rejected_votes = 0u64;

    for vote in &decoded_votes {
        if vote.choice > 2 || vote.deadline < witness.voting_ends_at {
            rejected_votes += 1;
            continue;
        }
        if verify_vote_signature(vote).is_err() {
            rejected_votes += 1;
            continue;
        }

        let mut vote_contributed_new_position = false;

        for claim in &vote.position_claims {
            match claim.position_type {
                PositionType::Wallet => {
                    let addr = claim.wallet_address();
                    if addr != vote.signer {
                        continue;
                    }
                    let Some(w_wit) = witness.wallet_witnesses.get(&addr) else {
                        return Err(EligibilityError::InvalidWalletProof(addr).into());
                    };
                    if !w_wit.verify(&witness.snapshot_execution_root) {
                        return Err(EligibilityError::InvalidWalletProof(addr).into());
                    }
                    if w_wit.balance_wei == 0 {
                        continue;
                    }
                    let key = compute_wallet_key(witness.chain_id, &addr);
                    if smt.insert(key) {
                        new_tallies[vote.choice as usize] = new_tallies[vote.choice as usize]
                            .checked_add(w_wit.balance_wei)
                            .expect("tally overflow");
                        new_counted_positions += 1;
                        vote_contributed_new_position = true;
                    } else {
                        skipped_duplicates += 1;
                    }
                }
                PositionType::Validator => {
                    let val_idx = claim.validator_index();
                    let Some(v_wit) = witness.validator_witnesses.get(&val_idx) else {
                        return Err(EligibilityError::InvalidValidatorProof(val_idx).into());
                    };
                    let weight_wei = v_wit.verify(
                        &witness.snapshot_beacon_root,
                        witness.snapshot_epoch,
                        &vote.signer,
                    )?;
                    if weight_wei == 0 {
                        continue;
                    }
                    let key = compute_validator_key(witness.chain_id, val_idx);
                    if smt.insert(key) {
                        new_tallies[vote.choice as usize] = new_tallies[vote.choice as usize]
                            .checked_add(weight_wei)
                            .expect("tally overflow");
                        new_counted_positions += 1;
                        vote_contributed_new_position = true;
                    } else {
                        skipped_duplicates += 1;
                    }
                }
            }
        }

        if vote_contributed_new_position {
            newly_accepted_vote_count += 1;
        }
    }

    let new_position_root = smt.root();
    let newly_counted_positions = new_counted_positions - old_counted_positions;

    let public_inputs = BatchPublicInputs {
        chain_id: witness.chain_id,
        resolution_id: witness.resolution_id,
        ruleset_version: witness.ruleset_version,
        snapshot_execution_root: witness.snapshot_execution_root,
        snapshot_beacon_root: witness.snapshot_beacon_root,
        batch_id: witness.batch_id,
        registered_batch_commitment: witness.registered_batch_commitment,
        old_position_root,
        new_position_root,
        old_tallies,
        new_tallies,
        old_counted_positions,
        new_counted_positions,
        newly_accepted_vote_count,
    };

    Ok(BatchTransitionOutput {
        public_inputs,
        updated_smt: smt,
        newly_counted_positions,
        newly_accepted_vote_count,
        skipped_duplicate_positions: skipped_duplicates,
        rejected_votes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blob_binding::{PositionClaim, compute_batch_commitment_root, encode_votes_into_blobs};
    use crate::snapshot_eligibility::{
        build_validator_ssz_tree, build_wallet_merkle_tree, sign_vote, signing_key_to_address,
    };
    use k256::ecdsa::SigningKey;

    #[test]
    fn test_v02_batch_transition_accepted_vote_count_vs_positions() {
        let sk1 = SigningKey::from_bytes(&[0x11u8; 32].into()).unwrap();
        let sk2 = SigningKey::from_bytes(&[0x22u8; 32].into()).unwrap();
        let addr1 = signing_key_to_address(&sk1);
        let addr2 = signing_key_to_address(&sk2);

        let (exec_root, wallet_wits) = build_wallet_merkle_tree(vec![
            WalletEligibilityWitness {
                account: addr1,
                balance_wei: 100_000_000_000_000_000_000,
                merkle_branch: vec![],
                leaf_index: 0,
            },
            WalletEligibilityWitness {
                account: addr2,
                balance_wei: 50_000_000_000_000_000_000,
                merkle_branch: vec![],
                leaf_index: 1,
            },
        ]);

        let mut wc1 = [0u8; 32];
        wc1[0] = 0x01;
        wc1[12..32].copy_from_slice(&addr1);

        let (beacon_root, val_wits) = build_validator_ssz_tree(vec![ValidatorEligibilityWitness {
            validator_index: 42,
            pubkey_root: [0xAAu8; 32],
            withdrawal_credentials: wc1,
            effective_balance_gwei: 32_000_000_000,
            slashed: false,
            activation_eligibility_epoch: 100,
            activation_epoch: 100,
            exit_epoch: 999_999,
            withdrawable_epoch: 999_999,
            ssz_branch: vec![],
            ssz_leaf_index: 0,
        }]);

        // Voter 1 claims Wallet + Validator 42 in ONE vote -> 2 positions, 1 accepted vote!
        let vote1 = sign_vote(
            &sk1,
            1,
            1,
            0,
            [0x01u8; 32],
            2_000_000_000,
            vec![PositionClaim::wallet(addr1), PositionClaim::validator(42)],
        );

        // Voter 1 submits duplicate vote -> 0 new positions, 0 accepted votes!
        let vote1_dup = sign_vote(
            &sk1,
            1,
            1,
            1,
            [0x02u8; 32],
            2_000_000_000,
            vec![PositionClaim::wallet(addr1)],
        );

        // Voter 2 claims Wallet -> 1 position, 1 accepted vote!
        let vote2 = sign_vote(
            &sk2,
            1,
            1,
            1,
            [0x03u8; 32],
            2_000_000_000,
            vec![PositionClaim::wallet(addr2)],
        );

        let blobs = encode_votes_into_blobs(1, 0, &[vote1, vote1_dup, vote2]).unwrap();
        let vhashes: Vec<[u8; 32]> = blobs.iter().map(|b| b.versioned_hash).collect();
        let commitment_root = compute_batch_commitment_root(&vhashes);

        let mut wallet_map = BTreeMap::new();
        for w in wallet_wits {
            wallet_map.insert(w.account, w);
        }
        let mut val_map = BTreeMap::new();
        for v in val_wits {
            val_map.insert(v.validator_index, v);
        }

        let witness = BatchWitness {
            chain_id: 1,
            resolution_id: 1,
            ruleset_version: 1,
            snapshot_epoch: 250_000,
            voting_ends_at: 1_900_000_000,
            snapshot_execution_root: exec_root,
            snapshot_beacon_root: beacon_root,
            batch_id: 0,
            registered_batch_commitment: commitment_root,
            blobs,
            wallet_witnesses: wallet_map,
            validator_witnesses: val_map,
        };

        let out = execute_batch_transition(PositionSmt::new(), [0, 0, 0], 0, &witness).unwrap();

        assert_eq!(out.public_inputs.new_counted_positions, 3);
        assert_eq!(out.newly_counted_positions, 3);
        // Only 2 newly accepted valid votes (Voter 1's multi-position vote = 1, Voter 2's vote = 1, duplicate = 0)
        assert_eq!(out.newly_accepted_vote_count, 2);
        assert_eq!(out.public_inputs.newly_accepted_vote_count, 2);
        assert_eq!(out.skipped_duplicate_positions, 1);
    }
}
