use serde::{Serialize, Deserialize};

#[derive(Default)]
pub struct SP1Stdin {
    pub buffer: Vec<Vec<u8>>,
}

impl SP1Stdin {
    pub fn new() -> Self {
        Self::default()
    }
    
    pub fn write<T: Serialize>(&mut self, value: &T) {
        let bytes = bincode::serialize(value).unwrap();
        self.buffer.push(bytes);
    }
    
    pub fn write_slice(&mut self, slice: &[u8]) {
        self.buffer.push(slice.to_vec());
    }
}

pub struct SP1PublicValues {
    pub buffer: Vec<Vec<u8>>,
    pub read_idx: usize,
}

impl SP1PublicValues {
    pub fn read<T: for<'a> Deserialize<'a>>(&mut self) -> T {
        let bytes = &self.buffer[self.read_idx];
        self.read_idx += 1;
        bincode::deserialize(bytes).unwrap()
    }
}

pub struct SP1Proof {
    pub public_values: SP1PublicValues,
}

pub struct SP1ProverKey;
pub struct SP1VerifyingKey;

pub struct ProverClient;

impl ProverClient {
    pub fn new() -> Self {
        Self
    }
    
    pub fn setup(&self, _elf: &[u8]) -> (SP1ProverKey, SP1VerifyingKey) {
        (SP1ProverKey, SP1VerifyingKey)
    }
    
    pub fn prove(&self, _pk: &SP1ProverKey, stdin: SP1Stdin) -> SP1ProofBuilder {
        SP1ProofBuilder { stdin }
    }
    
    pub fn verify(&self, _proof: &SP1Proof, _vk: &SP1VerifyingKey) -> Result<(), &'static str> {
        Ok(())
    }
}

pub struct SP1ProofBuilder {
    stdin: SP1Stdin,
}

impl SP1ProofBuilder {
    pub fn run(&self) -> Result<SP1Proof, &'static str> {
        let mut read_idx = 0;
        let voter_secret: u64 = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        read_idx += 1;
        let choice_idx: u32 = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        let choice_idx = choice_idx as usize;
        read_idx += 1;
        let public_key: crate::voting::crypto::LwePublicKey = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        read_idx += 1;
        let merkle_root: [u8; 32] = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        read_idx += 1;
        let merkle_path: Vec<[u8; 32]> = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        read_idx += 1;
        let merkle_indices: Vec<bool> = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        read_idx += 1;
        let seed: [u8; 32] = bincode::deserialize(&self.stdin.buffer[read_idx]).unwrap();
        
        // Verification / execution simulation identical to guest program
        use sha3::{Digest, Keccak256};
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
        if current_hash != merkle_root {
            return Err("Voter public key not in Merkle root!");
        }
        
        if choice_idx >= crate::voting::crypto::NUM_CANDIDATES {
            return Err("Invalid candidate choice index!");
        }
        
        let mut choice_vector = [0u64; crate::voting::crypto::NUM_CANDIDATES];
        choice_vector[choice_idx] = 1;

        let mut nullifier_hasher = Keccak256::new();
        nullifier_hasher.update(&voter_secret.to_le_bytes());
        nullifier_hasher.update(b"nullifier");
        let nullifier: [u8; 32] = nullifier_hasher.finalize().into();
        
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

        let lwe = crate::voting::crypto::Lwe::new();
        let ciphertext = lwe.encrypt_vector(&choice_vector, &public_key, &mut seeded_rng);
        
        let mut pub_values_buffer = Vec::new();
        pub_values_buffer.push(bincode::serialize(&ciphertext).unwrap());
        pub_values_buffer.push(bincode::serialize(&nullifier).unwrap());
        pub_values_buffer.push(bincode::serialize(&merkle_root).unwrap());
        
        Ok(SP1Proof {
            public_values: SP1PublicValues {
                buffer: pub_values_buffer,
                read_idx: 0,
            }
        })
    }
}
