use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

pub const NUM_CANDIDATES: usize = 10;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vote {
    pub voter_secret: u64,
    pub choice_vector: [u64; NUM_CANDIDATES],
}

impl Vote {
    pub fn new(voter_secret: u64, choice_index: usize) -> Self {
        let mut choice_vector = [0u64; NUM_CANDIDATES];
        if choice_index < NUM_CANDIDATES {
            choice_vector[choice_index] = 1;
        }
        Self {
            voter_secret,
            choice_vector,
        }
    }

    pub fn nullifier(&self) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        hasher.update(&self.voter_secret.to_le_bytes());
        hasher.update(b"nullifier");
        hasher.finalize().into()
    }

    pub fn derive_public_key(secret: u64) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        hasher.update(&secret.to_le_bytes());
        hasher.finalize().into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vote_creation_and_nullifier() {
        let secret = 50u64;
        let choice = 4;
        let vote = Vote::new(secret, choice);

        assert_eq!(vote.choice_vector[4], 1);
        assert_eq!(vote.choice_vector[0], 0);

        let mut hasher = Keccak256::new();
        hasher.update(&secret.to_le_bytes());
        hasher.update(b"nullifier");
        let expected: [u8; 32] = hasher.finalize().into();
        assert_eq!(vote.nullifier(), expected);
    }
}
