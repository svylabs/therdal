//! Ethereum Execution Layer Merkle Patricia Trie (MPT) EIP-1186 account proof verifier & builder
//! matching `contracts/libraries/MerklePatriciaProofVerifier.sol`.

use crate::error::VotingError;
use crate::rlp::{RlpSlice, encode_bytes, encode_list, encode_u128};
use therdal_topics::keccak256;

pub const MAX_TRIE_PROOF_NODES: usize = 65;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedAccount {
    pub nonce: u128,
    pub balance_wei: u128,
    pub storage_root: [u8; 32],
    pub code_hash: [u8; 32],
}

/// Verifies an RLP-encoded EIP-1186 MPT account proof against `state_root` for `key_hash = keccak256(account)`.
pub fn verify_account_proof(
    state_root: &[u8; 32],
    key_hash: &[u8; 32],
    rlp_proof_nodes: &[u8],
) -> Result<Vec<u8>, VotingError> {
    if state_root == &[0u8; 32] {
        return Err(VotingError::EmptyStateRoot);
    }

    let proof_list = RlpSlice::parse(rlp_proof_nodes)?.to_list()?;
    if proof_list.is_empty() || proof_list.len() > MAX_TRIE_PROOF_NODES {
        return Err(VotingError::InvalidMptProof);
    }

    let key_nibbles = to_nibbles(key_hash);
    let mut nibble_index = 0usize;
    let mut expected_hash = *state_root;
    let mut expected_embedded = false;

    for (i, node_item) in proof_list.iter().enumerate() {
        let actual_hash = node_item.keccak256();
        if i == 0 {
            if actual_hash != expected_hash {
                return Err(VotingError::MptNodeHashMismatch {
                    expected: format!("0x{}", hex::encode(expected_hash)),
                    actual: format!("0x{}", hex::encode(actual_hash)),
                });
            }
        } else if expected_embedded {
            if node_item.raw.len() >= 32 || actual_hash != expected_hash {
                return Err(VotingError::InvalidMptProof);
            }
        } else {
            if node_item.raw.len() < 32 {
                return Err(VotingError::InvalidMptProof);
            }
            if actual_hash != expected_hash {
                return Err(VotingError::MptNodeHashMismatch {
                    expected: format!("0x{}", hex::encode(expected_hash)),
                    actual: format!("0x{}", hex::encode(actual_hash)),
                });
            }
        }

        let fields = node_item.to_list()?;
        if fields.len() == 17 {
            if nibble_index == key_nibbles.len() {
                if i != proof_list.len() - 1 {
                    return Err(VotingError::InvalidMptProof);
                }
                let val = fields[16].to_bytes()?;
                if val.is_empty() {
                    return Err(VotingError::AccountNotFoundInTrie);
                }
                return Ok(val.to_vec());
            }

            let nibble = key_nibbles[nibble_index] as usize;
            nibble_index += 1;

            if i == proof_list.len() - 1 {
                return Err(VotingError::InvalidMptProof);
            }
            (expected_hash, expected_embedded) = resolve_child_ref(&fields[nibble])?;
        } else if fields.len() == 2 {
            let compact = fields[0].to_bytes()?;
            let (is_leaf, node_nibbles) = decode_compact_path(compact)?;

            if nibble_index + node_nibbles.len() > key_nibbles.len() {
                return Err(VotingError::MptPathMismatch);
            }
            if key_nibbles[nibble_index..nibble_index + node_nibbles.len()] != node_nibbles[..] {
                return Err(VotingError::MptPathMismatch);
            }
            nibble_index += node_nibbles.len();

            if is_leaf {
                if i != proof_list.len() - 1 || nibble_index != key_nibbles.len() {
                    return Err(VotingError::MptPathMismatch);
                }
                let val = fields[1].to_bytes()?;
                if val.is_empty() {
                    return Err(VotingError::AccountNotFoundInTrie);
                }
                return Ok(val.to_vec());
            } else {
                if node_nibbles.is_empty() || i == proof_list.len() - 1 {
                    return Err(VotingError::InvalidMptProof);
                }
                (expected_hash, expected_embedded) = resolve_child_ref(&fields[1])?;
            }
        } else {
            return Err(VotingError::InvalidMptNodeLength {
                field_count: fields.len(),
            });
        }
    }

    Err(VotingError::InvalidMptProof)
}

/// Decodes `[nonce, balance, storageRoot, codeHash]` from an RLP-encoded Ethereum account leaf.
pub fn decode_account(rlp_account: &[u8]) -> Result<DecodedAccount, VotingError> {
    let fields = RlpSlice::parse(rlp_account)?.to_list()?;
    if fields.len() != 4 {
        return Err(VotingError::InvalidMptProof);
    }
    Ok(DecodedAccount {
        nonce: fields[0].to_u128()?,
        balance_wei: fields[1].to_u128()?,
        storage_root: fields[2].to_bytes32_strict()?,
        code_hash: fields[3].to_bytes32_strict()?,
    })
}

fn resolve_child_ref(child_ref: &RlpSlice<'_>) -> Result<([u8; 32], bool), VotingError> {
    if child_ref.is_list {
        if child_ref.raw.len() >= 32 {
            return Err(VotingError::InvalidMptProof);
        }
        return Ok((child_ref.keccak256(), true));
    }
    let raw_bytes = child_ref.to_bytes()?;
    if raw_bytes.is_empty() {
        return Err(VotingError::AccountNotFoundInTrie);
    }
    Ok((child_ref.to_bytes32_strict()?, false))
}

fn decode_compact_path(compact: &[u8]) -> Result<(bool, Vec<u8>), VotingError> {
    if compact.is_empty() {
        return Err(VotingError::InvalidMptProof);
    }
    let first = compact[0];
    let prefix = first >> 4;
    if prefix > 3 {
        return Err(VotingError::InvalidMptProof);
    }
    let is_leaf = prefix >= 2;
    let is_odd = prefix % 2 == 1;

    let mut nibbles = Vec::with_capacity((compact.len() - 1) * 2 + usize::from(is_odd));
    if is_odd {
        nibbles.push(first & 0x0f);
    } else if (first & 0x0f) != 0 {
        return Err(VotingError::InvalidMptProof);
    }

    for &b in &compact[1..] {
        nibbles.push(b >> 4);
        nibbles.push(b & 0x0f);
    }
    Ok((is_leaf, nibbles))
}

pub fn encode_compact_path(nibbles: &[u8], is_leaf: bool) -> Vec<u8> {
    let is_odd = nibbles.len() % 2 == 1;
    let prefix = (if is_leaf { 2u8 } else { 0u8 }) + u8::from(is_odd);
    if is_odd {
        let mut out = Vec::with_capacity(1 + (nibbles.len() - 1) / 2);
        out.push((prefix << 4) | (nibbles[0] & 0x0f));
        for pair in nibbles[1..].chunks_exact(2) {
            out.push((pair[0] << 4) | (pair[1] & 0x0f));
        }
        out
    } else {
        let mut out = Vec::with_capacity(1 + nibbles.len() / 2);
        out.push(prefix << 4);
        for pair in nibbles.chunks_exact(2) {
            out.push((pair[0] << 4) | (pair[1] & 0x0f));
        }
        out
    }
}

pub fn to_nibbles(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() * 2);
    for &b in data {
        out.push(b >> 4);
        out.push(b & 0x0f);
    }
    out
}

/// Builds a canonical single-leaf MPT state trie for `(account, nonce, balance_wei)`.
pub fn build_single_account_trie(
    account: &[u8; 20],
    nonce: u128,
    balance_wei: u128,
) -> ([u8; 32], Vec<u8>) {
    let key_hash = keccak256(account);
    let nibbles = to_nibbles(&key_hash);
    let hp = encode_compact_path(&nibbles, true);
    let acct_rlp = encode_account_leaf(nonce, balance_wei);
    let leaf_node = encode_list(&[encode_bytes(&hp), encode_bytes(&acct_rlp)]);
    let state_root = keccak256(&leaf_node);
    let proof_nodes = encode_list(&[leaf_node]);
    (state_root, proof_nodes)
}

/// Builds a two-account MPT state trie (with optional extension + 17-item branch + leaves).
pub fn build_two_account_trie(
    acct_a: &[u8; 20],
    bal_a: u128,
    acct_b: &[u8; 20],
    bal_b: u128,
) -> ([u8; 32], Vec<u8>, Vec<u8>) {
    let nib_a = to_nibbles(&keccak256(acct_a));
    let nib_b = to_nibbles(&keccak256(acct_b));

    let mut shared = 0usize;
    while shared < 64 && nib_a[shared] == nib_b[shared] {
        shared += 1;
    }

    let leaf_a = encode_list(&[
        encode_bytes(&encode_compact_path(&nib_a[shared + 1..], true)),
        encode_bytes(&encode_account_leaf(1, bal_a)),
    ]);
    let leaf_b = encode_list(&[
        encode_bytes(&encode_compact_path(&nib_b[shared + 1..], true)),
        encode_bytes(&encode_account_leaf(2, bal_b)),
    ]);

    let mut branch_items: Vec<Vec<u8>> = (0..17).map(|_| vec![0x80]).collect();
    branch_items[nib_a[shared] as usize] = if leaf_a.len() >= 32 {
        encode_bytes(&keccak256(&leaf_a))
    } else {
        leaf_a.clone()
    };
    branch_items[nib_b[shared] as usize] = if leaf_b.len() >= 32 {
        encode_bytes(&keccak256(&leaf_b))
    } else {
        leaf_b.clone()
    };
    let branch_node = encode_list(&branch_items);

    if shared == 0 {
        let root = keccak256(&branch_node);
        (
            root,
            encode_list(&[branch_node.clone(), leaf_a]),
            encode_list(&[branch_node, leaf_b]),
        )
    } else {
        let ext_node = encode_list(&[
            encode_bytes(&encode_compact_path(&nib_a[..shared], false)),
            encode_bytes(&keccak256(&branch_node)),
        ]);
        let root = keccak256(&ext_node);
        (
            root,
            encode_list(&[ext_node.clone(), branch_node.clone(), leaf_a]),
            encode_list(&[ext_node, branch_node, leaf_b]),
        )
    }
}

pub fn encode_account_leaf(nonce: u128, balance_wei: u128) -> Vec<u8> {
    encode_list(&[
        encode_u128(nonce),
        encode_u128(balance_wei),
        encode_bytes(&keccak256(b"empty_storage_root")),
        encode_bytes(&keccak256(b"empty_code_hash")),
    ])
}
