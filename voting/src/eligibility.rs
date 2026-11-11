//! Snapshot root authentication and position eligibility verification matching
//! `SnapshotAuthenticator.sol` and `PositionEligibility.sol` byte-for-byte.

use crate::error::VotingError;
use crate::mpt::{decode_account, verify_account_proof};
use crate::rlp::RlpSlice;
use crate::ssz::{
    BEACON_HEADER_DEPTH, BEACON_HEADER_SLOT_INDEX, BEACON_HEADER_STATE_ROOT_INDEX,
    EXECUTION_ALIGN_DENEB_DEPTH, EXECUTION_ALIGN_ELECTRA_DEPTH, EXECUTION_BLOCK_HASH_LEAF_INDEX,
    SLOTS_PER_EPOCH, VALIDATOR_REGISTRY_LIMIT, compute_validator_root, to_le_64_chunk,
    verify_branch, verify_validator_in_beacon_state,
};
use serde::{Deserialize, Serialize};
use therdal_topics::keccak256;

pub const WALLET_DOMAIN_TAG: &[u8; 14] = b"THERDAL_WALLET";
pub const VALIDATOR_DOMAIN_TAG: &[u8; 17] = b"THERDAL_VALIDATOR";
pub const WITHDRAWAL_PREFIX_ETH1: u8 = 0x01;
pub const WITHDRAWAL_PREFIX_COMPOUNDING: u8 = 0x02;
pub const GWEI_TO_WEI: u128 = 1_000_000_000;
pub const MIN_EXECUTION_HEADER_FIELDS: usize = 15;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BeaconSnapshotAuthProof {
    pub child_block_timestamp: u64,
    pub beacon_slot: u64,
    pub slot_branch: Vec<String>,
    pub beacon_state_root: String,
    pub state_root_branch: Vec<String>,
    pub execution_hash_branch: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidatorStakeProof {
    pub validator_index: u64,
    pub pubkey_root: String,
    pub withdrawal_credentials: String,
    pub effective_balance_gwei: u64,
    pub slashed: bool,
    pub activation_eligibility_epoch: u64,
    pub activation_epoch: u64,
    pub exit_epoch: u64,
    pub withdrawable_epoch: u64,
    pub validator_branch: Vec<String>,
    pub validators_length_chunk: String,
    pub beacon_state_branch: Vec<String>,
}

/// Parses a `0x`-prefixed or bare hex string into arbitrary bytes.
pub fn parse_hex_bytes(raw: &str) -> Result<Vec<u8>, VotingError> {
    let trimmed = raw.trim();
    let stripped = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
        .unwrap_or(trimmed);
    hex::decode(stripped).map_err(|e| VotingError::InvalidHexInput(e.to_string()))
}

/// Parses a `0x`-prefixed or bare hex string into an exact 32-byte array.
pub fn parse_bytes32(raw: &str) -> Result<[u8; 32], VotingError> {
    let bytes = parse_hex_bytes(raw)?;
    if bytes.len() != 32 {
        return Err(VotingError::InvalidHexInput(format!(
            "expected 32 bytes, got {}",
            bytes.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub fn parse_bytes32_vec(items: &[String]) -> Result<Vec<[u8; 32]>, VotingError> {
    items.iter().map(|s| parse_bytes32(s)).collect()
}

/// Computes `keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))` (`66` bytes).
pub fn compute_wallet_position_key(chain_id: u64, account: &[u8; 20]) -> [u8; 32] {
    let mut preimage = [0u8; 66];
    preimage[0..14].copy_from_slice(WALLET_DOMAIN_TAG);
    preimage[38..46].copy_from_slice(&chain_id.to_be_bytes());
    preimage[46..66].copy_from_slice(account);
    keccak256(&preimage)
}

/// Computes `keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))` (`57` bytes).
pub fn compute_validator_position_key(chain_id: u64, validator_index: u64) -> [u8; 32] {
    let mut preimage = [0u8; 57];
    preimage[0..17].copy_from_slice(VALIDATOR_DOMAIN_TAG);
    preimage[41..49].copy_from_slice(&chain_id.to_be_bytes());
    preimage[49..57].copy_from_slice(&validator_index.to_be_bytes());
    keccak256(&preimage)
}

/// Authenticates `snapshot_execution_root` (`stateRoot`) from an RLP execution header against `pinned_block_hash`.
pub fn authenticate_execution_header(
    expected_block_number: u64,
    pinned_block_hash: &[u8; 32],
    rlp_execution_header: &[u8],
) -> Result<[u8; 32], VotingError> {
    let actual_hash = keccak256(rlp_execution_header);
    if &actual_hash != pinned_block_hash {
        return Err(VotingError::ExecutionHeaderHashMismatch {
            expected: format!("0x{}", hex::encode(pinned_block_hash)),
            actual: format!("0x{}", hex::encode(actual_hash)),
        });
    }

    let fields = RlpSlice::parse(rlp_execution_header)?.to_list()?;
    if fields.len() < MIN_EXECUTION_HEADER_FIELDS {
        return Err(VotingError::InvalidRlpHeaderFieldCount {
            count: fields.len(),
        });
    }

    let decoded_block_num = fields[8].to_u64()?;
    if decoded_block_num != expected_block_number {
        return Err(VotingError::ExecutionBlockNumberMismatch {
            expected: expected_block_number,
            actual: decoded_block_num,
        });
    }

    let state_root = fields[3].to_bytes32_strict()?;
    if state_root == [0u8; 32] {
        return Err(VotingError::EmptyExecutionStateRoot);
    }
    Ok(state_root)
}

/// Authenticates `snapshot_beacon_root` and `snapshot_epoch` against `canonical_beacon_block_root` and `pinned_execution_block_hash`.
pub fn authenticate_beacon_snapshot(
    pinned_execution_block_hash: &[u8; 32],
    canonical_beacon_block_root: &[u8; 32],
    proof: &BeaconSnapshotAuthProof,
) -> Result<([u8; 32], u64), VotingError> {
    if canonical_beacon_block_root == &[0u8; 32] {
        return Err(VotingError::BeaconRootUnavailable {
            timestamp: proof.child_block_timestamp,
        });
    }

    let beacon_state_root = parse_bytes32(&proof.beacon_state_root)?;
    let state_root_branch = parse_bytes32_vec(&proof.state_root_branch)?;
    let slot_branch = parse_bytes32_vec(&proof.slot_branch)?;
    let execution_hash_branch = parse_bytes32_vec(&proof.execution_hash_branch)?;

    if beacon_state_root == [0u8; 32]
        || state_root_branch.len() != BEACON_HEADER_DEPTH
        || !verify_branch(
            canonical_beacon_block_root,
            &beacon_state_root,
            &state_root_branch,
            BEACON_HEADER_STATE_ROOT_INDEX as u64,
        )
    {
        return Err(VotingError::InvalidBeaconStateRootProof);
    }

    let slot_chunk = to_le_64_chunk(proof.beacon_slot);
    if slot_branch.len() != BEACON_HEADER_DEPTH
        || !verify_branch(
            canonical_beacon_block_root,
            &slot_chunk,
            &slot_branch,
            BEACON_HEADER_SLOT_INDEX as u64,
        )
    {
        return Err(VotingError::InvalidBeaconSlotProof);
    }

    if (execution_hash_branch.len() != EXECUTION_ALIGN_DENEB_DEPTH
        && execution_hash_branch.len() != EXECUTION_ALIGN_ELECTRA_DEPTH)
        || !verify_branch(
            &beacon_state_root,
            pinned_execution_block_hash,
            &execution_hash_branch,
            EXECUTION_BLOCK_HASH_LEAF_INDEX as u64,
        )
    {
        return Err(VotingError::InvalidExecutionConsensusAlignment);
    }

    let snapshot_epoch = proof.beacon_slot / SLOTS_PER_EPOCH;
    Ok((beacon_state_root, snapshot_epoch))
}

/// Verifies an EIP-1186 MPT account proof for `voter` against `snapshot_execution_root`, returning `balance_wei`.
pub fn verify_execution_balance_proof(
    snapshot_execution_root: &[u8; 32],
    voter: &[u8; 20],
    rlp_account_proof_nodes: &[u8],
) -> Result<u128, VotingError> {
    let key_hash = keccak256(voter);
    let account_rlp = verify_account_proof(snapshot_execution_root, &key_hash, rlp_account_proof_nodes)?;
    let decoded = decode_account(&account_rlp)?;
    if decoded.balance_wei == 0 {
        return Err(VotingError::ZeroVotingWeight);
    }
    Ok(decoded.balance_wei)
}

/// Verifies a Beacon Chain validator stake proof for `voter` at `(snapshot_beacon_root, snapshot_epoch)`.
pub fn verify_validator_stake_proof(
    snapshot_beacon_root: &[u8; 32],
    snapshot_epoch: u64,
    voter: &[u8; 20],
    proof: &ValidatorStakeProof,
) -> Result<u128, VotingError> {
    if proof.validator_index >= VALIDATOR_REGISTRY_LIMIT {
        return Err(VotingError::ValidatorIndexOutOfRange {
            validator_index: proof.validator_index,
        });
    }
    if proof.slashed {
        return Err(VotingError::ValidatorSlashed {
            validator_index: proof.validator_index,
        });
    }
    if proof.activation_epoch > snapshot_epoch || snapshot_epoch >= proof.exit_epoch {
        return Err(VotingError::ValidatorNotActiveAtSnapshot {
            validator_index: proof.validator_index,
            activation_epoch: proof.activation_epoch,
            exit_epoch: proof.exit_epoch,
            snapshot_epoch,
        });
    }

    let withdrawal_creds = parse_bytes32(&proof.withdrawal_credentials)?;
    let prefix = withdrawal_creds[0];
    if prefix != WITHDRAWAL_PREFIX_ETH1 && prefix != WITHDRAWAL_PREFIX_COMPOUNDING {
        return Err(VotingError::UnsupportedWithdrawalPrefix {
            validator_index: proof.validator_index,
            prefix,
        });
    }

    let mut cred_addr = [0u8; 20];
    cred_addr.copy_from_slice(&withdrawal_creds[12..32]);
    if &cred_addr != voter {
        return Err(VotingError::UnauthorizedWithdrawalAddress {
            validator_index: proof.validator_index,
            expected_voter: format!("0x{}", hex::encode(voter)),
            credential_address: format!("0x{}", hex::encode(cred_addr)),
        });
    }

    if proof.effective_balance_gwei == 0 {
        return Err(VotingError::ZeroVotingWeight);
    }

    let pubkey_root = parse_bytes32(&proof.pubkey_root)?;
    let validator_branch = parse_bytes32_vec(&proof.validator_branch)?;
    let validators_length_chunk = parse_bytes32(&proof.validators_length_chunk)?;
    let beacon_state_branch = parse_bytes32_vec(&proof.beacon_state_branch)?;

    let validator_root = compute_validator_root(
        &pubkey_root,
        &withdrawal_creds,
        proof.effective_balance_gwei,
        proof.slashed,
        proof.activation_eligibility_epoch,
        proof.activation_epoch,
        proof.exit_epoch,
        proof.withdrawable_epoch,
    );

    if !verify_validator_in_beacon_state(
        snapshot_beacon_root,
        proof.validator_index,
        &validator_root,
        &validator_branch,
        &validators_length_chunk,
        &beacon_state_branch,
    ) {
        return Err(VotingError::InvalidValidatorProof {
            validator_index: proof.validator_index,
        });
    }

    Ok((proof.effective_balance_gwei as u128) * GWEI_TO_WEI)
}
