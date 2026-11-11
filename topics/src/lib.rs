pub mod error;
pub mod registry;
pub mod types;
pub mod validation;

pub use error::TopicError;
pub use registry::{
    ChainClock, FixedChainClock, InMemoryTopicStore, JsonFileTopicStore, SystemChainClock,
    TopicRegistryService, TopicStore,
};
pub use types::{
    CreateTopicRequest, DEFAULT_PRICE_PER_VOTE_USDC_MICROS, MAX_OPTION_BYTES, MAX_OPTIONS,
    MAX_SUBJECT_BYTES, MIN_OPTIONS, TOPIC_DOMAIN_TAG, TopicPhase, TopicRecord, TopicView,
};
pub use validation::{
    compute_content_hash, keccak256, parse_eth_address, validate_and_hash, validate_options,
    validate_subject, validate_voting_window,
};

#[cfg(test)]
mod tests {
    use super::*;

    const INITIAL_TS: u64 = 1_760_000_000;
    const INITIAL_BLOCK: u64 = 21_500_000;

    fn sample_service() -> TopicRegistryService<FixedChainClock, InMemoryTopicStore> {
        TopicRegistryService::new(
            FixedChainClock {
                timestamp: INITIAL_TS,
                block_number: INITIAL_BLOCK,
            },
            InMemoryTopicStore::default(),
        )
    }

    #[test]
    fn test_cross_layer_canonical_content_hash_matches_solidity() {
        // Must match `test_CrossLayerCanonicalTopicContentHashVector` in `test/contracts/TopicCreation.t.sol`
        let subject = "Should Ethereum increase the blob target from 6 to 12?";
        let options = vec![
            "12 Blobs".to_string(),
            "9 Blobs".to_string(),
            "Keep at 6 Blobs".to_string(),
        ];
        let voting_ends_at = 1_800_000_000u64;

        let digest = compute_content_hash(subject, &options, voting_ends_at);
        assert_eq!(
            format!("0x{}", hex::encode(digest)),
            "0x9c2f31b24a86bb08a454e2566c47308d9fef016662c6e369a5323230572aa02d"
        );
    }

    #[test]
    fn test_create_topic_free_and_with_optional_sponsorship() {
        let mut svc = sample_service();
        let alice = [0x11u8; 20];
        let bob = [0x22u8; 20];

        // 1. Free topic creation ($0 sponsorship, $0 fee)
        let free_topic = svc
            .create_topic(CreateTopicRequest {
                creator: alice,
                subject: "Should Ethereum raise the Pectra blob target?".to_string(),
                options: vec![
                    "Increase to 12 Blobs".to_string(),
                    "Increase to 9 Blobs".to_string(),
                    "Keep at 6 Blobs".to_string(),
                ],
                voting_ends_at: INITIAL_TS + 86_400,
                initial_sponsorship_usdc_micros: 0,
            })
            .unwrap();

        assert_eq!(free_topic.id, 1);
        assert_eq!(free_topic.snapshot_block, INITIAL_BLOCK - 1);
        assert_eq!(free_topic.total_sponsored_usdc_micros, 0);
        assert_eq!(free_topic.phase, TopicPhase::Open);

        // 2. Sponsored topic creation ($100 USDC = 100_000_000 micros) + community top-up ($50 USDC)
        let sponsored = svc
            .create_topic(CreateTopicRequest {
                creator: alice,
                subject: "What L1 gas limit should validators target?".to_string(),
                options: vec![
                    "60M Gas".to_string(),
                    "45M Gas".to_string(),
                    "36M Gas".to_string(),
                    "No Change".to_string(),
                ],
                voting_ends_at: INITIAL_TS + 604_800,
                initial_sponsorship_usdc_micros: 100_000_000,
            })
            .unwrap();

        assert_eq!(sponsored.id, 2);
        assert_eq!(sponsored.total_sponsored_usdc_micros, 100_000_000);

        let topped_up = svc.sponsor_topic(2, bob, 50_000_000).unwrap();
        assert_eq!(topped_up.total_sponsored_usdc_micros, 150_000_000);
        assert_eq!(topped_up.remaining_escrow_usdc_micros, 150_000_000);
    }

    #[test]
    fn test_subject_and_options_validation_boundaries() {
        // Empty & whitespace subject
        assert_eq!(validate_subject(""), Err(TopicError::EmptySubject));
        assert_eq!(validate_subject("  \t\n\r "), Err(TopicError::EmptySubject));

        // 512 bytes ok, 513 bytes rejected
        assert!(validate_subject(&"A".repeat(MAX_SUBJECT_BYTES)).is_ok());
        assert_eq!(
            validate_subject(&"A".repeat(MAX_SUBJECT_BYTES + 1)),
            Err(TopicError::SubjectTooLong {
                byte_length: MAX_SUBJECT_BYTES + 1,
                max_bytes: MAX_SUBJECT_BYTES,
            })
        );

        // Option counts: 0, 1 fail; 2..=16 ok; 17 fails
        assert_eq!(
            validate_options(&[]),
            Err(TopicError::InvalidOptionCount {
                count: 0,
                min_options: MIN_OPTIONS,
                max_options: MAX_OPTIONS,
            })
        );
        assert_eq!(
            validate_options(&["Only".to_string()]),
            Err(TopicError::InvalidOptionCount {
                count: 1,
                min_options: MIN_OPTIONS,
                max_options: MAX_OPTIONS,
            })
        );

        let sixteen: Vec<String> = (0..16).map(|i| format!("Option {i}")).collect();
        assert!(validate_options(&sixteen).is_ok());

        let seventeen: Vec<String> = (0..17).map(|i| format!("Option {i}")).collect();
        assert_eq!(
            validate_options(&seventeen),
            Err(TopicError::InvalidOptionCount {
                count: 17,
                min_options: MIN_OPTIONS,
                max_options: MAX_OPTIONS,
            })
        );

        // Empty / whitespace option & 256/257 byte boundary
        assert_eq!(
            validate_options(&["Yes".to_string(), "   \n ".to_string()]),
            Err(TopicError::EmptyOption { option_index: 1 })
        );
        assert!(validate_options(&["B".repeat(MAX_OPTION_BYTES), "Other".to_string()]).is_ok());
        assert_eq!(
            validate_options(&["Other".to_string(), "C".repeat(MAX_OPTION_BYTES + 1)]),
            Err(TopicError::OptionTooLong {
                option_index: 1,
                byte_length: MAX_OPTION_BYTES + 1,
                max_bytes: MAX_OPTION_BYTES,
            })
        );

        // Trimmed duplicate rejection matches Solidity
        assert_eq!(
            validate_options(&[
                "12 Blobs".to_string(),
                "9 Blobs".to_string(),
                "  12 Blobs\n".to_string()
            ]),
            Err(TopicError::DuplicateOption {
                first_index: 0,
                duplicate_index: 2,
            })
        );
    }

    #[test]
    fn test_voting_end_time_and_closed_sponsorship_rejection() {
        let mut svc = sample_service();
        let alice = [0xAAu8; 20];

        // Past or equal timestamp fails
        assert_eq!(
            svc.create_topic(CreateTopicRequest {
                creator: alice,
                subject: "Valid?".to_string(),
                options: vec!["Yes".to_string(), "No".to_string()],
                voting_ends_at: INITIAL_TS,
                initial_sponsorship_usdc_micros: 0,
            }),
            Err(TopicError::InvalidVotingEndTime {
                voting_ends_at: INITIAL_TS,
                current_timestamp: INITIAL_TS,
            })
        );

        // Create valid topic ending in 60s, then advance clock past voting_ends_at
        svc.create_topic(CreateTopicRequest {
            creator: alice,
            subject: "Short poll?".to_string(),
            options: vec!["Approve".to_string(), "Reject".to_string()],
            voting_ends_at: INITIAL_TS + 60,
            initial_sponsorship_usdc_micros: 0,
        })
        .unwrap();

        svc.clock.timestamp = INITIAL_TS + 61;
        let closed_view = svc.get_topic(1).unwrap();
        assert_eq!(closed_view.phase, TopicPhase::Closed);

        assert_eq!(
            svc.sponsor_topic(1, alice, 1_000_000),
            Err(TopicError::InvalidTopicPhase {
                current: TopicPhase::Closed,
                expected: TopicPhase::Open,
            })
        );
    }
}
