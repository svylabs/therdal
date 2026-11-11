//! Canonical Recursive Length Prefix (RLP) encoder and decoder matching `contracts/libraries/RLPReader.sol`.

use crate::error::VotingError;
use therdal_topics::keccak256;

const STRING_SHORT_START: u8 = 0x80;
const STRING_LONG_START: u8 = 0xb8;
const LIST_SHORT_START: u8 = 0xc0;
const LIST_LONG_START: u8 = 0xf8;
const SHORT_PAYLOAD_MAX: usize = 55;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RlpSlice<'a> {
    pub raw: &'a [u8],
    pub offset: usize,
    pub payload_len: usize,
    pub is_list: bool,
}

impl<'a> RlpSlice<'a> {
    pub fn parse(raw: &'a [u8]) -> Result<Self, VotingError> {
        if raw.is_empty() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        let (offset, payload_len, is_list) = decode_offset_and_len(raw)?;
        if offset + payload_len != raw.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        Ok(Self {
            raw,
            offset,
            payload_len,
            is_list,
        })
    }

    pub fn keccak256(&self) -> [u8; 32] {
        keccak256(self.raw)
    }

    pub fn to_list(&self) -> Result<Vec<RlpSlice<'a>>, VotingError> {
        if !self.is_list {
            return Err(VotingError::RlpItemNotList);
        }
        let mut items = Vec::new();
        let mut pos = self.offset;
        let end = self.offset + self.payload_len;
        while pos < end {
            let (off, plen, child_is_list) = decode_offset_and_len(&self.raw[pos..end])?;
            let elem_len = off + plen;
            items.push(RlpSlice {
                raw: &self.raw[pos..pos + elem_len],
                offset: off,
                payload_len: plen,
                is_list: child_is_list,
            });
            pos += elem_len;
        }
        if pos != end {
            return Err(VotingError::InvalidRlpEncoding);
        }
        Ok(items)
    }

    pub fn to_bytes(&self) -> Result<&'a [u8], VotingError> {
        if self.is_list {
            return Err(VotingError::RlpItemIsList);
        }
        Ok(&self.raw[self.offset..self.offset + self.payload_len])
    }

    pub fn to_bytes32_strict(&self) -> Result<[u8; 32], VotingError> {
        let bytes = self.to_bytes()?;
        if bytes.len() != 32 {
            return Err(VotingError::RlpUnexpectedLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(bytes);
        Ok(out)
    }

    pub fn to_u128(&self) -> Result<u128, VotingError> {
        let bytes = self.to_bytes()?;
        if bytes.len() > 16 {
            return Err(VotingError::RlpValueTooLarge);
        }
        if bytes.is_empty() {
            return Ok(0);
        }
        if bytes[0] == 0 {
            return Err(VotingError::NonCanonicalRlp);
        }
        let mut acc = 0u128;
        for &b in bytes {
            acc = (acc << 8) | (b as u128);
        }
        Ok(acc)
    }

    pub fn to_u64(&self) -> Result<u64, VotingError> {
        let val = self.to_u128()?;
        u64::try_from(val).map_err(|_| VotingError::RlpValueTooLarge)
    }
}

fn decode_offset_and_len(slice: &[u8]) -> Result<(usize, usize, bool), VotingError> {
    if slice.is_empty() {
        return Err(VotingError::InvalidRlpEncoding);
    }
    let b0 = slice[0];
    if b0 < STRING_SHORT_START {
        Ok((0, 1, false))
    } else if b0 < STRING_LONG_START {
        let len = (b0 - STRING_SHORT_START) as usize;
        if 1 + len > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        if len == 1 && slice[1] < STRING_SHORT_START {
            return Err(VotingError::NonCanonicalRlp);
        }
        Ok((1, len, false))
    } else if b0 < LIST_SHORT_START {
        let len_of_len = (b0 - STRING_LONG_START + 1) as usize;
        let offset = 1 + len_of_len;
        if offset > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        let len = read_canonical_len(&slice[1..offset])?;
        if offset + len > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        Ok((offset, len, false))
    } else if b0 < LIST_LONG_START {
        let len = (b0 - LIST_SHORT_START) as usize;
        if 1 + len > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        Ok((1, len, true))
    } else {
        let len_of_len = (b0 - LIST_LONG_START + 1) as usize;
        let offset = 1 + len_of_len;
        if offset > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        let len = read_canonical_len(&slice[1..offset])?;
        if offset + len > slice.len() {
            return Err(VotingError::InvalidRlpEncoding);
        }
        Ok((offset, len, true))
    }
}

fn read_canonical_len(len_bytes: &[u8]) -> Result<usize, VotingError> {
    if len_bytes.is_empty() || len_bytes.len() > 8 {
        return Err(VotingError::InvalidRlpEncoding);
    }
    if len_bytes[0] == 0 {
        return Err(VotingError::NonCanonicalRlp);
    }
    let mut acc = 0usize;
    for &b in len_bytes {
        acc = acc
            .checked_shl(8)
            .and_then(|v| v.checked_add(b as usize))
            .ok_or(VotingError::RlpValueTooLarge)?;
    }
    if acc <= SHORT_PAYLOAD_MAX {
        return Err(VotingError::NonCanonicalRlp);
    }
    Ok(acc)
}

// -----------------------------------------------------------------------------
// Canonical RLP Encoders (for proof fixture generation & cross-layer vectors)
// -----------------------------------------------------------------------------

pub fn encode_bytes(data: &[u8]) -> Vec<u8> {
    if data.len() == 1 && data[0] < 0x80 {
        return vec![data[0]];
    }
    if data.len() <= SHORT_PAYLOAD_MAX {
        let mut out = Vec::with_capacity(1 + data.len());
        out.push(STRING_SHORT_START + (data.len() as u8));
        out.extend_from_slice(data);
        return out;
    }
    let len_bytes = to_minimal_be_usize(data.len());
    let mut out = Vec::with_capacity(1 + len_bytes.len() + data.len());
    out.push(0xb7 + (len_bytes.len() as u8));
    out.extend_from_slice(&len_bytes);
    out.extend_from_slice(data);
    out
}

pub fn encode_u128(val: u128) -> Vec<u8> {
    if val == 0 {
        return vec![0x80];
    }
    let be = val.to_be_bytes();
    let first_non_zero = be.iter().position(|&b| b != 0).unwrap_or(be.len());
    encode_bytes(&be[first_non_zero..])
}

pub fn encode_list(encoded_items: &[Vec<u8>]) -> Vec<u8> {
    let total_payload: usize = encoded_items.iter().map(|i| i.len()).sum();
    let mut out = Vec::new();
    if total_payload <= SHORT_PAYLOAD_MAX {
        out.push(LIST_SHORT_START + (total_payload as u8));
    } else {
        let len_bytes = to_minimal_be_usize(total_payload);
        out.push(0xf7 + (len_bytes.len() as u8));
        out.extend_from_slice(&len_bytes);
    }
    for item in encoded_items {
        out.extend_from_slice(item);
    }
    out
}

/// Builds a canonical 20-field Cancun/Pectra RLP execution block header and its `keccak256` block hash.
pub fn build_execution_header(
    block_number: u64,
    state_root: &[u8; 32],
    timestamp: u64,
    parent_beacon_block_root: &[u8; 32],
) -> (Vec<u8>, [u8; 32]) {
    let mut fee_recipient = [0u8; 20];
    fee_recipient[18] = 0x0f;
    fee_recipient[19] = 0xee;

    let fields = vec![
        encode_bytes(&keccak256(b"parent_hash")),
        encode_bytes(&keccak256(b"ommers_hash")),
        encode_bytes(&fee_recipient),
        encode_bytes(state_root),
        encode_bytes(&keccak256(b"tx_root")),
        encode_bytes(&keccak256(b"receipts_root")),
        encode_bytes(&[0u8; 256]),
        encode_u128(0),
        encode_u128(block_number as u128),
        encode_u128(30_000_000),
        encode_u128(15_000_000),
        encode_u128(timestamp as u128),
        encode_bytes(b"therdal-snapshot"),
        encode_bytes(&keccak256(b"prev_randao")),
        encode_bytes(&[0u8; 8]),
        encode_u128(10_000_000_000),
        encode_bytes(&keccak256(b"withdrawals_root")),
        encode_u128(0),
        encode_u128(0),
        encode_bytes(parent_beacon_block_root),
    ];

    let rlp_header = encode_list(&fields);
    let block_hash = keccak256(&rlp_header);
    (rlp_header, block_hash)
}

fn to_minimal_be_usize(val: usize) -> Vec<u8> {
    let be = (val as u64).to_be_bytes();
    let first = be.iter().position(|&b| b != 0).unwrap_or(be.len() - 1);
    be[first..].to_vec()
}
