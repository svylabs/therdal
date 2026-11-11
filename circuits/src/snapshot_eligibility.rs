use crate::blob_binding::{PositionClaim, SignedVote};
use crate::{keccak256, u64_to_u256_be};
use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest as Sha2Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EligibilityError {
    #[error("invalid EIP-712 signature")]
    InvalidSignature,
    #[error("recovered signer {0:?} does not match vote.signer {1:?}")]
    SignerMismatch([u8; 20], [u8; 20]),
    #[error("invalid choice: {0}")]
    InvalidChoice(u8),
    #[error("vote deadline {0} expired before cutoff {1}")]
    VoteExpired(u64, u64),
    #[error("missing or invalid account proof for wallet {0:?}")]
    InvalidWalletProof([u8; 20]),
    #[error("missing or invalid validator proof for index {0}")]
    InvalidValidatorProof(u64),
    #[error("validator {0} is slashed or inactive at snapshot epoch {1}")]
    ValidatorNotActive(u64, u64),
    #[error("validator {0} withdrawal credentials do not authorize signer")]
    UnauthorizedValidatorWithdrawal(u64),
}

/// Derives the 20-byte Ethereum address from a `k256::ecdsa::SigningKey`.
pub fn signing_key_to_address(sk: &SigningKey) -> [u8; 20] {
    let vk = sk.verifying_key();
    let encoded = vk.to_encoded_point(false);
    let pubkey_bytes = &encoded.as_bytes()[1..65];
    let hash = keccak256(pubkey_bytes);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..32]);
    addr
}

/// Computes the canonical EIP-712 signing digest for a `SignedVote`.
pub fn compute_vote_signing_digest(
    resolution_id: u64,
    chain_id: u64,
    choice: u8,
    signer: &[u8; 20],
    nonce_or_vote_id: &[u8; 32],
    deadline: u64,
    position_claims: &[PositionClaim],
) -> [u8; 32] {
    let mut claims_buf = Vec::with_capacity(position_claims.len() * 33);
    for c in position_claims {
        claims_buf.push(c.position_type as u8);
        claims_buf.extend_from_slice(&c.id);
    }
    let claims_hash = keccak256(&claims_buf);

    let struct_hash = keccak256(
        &[
            keccak256(b"Vote(uint256 resolutionId,uint256 chainId,uint8 choice,address signer,bytes32 nonceOrVoteId,uint64 deadline,bytes32 positionClaimsHash)").as_slice(),
            &u64_to_u256_be(resolution_id),
            &u64_to_u256_be(chain_id),
            &u64_to_u256_be(choice as u64),
            &{
                let mut w = [0u8; 32];
                w[12..32].copy_from_slice(signer);
                w
            },
            nonce_or_vote_id,
            &u64_to_u256_be(deadline),
            &claims_hash,
        ]
        .concat(),
    );

    let domain_separator = keccak256(
        &[
            keccak256(b"EIP712Domain(string name,string version,uint256 chainId)").as_slice(),
            &keccak256(b"Therdal"),
            &keccak256(b"1"),
            &u64_to_u256_be(chain_id),
        ]
        .concat(),
    );

    keccak256(&[b"\x19\x01".as_slice(), &domain_separator, &struct_hash].concat())
}

/// Signs a vote envelope with `SigningKey` using secp256k1 ECDSA (`r || s || v`).
pub fn sign_vote(
    sk: &SigningKey,
    resolution_id: u64,
    chain_id: u64,
    choice: u8,
    nonce_or_vote_id: [u8; 32],
    deadline: u64,
    mut position_claims: Vec<PositionClaim>,
) -> SignedVote {
    position_claims.sort();
    let signer = signing_key_to_address(sk);
    let digest = compute_vote_signing_digest(
        resolution_id,
        chain_id,
        choice,
        &signer,
        &nonce_or_vote_id,
        deadline,
        &position_claims,
    );
    let (sig, recid) = sk
        .sign_prehash_recoverable(&digest)
        .expect("recoverable secp256k1 signature");
    let mut signature = Vec::with_capacity(65);
    signature.extend_from_slice(&sig.to_bytes());
    signature.push(recid.to_byte() + 27);

    SignedVote {
        resolution_id,
        chain_id,
        choice,
        signer,
        nonce_or_vote_id,
        deadline,
        signature,
        position_claims,
    }
}

/// Verifies a `SignedVote`'s EIP-712 signature and recovers the Ethereum signer address.
pub fn verify_vote_signature(vote: &SignedVote) -> Result<[u8; 20], EligibilityError> {
    if vote.signature.len() != 65 {
        return Err(EligibilityError::InvalidSignature);
    }
    let digest = compute_vote_signing_digest(
        vote.resolution_id,
        vote.chain_id,
        vote.choice,
        &vote.signer,
        &vote.nonce_or_vote_id,
        vote.deadline,
        &vote.position_claims,
    );
    let sig = Signature::from_slice(&vote.signature[0..64])
        .map_err(|_| EligibilityError::InvalidSignature)?;
    let v = vote.signature[64];
    let rec_byte = if v >= 27 { v - 27 } else { v };
    let recid =
        RecoveryId::from_byte(rec_byte).ok_or(EligibilityError::InvalidSignature)?;

    let vk = VerifyingKey::recover_from_prehash(&digest, &sig, recid)
        .map_err(|_| EligibilityError::InvalidSignature)?;
    let encoded = vk.to_encoded_point(false);
    let hash = keccak256(&encoded.as_bytes()[1..65]);
    let mut recovered = [0u8; 20];
    recovered.copy_from_slice(&hash[12..32]);

    if recovered != vote.signer {
        return Err(EligibilityError::SignerMismatch(recovered, vote.signer));
    }
    Ok(recovered)
}

/// Execution-layer wallet balance inclusion witness against `snapshot_execution_root`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletEligibilityWitness {
    pub account: [u8; 20],
    pub balance_wei: u128,
    pub merkle_branch: Vec<[u8; 32]>,
    pub leaf_index: usize,
}

impl WalletEligibilityWitness {
    pub fn compute_leaf_hash(&self) -> [u8; 32] {
        keccak256(
            &[
                b"THERDAL_EXEC_ACCOUNT_LEAF_V1".as_slice(),
                &self.account,
                &self.balance_wei.to_be_bytes(),
            ]
            .concat(),
        )
    }

    pub fn verify(&self, snapshot_execution_root: &[u8; 32]) -> bool {
        let mut cur = self.compute_leaf_hash();
        let mut idx = self.leaf_index;
        for sib in &self.merkle_branch {
            if (idx & 1) == 1 {
                cur = keccak256(&[sib.as_slice(), cur.as_slice()].concat());
            } else {
                cur = keccak256(&[cur.as_slice(), sib.as_slice()].concat());
            }
            idx >>= 1;
        }
        &cur == snapshot_execution_root
    }
}

/// Consensus-layer validator stake SSZ inclusion witness against `snapshot_beacon_root`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorEligibilityWitness {
    pub validator_index: u64,
    pub pubkey_root: [u8; 32],
    pub withdrawal_credentials: [u8; 32],
    pub effective_balance_gwei: u64,
    pub slashed: bool,
    pub activation_eligibility_epoch: u64,
    pub activation_epoch: u64,
    pub exit_epoch: u64,
    pub withdrawable_epoch: u64,
    pub ssz_branch: Vec<[u8; 32]>,
    pub ssz_leaf_index: usize,
}

pub fn sha256_pair(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(left);
    h.update(right);
    h.finalize().into()
}

pub fn to_le_64_chunk(val: u64) -> [u8; 32] {
    let mut chunk = [0u8; 32];
    chunk[0..8].copy_from_slice(&val.to_le_bytes());
    chunk
}

impl ValidatorEligibilityWitness {
    /// Computes the SSZ `hash_tree_root` of the `Validator` container matching `SSZVerifier.sol`.
    pub fn compute_validator_root(&self) -> [u8; 32] {
        let mut slashed_chunk = [0u8; 32];
        if self.slashed {
            slashed_chunk[0] = 1;
        }
        let n00 = sha256_pair(&self.pubkey_root, &self.withdrawal_credentials);
        let n01 = sha256_pair(
            &to_le_64_chunk(self.effective_balance_gwei),
            &slashed_chunk,
        );
        let n02 = sha256_pair(
            &to_le_64_chunk(self.activation_eligibility_epoch),
            &to_le_64_chunk(self.activation_epoch),
        );
        let n03 = sha256_pair(
            &to_le_64_chunk(self.exit_epoch),
            &to_le_64_chunk(self.withdrawable_epoch),
        );
        let n10 = sha256_pair(&n00, &n01);
        let n11 = sha256_pair(&n02, &n03);
        sha256_pair(&n10, &n11)
    }

    pub fn verify(
        &self,
        snapshot_beacon_root: &[u8; 32],
        snapshot_epoch: u64,
        expected_signer: &[u8; 20],
    ) -> Result<u128, EligibilityError> {
        if self.slashed
            || self.activation_epoch > snapshot_epoch
            || snapshot_epoch >= self.exit_epoch
        {
            return Err(EligibilityError::ValidatorNotActive(
                self.validator_index,
                snapshot_epoch,
            ));
        }

        let prefix = self.withdrawal_credentials[0];
        if prefix != 0x01 && prefix != 0x02 {
            return Err(EligibilityError::UnauthorizedValidatorWithdrawal(
                self.validator_index,
            ));
        }
        if &self.withdrawal_credentials[12..32] != expected_signer {
            return Err(EligibilityError::UnauthorizedValidatorWithdrawal(
                self.validator_index,
            ));
        }

        let mut cur = self.compute_validator_root();
        let mut idx = self.ssz_leaf_index;
        for sib in &self.ssz_branch {
            if (idx & 1) == 1 {
                cur = sha256_pair(sib, &cur);
            } else {
                cur = sha256_pair(&cur, sib);
            }
            idx >>= 1;
        }
        if &cur != snapshot_beacon_root {
            return Err(EligibilityError::InvalidValidatorProof(
                self.validator_index,
            ));
        }

        Ok((self.effective_balance_gwei as u128) * 1_000_000_000u128)
    }
}

/// Helper to build a Merkle tree over wallet witnesses and return `(root, updated_witnesses)`.
pub fn build_wallet_merkle_tree(
    mut witnesses: Vec<WalletEligibilityWitness>,
) -> ([u8; 32], Vec<WalletEligibilityWitness>) {
    if witnesses.is_empty() {
        return ([0u8; 32], witnesses);
    }
    let next_pow2 = witnesses.len().next_power_of_two();
    let mut leaves = vec![[0u8; 32]; next_pow2];
    for (i, w) in witnesses.iter_mut().enumerate() {
        w.leaf_index = i;
        leaves[i] = w.compute_leaf_hash();
    }

    let depth = next_pow2.trailing_zeros() as usize;
    let mut layers = vec![leaves];
    for _ in 0..depth {
        let prev = layers.last().unwrap();
        let mut next = Vec::with_capacity(prev.len() / 2);
        for pair in prev.chunks(2) {
            next.push(keccak256(&[pair[0].as_slice(), pair[1].as_slice()].concat()));
        }
        layers.push(next);
    }

    let root = layers.last().unwrap()[0];
    for w in witnesses.iter_mut() {
        let mut idx = w.leaf_index;
        let mut branch = Vec::with_capacity(depth);
        for d in 0..depth {
            let sib_idx = idx ^ 1;
            branch.push(layers[d][sib_idx]);
            idx >>= 1;
        }
        w.merkle_branch = branch;
    }

    (root, witnesses)
}

/// Helper to build an SSZ SHA-256 Merkle tree over validator witnesses and return `(root, updated_witnesses)`.
pub fn build_validator_ssz_tree(
    mut witnesses: Vec<ValidatorEligibilityWitness>,
) -> ([u8; 32], Vec<ValidatorEligibilityWitness>) {
    if witnesses.is_empty() {
        return ([0u8; 32], witnesses);
    }
    let next_pow2 = witnesses.len().next_power_of_two();
    let mut leaves = vec![[0u8; 32]; next_pow2];
    for (i, w) in witnesses.iter_mut().enumerate() {
        w.ssz_leaf_index = i;
        leaves[i] = w.compute_validator_root();
    }

    let depth = next_pow2.trailing_zeros() as usize;
    let mut layers = vec![leaves];
    for _ in 0..depth {
        let prev = layers.last().unwrap();
        let mut next = Vec::with_capacity(prev.len() / 2);
        for pair in prev.chunks(2) {
            next.push(sha256_pair(&pair[0], &pair[1]));
        }
        layers.push(next);
    }

    let root = layers.last().unwrap()[0];
    for w in witnesses.iter_mut() {
        let mut idx = w.ssz_leaf_index;
        let mut branch = Vec::with_capacity(depth);
        for d in 0..depth {
            let sib_idx = idx ^ 1;
            branch.push(layers[d][sib_idx]);
            idx >>= 1;
        }
        w.ssz_branch = branch;
    }

    (root, witnesses)
}
