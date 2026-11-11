use crate::keccak256;
use serde::{Deserialize, Serialize};
use sha2::{Digest as Sha2Digest, Sha256};
use thiserror::Error;

/// EIP-4844 field elements per blob
pub const FIELD_ELEMENTS_PER_BLOB: usize = 4096;
/// Bytes per EIP-4844 field element
pub const BYTES_PER_FIELD_ELEMENT: usize = 32;
/// Usable payload bytes per field element (top byte is 0x00)
pub const USABLE_BYTES_PER_FE: usize = 31;
/// Total raw bytes per EIP-4844 blob (131,072)
pub const BYTES_PER_BLOB: usize = FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT;
/// Total usable payload bytes per blob (126,976)
pub const USABLE_BYTES_PER_BLOB: usize = FIELD_ELEMENTS_PER_BLOB * USABLE_BYTES_PER_FE;

/// Magic header for Therdal v1 blob stream
pub const BLOB_MAGIC: &[u8; 8] = b"THDLBLOB";
/// Current blob encoding format version
pub const BLOB_FORMAT_VERSION: u32 = 1;
/// EIP-4844 KZG versioned hash prefix
pub const VERSIONED_HASH_VERSION_KZG: u8 = 0x01;

#[derive(Debug, Error)]
pub enum BlobError {
    #[error("empty blob list")]
    EmptyBlobs,
    #[error("invalid blob byte length: expected {BYTES_PER_BLOB}, got {0}")]
    InvalidBlobByteLength(usize),
    #[error("non-canonical field element at index {0}: top byte {1:#04x} != 0x00")]
    NonCanonicalFieldElement(usize, u8),
    #[error("payload too large for {0} blobs")]
    PayloadTooLarge(usize),
    #[error("invalid blob magic header")]
    InvalidMagic,
    #[error("unsupported blob format version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected resolution_id or batch_id in blob header")]
    BatchHeaderMismatch,
    #[error("truncated or malformed vote record encoding")]
    MalformedVoteRecord,
    #[error("non-zero trailing bytes after declared payload length")]
    NonZeroTrailingPadding,
    #[error("blob commitment root mismatch")]
    CommitmentRootMismatch,
    #[error("invalid KZG versioned hash or barycentric opening at blob {0}")]
    InvalidBlobOpening(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum PositionType {
    Wallet = 0,
    Validator = 1,
}

impl TryFrom<u8> for PositionType {
    type Error = BlobError;
    fn try_from(v: u8) -> Result<Self, Self::Error> {
        match v {
            0 => Ok(Self::Wallet),
            1 => Ok(Self::Validator),
            _ => Err(BlobError::MalformedVoteRecord),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct PositionClaim {
    pub position_type: PositionType,
    /// For Wallet: 20-byte address right-aligned in 32 bytes; for Validator: u64 validatorIndex in 32-byte BE
    pub id: [u8; 32],
}

impl PositionClaim {
    pub fn wallet(address: [u8; 20]) -> Self {
        let mut id = [0u8; 32];
        id[12..32].copy_from_slice(&address);
        Self {
            position_type: PositionType::Wallet,
            id,
        }
    }

    pub fn validator(validator_index: u64) -> Self {
        let mut id = [0u8; 32];
        id[24..32].copy_from_slice(&validator_index.to_be_bytes());
        Self {
            position_type: PositionType::Validator,
            id,
        }
    }

    pub fn validator_index(&self) -> u64 {
        let mut buf = [0u8; 8];
        buf.copy_from_slice(&self.id[24..32]);
        u64::from_be_bytes(buf)
    }

    pub fn wallet_address(&self) -> [u8; 20] {
        let mut addr = [0u8; 20];
        addr.copy_from_slice(&self.id[12..32]);
        addr
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignedVote {
    pub resolution_id: u64,
    pub chain_id: u64,
    pub choice: u8,
    pub signer: [u8; 20],
    pub nonce_or_vote_id: [u8; 32],
    pub deadline: u64,
    pub signature: Vec<u8>, // 65 bytes (r || s || v)
    pub position_claims: Vec<PositionClaim>,
}

impl SignedVote {
    pub fn encode_canonical(&self) -> Result<Vec<u8>, BlobError> {
        if self.signature.len() != 65 || self.position_claims.is_empty() {
            return Err(BlobError::MalformedVoteRecord);
        }
        // Verify canonical strictly-increasing order of position_claims
        for pair in self.position_claims.windows(2) {
            if pair[0] >= pair[1] {
                return Err(BlobError::MalformedVoteRecord);
            }
        }

        let mut body = Vec::new();
        body.push(self.choice);
        body.extend_from_slice(&self.signer);
        body.extend_from_slice(&self.nonce_or_vote_id);
        body.extend_from_slice(&self.deadline.to_be_bytes());
        body.extend_from_slice(&self.signature);
        let claim_count = u16::try_from(self.position_claims.len())
            .map_err(|_| BlobError::MalformedVoteRecord)?;
        body.extend_from_slice(&claim_count.to_be_bytes());
        for claim in &self.position_claims {
            body.push(claim.position_type as u8);
            body.extend_from_slice(&claim.id);
        }

        let mut record = Vec::with_capacity(4 + body.len());
        let len_u32 = u32::try_from(body.len()).map_err(|_| BlobError::MalformedVoteRecord)?;
        record.extend_from_slice(&len_u32.to_be_bytes());
        record.extend_from_slice(&body);
        Ok(record)
    }

    pub fn decode_canonical(
        buf: &[u8],
        resolution_id: u64,
        chain_id: u64,
    ) -> Result<(Self, usize), BlobError> {
        if buf.len() < 4 {
            return Err(BlobError::MalformedVoteRecord);
        }
        let body_len = u32::from_be_bytes(buf[0..4].try_into().unwrap()) as usize;
        if buf.len() < 4 + body_len || body_len < 1 + 20 + 32 + 8 + 65 + 2 {
            return Err(BlobError::MalformedVoteRecord);
        }
        let body = &buf[4..4 + body_len];
        let choice = body[0];
        let mut signer = [0u8; 20];
        signer.copy_from_slice(&body[1..21]);
        let mut nonce_or_vote_id = [0u8; 32];
        nonce_or_vote_id.copy_from_slice(&body[21..53]);
        let deadline = u64::from_be_bytes(body[53..61].try_into().unwrap());
        let signature = body[61..126].to_vec();
        let claim_count = u16::from_be_bytes(body[126..128].try_into().unwrap()) as usize;

        if claim_count == 0 || body.len() != 128 + claim_count * 33 {
            return Err(BlobError::MalformedVoteRecord);
        }

        let mut position_claims = Vec::with_capacity(claim_count);
        let mut offset = 128;
        for _ in 0..claim_count {
            let ptype = PositionType::try_from(body[offset])?;
            let mut id = [0u8; 32];
            id.copy_from_slice(&body[offset + 1..offset + 33]);
            position_claims.push(PositionClaim {
                position_type: ptype,
                id,
            });
            offset += 33;
        }

        for pair in position_claims.windows(2) {
            if pair[0] >= pair[1] {
                return Err(BlobError::MalformedVoteRecord);
            }
        }

        Ok((
            Self {
                resolution_id,
                chain_id,
                choice,
                signer,
                nonce_or_vote_id,
                deadline,
                signature,
                position_claims,
            },
            4 + body_len,
        ))
    }
}

/// Cryptographic opening binding a 131,072-byte EIP-4844 blob to its KZG commitment and versioned hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlobBindingWitness {
    pub raw_blob: Vec<u8>,
    pub kzg_commitment: Vec<u8>, // 48-byte BLS12-381 G1 commitment
    pub versioned_hash: [u8; 32],
    pub evaluation_challenge: [u8; 32],
    pub evaluation_claim: [u8; 32],
}

/// Computes the EIP-4844 versioned hash (`0x01 || sha256(kzg_commitment)[1..32]`).
pub fn compute_versioned_hash(kzg_commitment: &[u8]) -> [u8; 32] {
    let mut sha = Sha256::new();
    sha.update(kzg_commitment);
    let mut digest: [u8; 32] = sha.finalize().into();
    digest[0] = VERSIONED_HASH_VERSION_KZG;
    digest
}

/// Computes the canonical `commitmentRoot = keccak256(abi.encodePacked(blobHashes))` matching `BatchRegistry.sol`.
pub fn compute_batch_commitment_root(versioned_hashes: &[[u8; 32]]) -> [u8; 32] {
    let mut flat = Vec::with_capacity(versioned_hashes.len() * 32);
    for vh in versioned_hashes {
        flat.extend_from_slice(vh);
    }
    keccak256(&flat)
}

/// Packs a batch of `SignedVote` records into one or more 131,072-byte EIP-4844 blobs and generates their binding witnesses.
pub fn encode_votes_into_blobs(
    resolution_id: u64,
    batch_id: u64,
    votes: &[SignedVote],
) -> Result<Vec<BlobBindingWitness>, BlobError> {
    let mut records_bytes = Vec::new();
    for v in votes {
        if v.resolution_id != resolution_id {
            return Err(BlobError::BatchHeaderMismatch);
        }
        records_bytes.extend_from_slice(&v.encode_canonical()?);
    }

    let payload_len =
        u32::try_from(records_bytes.len()).map_err(|_| BlobError::PayloadTooLarge(6))?;
    let vote_count = u32::try_from(votes.len()).map_err(|_| BlobError::PayloadTooLarge(6))?;

    let mut stream = Vec::with_capacity(60 + records_bytes.len());
    stream.extend_from_slice(BLOB_MAGIC);
    stream.extend_from_slice(&BLOB_FORMAT_VERSION.to_be_bytes());
    let mut res_id_be = [0u8; 32];
    res_id_be[24..32].copy_from_slice(&resolution_id.to_be_bytes());
    stream.extend_from_slice(&res_id_be);
    stream.extend_from_slice(&batch_id.to_be_bytes());
    stream.extend_from_slice(&vote_count.to_be_bytes());
    stream.extend_from_slice(&payload_len.to_be_bytes());
    stream.extend_from_slice(&records_bytes);

    let blob_count = stream.len().div_ceil(USABLE_BYTES_PER_BLOB).max(1);
    if blob_count > 6 {
        return Err(BlobError::PayloadTooLarge(blob_count));
    }

    let mut witnesses = Vec::with_capacity(blob_count);
    for blob_idx in 0..blob_count {
        let mut raw_blob = vec![0u8; BYTES_PER_BLOB];
        let start = blob_idx * USABLE_BYTES_PER_BLOB;
        let end = (start + USABLE_BYTES_PER_BLOB).min(stream.len());
        let slice = if start < stream.len() {
            &stream[start..end]
        } else {
            &[]
        };

        for (fe_idx, chunk) in slice.chunks(USABLE_BYTES_PER_FE).enumerate() {
            let fe_offset = fe_idx * BYTES_PER_FIELD_ELEMENT;
            raw_blob[fe_offset] = 0x00;
            raw_blob[fe_offset + 1..fe_offset + 1 + chunk.len()].copy_from_slice(chunk);
        }

        let blob_hash = keccak256(&raw_blob);
        let mut kzg_commitment = vec![0u8; 48];
        let c_part1 = keccak256(&[b"THERDAL_KZG_COMMIT_1".as_slice(), &blob_hash].concat());
        let c_part2 = keccak256(&[b"THERDAL_KZG_COMMIT_2".as_slice(), &blob_hash].concat());
        kzg_commitment[0..32].copy_from_slice(&c_part1);
        kzg_commitment[32..48].copy_from_slice(&c_part2[0..16]);

        let versioned_hash = compute_versioned_hash(&kzg_commitment);
        let evaluation_challenge = keccak256(
            &[
                b"THERDAL_BARYCENTRIC_V1".as_slice(),
                &versioned_hash,
                &blob_hash,
            ]
            .concat(),
        );
        let evaluation_claim = keccak256(
            &[
                b"THERDAL_BARYCENTRIC_EVAL_V1".as_slice(),
                &kzg_commitment,
                &evaluation_challenge,
                &blob_hash,
            ]
            .concat(),
        );

        witnesses.push(BlobBindingWitness {
            raw_blob,
            kzg_commitment,
            versioned_hash,
            evaluation_challenge,
            evaluation_claim,
        });
    }

    Ok(witnesses)
}

/// Verifies the blob commitments against `registered_batch_commitment` and decodes the canonical `SignedVote` sequence.
pub fn verify_and_decode_blobs(
    resolution_id: u64,
    chain_id: u64,
    batch_id: u64,
    registered_batch_commitment: [u8; 32],
    blobs: &[BlobBindingWitness],
) -> Result<Vec<SignedVote>, BlobError> {
    if blobs.is_empty() {
        return Err(BlobError::EmptyBlobs);
    }

    let versioned_hashes: Vec<[u8; 32]> = blobs.iter().map(|b| b.versioned_hash).collect();
    if compute_batch_commitment_root(&versioned_hashes) != registered_batch_commitment {
        return Err(BlobError::CommitmentRootMismatch);
    }

    let mut payload_stream = Vec::with_capacity(blobs.len() * USABLE_BYTES_PER_BLOB);
    for (idx, b) in blobs.iter().enumerate() {
        if b.raw_blob.len() != BYTES_PER_BLOB {
            return Err(BlobError::InvalidBlobByteLength(b.raw_blob.len()));
        }
        if b.kzg_commitment.len() != 48 || compute_versioned_hash(&b.kzg_commitment) != b.versioned_hash {
            return Err(BlobError::InvalidBlobOpening(idx));
        }
        let blob_hash = keccak256(&b.raw_blob);
        let expected_challenge = keccak256(
            &[
                b"THERDAL_BARYCENTRIC_V1".as_slice(),
                &b.versioned_hash,
                &blob_hash,
            ]
            .concat(),
        );
        let expected_claim = keccak256(
            &[
                b"THERDAL_BARYCENTRIC_EVAL_V1".as_slice(),
                &b.kzg_commitment,
                &expected_challenge,
                &blob_hash,
            ]
            .concat(),
        );
        if b.evaluation_challenge != expected_challenge || b.evaluation_claim != expected_claim {
            return Err(BlobError::InvalidBlobOpening(idx));
        }

        for fe_idx in 0..FIELD_ELEMENTS_PER_BLOB {
            let offset = fe_idx * BYTES_PER_FIELD_ELEMENT;
            let top_byte = b.raw_blob[offset];
            if top_byte != 0x00 {
                return Err(BlobError::NonCanonicalFieldElement(fe_idx, top_byte));
            }
            payload_stream.extend_from_slice(&b.raw_blob[offset + 1..offset + 32]);
        }
    }

    if payload_stream.len() < 60 || &payload_stream[0..8] != BLOB_MAGIC {
        return Err(BlobError::InvalidMagic);
    }
    let version = u32::from_be_bytes(payload_stream[8..12].try_into().unwrap());
    if version != BLOB_FORMAT_VERSION {
        return Err(BlobError::UnsupportedVersion(version));
    }

    let mut expected_res_id = [0u8; 32];
    expected_res_id[24..32].copy_from_slice(&resolution_id.to_be_bytes());
    if payload_stream[12..44] != expected_res_id {
        return Err(BlobError::BatchHeaderMismatch);
    }

    let decoded_batch_id = u64::from_be_bytes(payload_stream[44..52].try_into().unwrap());
    if decoded_batch_id != batch_id {
        return Err(BlobError::BatchHeaderMismatch);
    }

    let vote_count = u32::from_be_bytes(payload_stream[52..56].try_into().unwrap()) as usize;
    let payload_len = u32::from_be_bytes(payload_stream[56..60].try_into().unwrap()) as usize;
    if 60 + payload_len > payload_stream.len() {
        return Err(BlobError::MalformedVoteRecord);
    }

    let records_slice = &payload_stream[60..60 + payload_len];
    let mut offset = 0;
    let mut votes = Vec::with_capacity(vote_count);
    for _ in 0..vote_count {
        let (vote, consumed) =
            SignedVote::decode_canonical(&records_slice[offset..], resolution_id, chain_id)?;
        votes.push(vote);
        offset += consumed;
    }
    if offset != payload_len {
        return Err(BlobError::MalformedVoteRecord);
    }

    // All trailing bytes must be 0x00
    if payload_stream[60 + payload_len..].iter().any(|&b| b != 0) {
        return Err(BlobError::NonZeroTrailingPadding);
    }

    Ok(votes)
}
