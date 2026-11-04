#![no_main]
sp1_zkvm::entrypoint!(main);

use zk_stark_voting::voting::crypto::{Lwe, LwePublicKey, NUM_CANDIDATES};
use sha3::{Digest, Keccak256};

pub fn main() {
    // Read the inputs provided by the host
    let voter_secret: u64 = sp1_zkvm::io::read();
    let choice_idx_u32: u32 = sp1_zkvm::io::read();
    let choice_idx = choice_idx_u32 as usize;
    
    let public_key: LwePublicKey = sp1_zkvm::io::read();
    let merkle_root: [u8; 32] = sp1_zkvm::io::read();
    let merkle_path: Vec<[u8; 32]> = sp1_zkvm::io::read();
    let merkle_indices: Vec<bool> = sp1_zkvm::io::read();
    
    // Seed for generating encryption randomness inside the VM
    let seed: [u8; 32] = sp1_zkvm::io::read();

    // 1. Verify Merkle Proof (voter is registered)
    let mut hasher = Keccak256::new();
    hasher.update(&voter_secret.to_le_bytes());
    let leaf_hash: [u8; 32] = hasher.finalize().into();

    let mut current_hash = leaf_hash;
    for (sibling, is_right) in merkle_path.iter().zip(merkle_indices.iter()) {
        let mut h = Keccak256::new();
        if *is_right {
            h.update(current_hash);
            h.update(sibling);
        } else {
            h.update(sibling);
            h.update(current_hash);
        }
        current_hash = h.finalize().into();
    }
    assert_eq!(current_hash, merkle_root, "Voter public key not in Merkle root!");

    // 2. Validate Choice Index
    assert!(choice_idx < NUM_CANDIDATES, "Invalid candidate choice index!");

    // 3. Construct Choice Vector
    let mut choice_vector = [0u64; NUM_CANDIDATES];
    choice_vector[choice_idx] = 1;

    // 4. Compute Nullifier (derived from secret to prevent double voting)
    let mut nullifier_hasher = Keccak256::new();
    nullifier_hasher.update(&voter_secret.to_le_bytes());
    nullifier_hasher.update(b"nullifier");
    let nullifier: [u8; 32] = nullifier_hasher.finalize().into();

    // 5. Generate LWE encryption with deterministic randomness from all 32 bytes of seed
    // Using Xoshiro256** initialized with the full 256-bit seed
    struct Xoshiro256StarStar {
        s: [u64; 4],
    }
    impl Xoshiro256StarStar {
        fn from_seed(seed: [u8; 32]) -> Self {
            let mut s = [
                u64::from_le_bytes(seed[0..8].try_into().unwrap()),
                u64::from_le_bytes(seed[8..16].try_into().unwrap()),
                u64::from_le_bytes(seed[16..24].try_into().unwrap()),
                u64::from_le_bytes(seed[24..32].try_into().unwrap()),
            ];
            if s == [0, 0, 0, 0] {
                s[0] = 0x9e3779b97f4a7c15;
            }
            Self { s }
        }
    }
    impl rand::RngCore for Xoshiro256StarStar {
        #[inline]
        fn next_u32(&mut self) -> u32 {
            (self.next_u64() >> 32) as u32
        }
        #[inline]
        fn next_u64(&mut self) -> u64 {
            let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
            let t = self.s[1] << 17;
            self.s[2] ^= self.s[0];
            self.s[3] ^= self.s[1];
            self.s[1] ^= self.s[2];
            self.s[0] ^= self.s[3];
            self.s[2] ^= t;
            self.s[3] = self.s[3].rotate_left(45);
            result
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            for chunk in dest.chunks_mut(8) {
                let r = self.next_u64().to_le_bytes();
                let len = chunk.len();
                chunk.copy_from_slice(&r[..len]);
            }
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }

    let mut seeded_rng = Xoshiro256StarStar::from_seed(seed);

    let lwe = Lwe::new();
    let ciphertext = lwe.encrypt_vector(&choice_vector, &public_key, &mut seeded_rng);
    let pk_commitment = public_key.commitment();

    // 6. Commit public values to the verification channel
    sp1_zkvm::io::commit(&ciphertext);
    sp1_zkvm::io::commit(&nullifier);
    sp1_zkvm::io::commit(&merkle_root);
    sp1_zkvm::io::commit(&pk_commitment);
}
