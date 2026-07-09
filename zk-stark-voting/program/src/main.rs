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

    // 5. Generate LWE encryption with deterministic randomness from the seed
    // Using a simple PRNG initialized with the seed
    struct SeededRng {
        state: u64,
    }
    impl rand::RngCore for SeededRng {
        fn next_u32(&mut self) -> u32 {
            self.next_u64() as u32
        }
        fn next_u64(&mut self) -> u64 {
            self.state = self.state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.state
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
    
    let seed_u64 = u64::from_le_bytes(seed[0..8].try_into().unwrap());
    let mut seeded_rng = SeededRng { state: seed_u64 };

    let lwe = Lwe::new();
    let ciphertext = lwe.encrypt_vector(&choice_vector, &public_key, &mut seeded_rng);

    // 6. Commit public values to the verification channel
    sp1_zkvm::io::commit(&ciphertext);
    sp1_zkvm::io::commit(&nullifier);
    sp1_zkvm::io::commit(&merkle_root);
}
