use crate::error::TopicError;
use crate::types::{
    MAX_OPTIONS, MAX_OPTION_BYTES, MAX_SUBJECT_BYTES, MIN_OPTIONS, TOPIC_DOMAIN_TAG,
};
use sha3::{Digest, Keccak256};

/// Computes the 32-byte Keccak-256 hash of `data`.
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Parses a 20-byte Ethereum hex address (`0x` optional).
pub fn parse_eth_address(input: &str) -> Result<[u8; 20], TopicError> {
    let clean = input.strip_prefix("0x").unwrap_or(input);
    let bytes = hex::decode(clean).map_err(|e| TopicError::InvalidAddress {
        input: input.to_string(),
        reason: e.to_string(),
    })?;
    if bytes.len() != 20 {
        return Err(TopicError::InvalidAddress {
            input: input.to_string(),
            reason: format!("expected 20 bytes, got {}", bytes.len()),
        });
    }
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&bytes);
    Ok(addr)
}

/// Validates `subject`, `options`, and `voting_ends_at` against `current_timestamp`,
/// returning the canonical 32-byte cross-layer `content_hash`.
pub fn validate_and_hash(
    subject: &str,
    options: &[String],
    voting_ends_at: u64,
    current_timestamp: u64,
) -> Result<[u8; 32], TopicError> {
    validate_subject(subject)?;
    validate_options(options)?;
    validate_voting_window(voting_ends_at, current_timestamp)?;
    Ok(compute_content_hash(subject, options, voting_ends_at))
}

/// Validates `subject` matching `TopicValidation.validateSubject` in Solidity.
pub fn validate_subject(subject: &str) -> Result<(), TopicError> {
    let raw = subject.as_bytes();
    if raw.is_empty() {
        return Err(TopicError::EmptySubject);
    }
    if raw.len() > MAX_SUBJECT_BYTES {
        return Err(TopicError::SubjectTooLong {
            byte_length: raw.len(),
            max_bytes: MAX_SUBJECT_BYTES,
        });
    }
    if trim_ascii_whitespace(raw).is_empty() {
        return Err(TopicError::EmptySubject);
    }
    Ok(())
}

/// Validates `options` matching `TopicValidation.validateOptions` in Solidity.
pub fn validate_options(options: &[String]) -> Result<(), TopicError> {
    let count = options.len();
    if !(MIN_OPTIONS..=MAX_OPTIONS).contains(&count) {
        return Err(TopicError::InvalidOptionCount {
            count,
            min_options: MIN_OPTIONS,
            max_options: MAX_OPTIONS,
        });
    }

    let mut trimmed_hashes: Vec<[u8; 32]> = Vec::with_capacity(count);

    for (i, option) in options.iter().enumerate() {
        let raw = option.as_bytes();
        if raw.is_empty() {
            return Err(TopicError::EmptyOption { option_index: i });
        }
        if raw.len() > MAX_OPTION_BYTES {
            return Err(TopicError::OptionTooLong {
                option_index: i,
                byte_length: raw.len(),
                max_bytes: MAX_OPTION_BYTES,
            });
        }

        let trimmed = trim_ascii_whitespace(raw);
        if trimmed.is_empty() {
            return Err(TopicError::EmptyOption { option_index: i });
        }

        let trimmed_hash = keccak256(trimmed);
        if let Some(first_index) = trimmed_hashes.iter().position(|h| *h == trimmed_hash) {
            return Err(TopicError::DuplicateOption {
                first_index,
                duplicate_index: i,
            });
        }
        trimmed_hashes.push(trimmed_hash);
    }

    Ok(())
}

/// Validates `voting_ends_at > current_timestamp` matching `TopicValidation.validateVotingWindow`.
pub fn validate_voting_window(
    voting_ends_at: u64,
    current_timestamp: u64,
) -> Result<(), TopicError> {
    if voting_ends_at <= current_timestamp {
        return Err(TopicError::InvalidVotingEndTime {
            voting_ends_at,
            current_timestamp,
        });
    }
    Ok(())
}

/// Computes the canonical 32-byte cross-layer commitment matching `TopicValidation.computeContentHash`:
/// `keccak256("THERDAL_TOPIC_V1" || keccak256(subject) || uint64_be(options.len()) || keccak256(option_hashes) || uint64_be(voting_ends_at))`
pub fn compute_content_hash(subject: &str, options: &[String], voting_ends_at: u64) -> [u8; 32] {
    let subject_hash = keccak256(subject.as_bytes());

    let mut packed_opt_hashes = Vec::with_capacity(options.len() * 32);
    for opt in options {
        packed_opt_hashes.extend_from_slice(&keccak256(opt.as_bytes()));
    }
    let options_hash = keccak256(&packed_opt_hashes);

    let mut preimage = Vec::with_capacity(96);
    preimage.extend_from_slice(TOPIC_DOMAIN_TAG);
    preimage.extend_from_slice(&subject_hash);
    preimage.extend_from_slice(&(options.len() as u64).to_be_bytes());
    preimage.extend_from_slice(&options_hash);
    preimage.extend_from_slice(&voting_ends_at.to_be_bytes());

    keccak256(&preimage)
}

fn trim_ascii_whitespace(raw: &[u8]) -> &[u8] {
    let mut start = 0;
    let mut end = raw.len();
    while start < end && is_ascii_whitespace(raw[start]) {
        start += 1;
    }
    while end > start && is_ascii_whitespace(raw[end - 1]) {
        end -= 1;
    }
    &raw[start..end]
}

const fn is_ascii_whitespace(ch: u8) -> bool {
    matches!(ch, b' ' | b'\t' | b'\n' | b'\r')
}
