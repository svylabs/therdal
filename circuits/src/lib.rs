pub mod batch_transition;
pub mod blob_binding;
pub mod snapshot_eligibility;

use sha3::{Digest, Keccak256};

/// Computes the 32-byte Keccak-256 hash of `data`.
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Encodes a `u64` into a 32-byte big-endian EVM `uint256` word.
pub fn u64_to_u256_be(val: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&val.to_be_bytes());
    out
}

/// Encodes a `u128` into a 32-byte big-endian EVM `uint256` word.
pub fn u128_to_u256_be(val: u128) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[16..32].copy_from_slice(&val.to_be_bytes());
    out
}
