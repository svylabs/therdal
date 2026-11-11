//! SHA-256 Simple Serialize (SSZ) Merkleization, verification, and Beacon proof builders
//! matching `contracts/libraries/SSZVerifier.sol`.

use crate::sha256::{compute_zero_hashes, sha256_pair};
use therdal_topics::keccak256;

pub const SLOTS_PER_EPOCH: u64 = 32;
pub const BEACON_HEADER_DEPTH: usize = 3;
pub const BEACON_HEADER_SLOT_INDEX: usize = 0;
pub const BEACON_HEADER_STATE_ROOT_INDEX: usize = 3;
pub const VALIDATOR_REGISTRY_DEPTH: usize = 40;
pub const VALIDATOR_REGISTRY_LIMIT: u64 = 1u64 << 40;
pub const BEACON_STATE_VALIDATORS_FIELD_INDEX: usize = 11;
pub const BEACON_STATE_DENEB_DEPTH: usize = 5;
pub const BEACON_STATE_ELECTRA_DEPTH: usize = 6;
pub const EXECUTION_BLOCK_HASH_LEAF_INDEX: usize = (24 << 5) | 12; // 780
pub const EXECUTION_ALIGN_DENEB_DEPTH: usize = 10;
pub const EXECUTION_ALIGN_ELECTRA_DEPTH: usize = 11;

pub fn to_le_64_chunk(val: u64) -> [u8; 32] {
    let mut chunk = [0u8; 32];
    chunk[0..8].copy_from_slice(&val.to_le_bytes());
    chunk
}

pub fn decode_le_64_chunk(chunk: &[u8; 32]) -> Option<u64> {
    if chunk[8..32].iter().any(|&b| b != 0) {
        return None;
    }
    let mut le = [0u8; 8];
    le.copy_from_slice(&chunk[0..8]);
    Some(u64::from_le_bytes(le))
}

pub fn to_bool_chunk(val: bool) -> [u8; 32] {
    let mut chunk = [0u8; 32];
    if val {
        chunk[0] = 1;
    }
    chunk
}

pub fn eth1_withdrawal_credentials(withdrawal_address: &[u8; 20]) -> [u8; 32] {
    let mut creds = [0u8; 32];
    creds[0] = 0x01;
    creds[12..32].copy_from_slice(withdrawal_address);
    creds
}

pub fn compounding_withdrawal_credentials(withdrawal_address: &[u8; 20]) -> [u8; 32] {
    let mut creds = [0u8; 32];
    creds[0] = 0x02;
    creds[12..32].copy_from_slice(withdrawal_address);
    creds
}

pub fn compute_branch_root(
    leaf: &[u8; 32],
    branch: &[[u8; 32]],
    leaf_index: u64,
) -> [u8; 32] {
    let mut cur = *leaf;
    for (i, sib) in branch.iter().enumerate() {
        let bit = if i < 64 { (leaf_index >> i) & 1 } else { 0 };
        if bit == 1 {
            cur = sha256_pair(sib, &cur);
        } else {
            cur = sha256_pair(&cur, sib);
        }
    }
    cur
}

pub fn verify_branch(
    root: &[u8; 32],
    leaf: &[u8; 32],
    branch: &[[u8; 32]],
    leaf_index: u64,
) -> bool {
    &compute_branch_root(leaf, branch, leaf_index) == root
}

#[allow(clippy::too_many_arguments)]
pub fn compute_validator_root(
    pubkey_root: &[u8; 32],
    withdrawal_credentials: &[u8; 32],
    effective_balance_gwei: u64,
    slashed: bool,
    activation_eligibility_epoch: u64,
    activation_epoch: u64,
    exit_epoch: u64,
    withdrawable_epoch: u64,
) -> [u8; 32] {
    let n00 = sha256_pair(pubkey_root, withdrawal_credentials);
    let n01 = sha256_pair(
        &to_le_64_chunk(effective_balance_gwei),
        &to_bool_chunk(slashed),
    );
    let n02 = sha256_pair(
        &to_le_64_chunk(activation_eligibility_epoch),
        &to_le_64_chunk(activation_epoch),
    );
    let n03 = sha256_pair(
        &to_le_64_chunk(exit_epoch),
        &to_le_64_chunk(withdrawable_epoch),
    );

    let n10 = sha256_pair(&n00, &n01);
    let n11 = sha256_pair(&n02, &n03);
    sha256_pair(&n10, &n11)
}

pub fn verify_validator_in_beacon_state(
    snapshot_beacon_root: &[u8; 32],
    validator_index: u64,
    validator_root: &[u8; 32],
    validator_branch: &[[u8; 32]],
    validators_length_chunk: &[u8; 32],
    beacon_state_branch: &[[u8; 32]],
) -> bool {
    if snapshot_beacon_root == &[0u8; 32] {
        return false;
    }
    if validator_index >= VALIDATOR_REGISTRY_LIMIT {
        return false;
    }
    if validator_branch.len() != VALIDATOR_REGISTRY_DEPTH {
        return false;
    }
    if beacon_state_branch.len() != BEACON_STATE_DENEB_DEPTH
        && beacon_state_branch.len() != BEACON_STATE_ELECTRA_DEPTH
    {
        return false;
    }

    let Some(validator_count) = decode_le_64_chunk(validators_length_chunk) else {
        return false;
    };
    if validator_index >= validator_count || validator_count > VALIDATOR_REGISTRY_LIMIT {
        return false;
    }

    let validators_data_root = compute_branch_root(validator_root, validator_branch, validator_index);
    let validators_list_root = sha256_pair(&validators_data_root, validators_length_chunk);
    let computed_beacon_state_root = compute_branch_root(
        &validators_list_root,
        beacon_state_branch,
        BEACON_STATE_VALIDATORS_FIELD_INDEX as u64,
    );

    &computed_beacon_state_root == snapshot_beacon_root
}

/// Parameters for constructing a deterministic single-validator Beacon snapshot & SSZ proof fixture.
#[derive(Debug, Clone)]
pub struct ValidatorFixtureInput {
    pub validator_index: u64,
    pub pubkey_root: [u8; 32],
    pub withdrawal_credentials: [u8; 32],
    pub effective_balance_gwei: u64,
    pub slashed: bool,
    pub activation_eligibility_epoch: u64,
    pub activation_epoch: u64,
    pub exit_epoch: u64,
    pub withdrawable_epoch: u64,
}

#[derive(Debug, Clone)]
pub struct BuiltBeaconFixture {
    pub beacon_block_root: [u8; 32],
    pub beacon_slot: u64,
    pub child_block_timestamp: u64,
    pub slot_branch: Vec<[u8; 32]>,
    pub beacon_state_root: [u8; 32],
    pub state_root_branch: Vec<[u8; 32]>,
    pub execution_hash_branch: Vec<[u8; 32]>,
    pub validator_branch: Vec<[u8; 32]>,
    pub validators_length_chunk: [u8; 32],
    pub beacon_state_branch: Vec<[u8; 32]>,
}

/// Builds a spec-authentic Beacon snapshot + depth-40 validator SSZ proof aligned to `pinned_execution_block_hash`.
pub fn build_single_validator_beacon_fixture(
    pinned_execution_block_hash: &[u8; 32],
    beacon_slot: u64,
    child_block_timestamp: u64,
    validator_count: u64,
    v: &ValidatorFixtureInput,
    use_electra_depth: bool,
) -> BuiltBeaconFixture {
    let z = compute_zero_hashes();
    let val_root = compute_validator_root(
        &v.pubkey_root,
        &v.withdrawal_credentials,
        v.effective_balance_gwei,
        v.slashed,
        v.activation_eligibility_epoch,
        v.activation_epoch,
        v.exit_epoch,
        v.withdrawable_epoch,
    );

    let mut validator_branch = Vec::with_capacity(40);
    let mut cur = val_root;
    for (i, zero_sib) in z.iter().enumerate().take(40) {
        validator_branch.push(*zero_sib);
        if ((v.validator_index >> i) & 1) == 1 {
            cur = sha256_pair(zero_sib, &cur);
        } else {
            cur = sha256_pair(&cur, zero_sib);
        }
    }
    let validators_length_chunk = to_le_64_chunk(validator_count);
    let validators_list_root = sha256_pair(&cur, &validators_length_chunk);

    let mut exec_leaves = vec![[0u8; 32]; 32];
    exec_leaves[12] = *pinned_execution_block_hash;
    exec_leaves[6] = to_le_64_chunk(21_499_999);
    let (exec_payload_root, exec_inner_branch) = merkleize_power_of_two(&exec_leaves, 12);

    let state_leaf_count = if use_electra_depth { 64 } else { 32 };
    let mut state_leaves = vec![[0u8; 32]; state_leaf_count];
    state_leaves[11] = validators_list_root;
    state_leaves[24] = exec_payload_root;
    let (beacon_state_root, beacon_state_branch) = merkleize_power_of_two(&state_leaves, 11);
    let (_, state_branch_exec) = merkleize_power_of_two(&state_leaves, 24);

    let mut execution_hash_branch = exec_inner_branch;
    execution_hash_branch.extend_from_slice(&state_branch_exec);

    let mut header_leaves = vec![[0u8; 32]; 8];
    header_leaves[0] = to_le_64_chunk(beacon_slot);
    header_leaves[1] = to_le_64_chunk(7);
    header_leaves[2] = keccak256(b"parent_beacon_root");
    header_leaves[3] = beacon_state_root;
    header_leaves[4] = keccak256(b"beacon_body_root");

    let (beacon_block_root, slot_branch) = merkleize_power_of_two(&header_leaves, 0);
    let (_, state_root_branch) = merkleize_power_of_two(&header_leaves, 3);

    BuiltBeaconFixture {
        beacon_block_root,
        beacon_slot,
        child_block_timestamp,
        slot_branch,
        beacon_state_root,
        state_root_branch,
        execution_hash_branch,
        validator_branch,
        validators_length_chunk,
        beacon_state_branch,
    }
}

fn merkleize_power_of_two(leaves: &[[u8; 32]], target_idx: usize) -> ([u8; 32], Vec<[u8; 32]>) {
    let depth = leaves.len().trailing_zeros() as usize;
    let mut branch = Vec::with_capacity(depth);
    let mut layer = leaves.to_vec();
    let mut idx = target_idx;
    for _ in 0..depth {
        branch.push(layer[idx ^ 1]);
        let mut next = Vec::with_capacity(layer.len() / 2);
        for pair in layer.chunks_exact(2) {
            next.push(sha256_pair(&pair[0], &pair[1]));
        }
        layer = next;
        idx >>= 1;
    }
    (layer[0], branch)
}
