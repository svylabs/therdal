pub mod eligibility;
pub mod error;
pub mod mpt;
pub mod rlp;
pub mod sha256;
pub mod ssz;
pub mod tally;

pub use eligibility::{
    BeaconSnapshotAuthProof, GWEI_TO_WEI, VALIDATOR_DOMAIN_TAG, ValidatorStakeProof,
    WALLET_DOMAIN_TAG, WITHDRAWAL_PREFIX_COMPOUNDING, WITHDRAWAL_PREFIX_ETH1,
    authenticate_beacon_snapshot, authenticate_execution_header, compute_validator_position_key,
    compute_wallet_position_key, parse_bytes32, parse_hex_bytes, verify_execution_balance_proof,
    verify_validator_stake_proof,
};
pub use error::VotingError;
pub use mpt::{
    DecodedAccount, build_single_account_trie, build_two_account_trie, decode_account,
    verify_account_proof,
};
pub use rlp::{RlpSlice, build_execution_header, encode_bytes, encode_list, encode_u128};
pub use sha256::{compute_zero_hashes, sha256, sha256_pair};
pub use ssz::{
    BuiltBeaconFixture, SLOTS_PER_EPOCH, VALIDATOR_REGISTRY_DEPTH, VALIDATOR_REGISTRY_LIMIT,
    ValidatorFixtureInput, build_single_validator_beacon_fixture, compounding_withdrawal_credentials,
    compute_validator_root, eth1_withdrawal_credentials, to_bool_chunk, to_le_64_chunk,
    verify_branch, verify_validator_in_beacon_state,
};
pub use tally::{
    DirectVoteProofBundle, DirectVotingService, InMemoryVoteStore, JsonFileVoteStore,
    PositionReceipt, PositionType, TopicTallyView, TopicVoteState, VoteStore,
};

#[cfg(test)]
mod tests {
    use super::*;
    use therdal_topics::{
        CreateTopicRequest, FixedChainClock, InMemoryTopicStore, TopicPhase, TopicRegistryService,
        keccak256, parse_eth_address,
    };

    const INITIAL_TS: u64 = 1_760_000_000;
    const INITIAL_BLOCK: u64 = 21_500_000;
    const SNAPSHOT_BLOCK: u64 = INITIAL_BLOCK - 1;
    const SNAPSHOT_SLOT: u64 = 10_240_000; // Epoch 320,000
    const ETH: u128 = 1_000_000_000_000_000_000;

    fn hex_vec(hashes: &[[u8; 32]]) -> Vec<String> {
        hashes.iter().map(|h| format!("0x{}", hex::encode(h))).collect()
    }

    #[test]
    fn test_fips_sha256_known_vectors() {
        assert_eq!(
            hex::encode(sha256(b"")),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hex::encode(sha256(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn test_cross_layer_canonical_voting_vectors_match_solidity() {
        // Must match `test_CrossLayerCanonicalVotingVectors` in `test/contracts/DirectVoting.t.sol`
        let alice = parse_eth_address("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A").unwrap();

        let wallet_key = compute_wallet_position_key(1, &alice);
        assert_eq!(
            format!("0x{}", hex::encode(wallet_key)),
            "0xfdc983c4a6627025bb1acfb58480db21d43845f0caeddd82415a6190c3fb0ec4"
        );

        let validator_key = compute_validator_position_key(1, 42);
        assert_eq!(
            format!("0x{}", hex::encode(validator_key)),
            "0x55505d5e6780e2e33dce1a71b9bd0ea0afe46418ab1ee55f0fdb4d0e4f312de4"
        );

        let pubkey_root = [0x11u8; 32];
        let withdrawal_creds = eth1_withdrawal_credentials(&alice);
        let validator_root = compute_validator_root(
            &pubkey_root,
            &withdrawal_creds,
            32_000_000_000,
            false,
            100,
            110,
            u64::MAX,
            u64::MAX,
        );
        assert_eq!(
            format!("0x{}", hex::encode(validator_root)),
            "0xd43c10cf2e1a1f61413cf26c8b470a6e2bc223a7cb985b7f025247b20dea6ae0"
        );

        let (mpt_state_root, proof_nodes) = build_single_account_trie(&alice, 5, 25 * ETH);
        assert_eq!(
            format!("0x{}", hex::encode(mpt_state_root)),
            "0x6c964a28f19f91df3af2d04e7dea3d12cb853416b2cab63617302e2b89e45d54"
        );
        let verified_bal =
            verify_execution_balance_proof(&mpt_state_root, &alice, &proof_nodes).unwrap();
        assert_eq!(verified_bal, 25 * ETH);
    }

    #[test]
    fn test_direct_voting_execution_and_beacon_happy_paths() {
        let alice = parse_eth_address("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A").unwrap();
        let bob = parse_eth_address("0x1563915e194D8CfBA1943570603F7606A3115508").unwrap();

        let (state_root, proof_alice, proof_bob) =
            build_two_account_trie(&alice, 12_500_000_000_000_000_000, &bob, 40 * ETH);
        let (rlp_header, snapshot_block_hash) =
            build_execution_header(SNAPSHOT_BLOCK, &state_root, INITIAL_TS - 12, &[0u8; 32]);

        let clock = FixedChainClock {
            timestamp: INITIAL_TS,
            block_number: INITIAL_BLOCK,
        };
        let mut reg = TopicRegistryService::new(clock, InMemoryTopicStore::default());
        reg.create_topic_with_pinned_snapshot(
            CreateTopicRequest {
                creator: alice,
                subject: "Should Ethereum raise the blob target to 12?".to_string(),
                options: vec![
                    "12 Blobs".to_string(),
                    "9 Blobs".to_string(),
                    "Keep 6 Blobs".to_string(),
                ],
                voting_ends_at: INITIAL_TS + 86_400,
                initial_sponsorship_usdc_micros: 0,
            },
            SNAPSHOT_BLOCK,
            snapshot_block_hash,
        )
        .unwrap();

        let val_fixture = ValidatorFixtureInput {
            validator_index: 512_345,
            pubkey_root: keccak256(b"alice_validator_pubkey"),
            withdrawal_credentials: compounding_withdrawal_credentials(&alice),
            effective_balance_gwei: 64_000_000_000, // 64 ETH
            slashed: false,
            activation_eligibility_epoch: 300_000,
            activation_epoch: 300_100,
            exit_epoch: u64::MAX,
            withdrawable_epoch: u64::MAX,
        };
        let built = build_single_validator_beacon_fixture(
            &snapshot_block_hash,
            SNAPSHOT_SLOT,
            INITIAL_TS,
            1_000_000,
            &val_fixture,
            true, // Electra depth-6
        );

        let mut voting = DirectVotingService::new(1, clock, reg.store, InMemoryVoteStore::default());
        voting
            .pin_beacon_block_root(1, &built.beacon_block_root)
            .unwrap();

        // Alice votes with combined execution balance (12.5 ETH) + Electra validator (64 ETH) = 76.5 ETH on option 0
        let alice_total = voting
            .vote_direct(
                1,
                0,
                alice,
                &DirectVoteProofBundle {
                    include_execution_balance: true,
                    rlp_execution_header_hex: format!("0x{}", hex::encode(&rlp_header)),
                    rlp_account_proof_nodes_hex: format!("0x{}", hex::encode(&proof_alice)),
                    beacon_block_root_hex: None,
                    beacon_auth: Some(BeaconSnapshotAuthProof {
                        child_block_timestamp: INITIAL_TS,
                        beacon_slot: built.beacon_slot,
                        slot_branch: hex_vec(&built.slot_branch),
                        beacon_state_root: format!("0x{}", hex::encode(built.beacon_state_root)),
                        state_root_branch: hex_vec(&built.state_root_branch),
                        execution_hash_branch: hex_vec(&built.execution_hash_branch),
                    }),
                    validator_proofs: vec![ValidatorStakeProof {
                        validator_index: val_fixture.validator_index,
                        pubkey_root: format!("0x{}", hex::encode(val_fixture.pubkey_root)),
                        withdrawal_credentials: format!(
                            "0x{}",
                            hex::encode(val_fixture.withdrawal_credentials)
                        ),
                        effective_balance_gwei: val_fixture.effective_balance_gwei,
                        slashed: false,
                        activation_eligibility_epoch: val_fixture.activation_eligibility_epoch,
                        activation_epoch: val_fixture.activation_epoch,
                        exit_epoch: val_fixture.exit_epoch,
                        withdrawable_epoch: val_fixture.withdrawable_epoch,
                        validator_branch: hex_vec(&built.validator_branch),
                        validators_length_chunk: format!(
                            "0x{}",
                            hex::encode(built.validators_length_chunk)
                        ),
                        beacon_state_branch: hex_vec(&built.beacon_state_branch),
                    }],
                },
            )
            .unwrap();

        assert_eq!(alice_total, 76_500_000_000_000_000_000);

        // Bob votes with execution balance (40 ETH) on option 1 using cached execution root (empty header)
        let bob_total = voting
            .vote_with_execution_balance(1, 1, bob, &[], &proof_bob)
            .unwrap();
        assert_eq!(bob_total, 40 * ETH);

        let tallies = voting.get_topic_tallies(1).unwrap();
        assert_eq!(tallies.phase, TopicPhase::Open);
        assert_eq!(tallies.option_weights_wei, vec![76_500_000_000_000_000_000, 40 * ETH, 0]);
        assert_eq!(tallies.option_position_counts, vec![2, 1, 0]);
        assert_eq!(tallies.total_counted_positions, 3);
        assert_eq!(tallies.direct_vote_count, 2);
        assert!(voting.has_wallet_voted(1, &alice).unwrap());
        assert!(voting.has_validator_voted(1, 512_345).unwrap());
    }

    #[test]
    fn test_adversarial_replay_index_substitution_and_malformed_rlp_rejections() {
        let alice = parse_eth_address("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A").unwrap();
        let bob = parse_eth_address("0x1563915e194D8CfBA1943570603F7606A3115508").unwrap();

        let (state_root, proof_alice) = build_single_account_trie(&alice, 1, 10 * ETH);
        let (rlp_header, snapshot_block_hash) =
            build_execution_header(SNAPSHOT_BLOCK, &state_root, INITIAL_TS - 12, &[0u8; 32]);

        let clock = FixedChainClock {
            timestamp: INITIAL_TS,
            block_number: INITIAL_BLOCK,
        };
        let mut reg = TopicRegistryService::new(clock, InMemoryTopicStore::default());
        reg.create_topic_with_pinned_snapshot(
            CreateTopicRequest {
                creator: alice,
                subject: "Adversarial test?".to_string(),
                options: vec!["Yes".to_string(), "No".to_string()],
                voting_ends_at: INITIAL_TS + 3_600,
                initial_sponsorship_usdc_micros: 0,
            },
            SNAPSHOT_BLOCK,
            snapshot_block_hash,
        )
        .unwrap();

        let mut voting = DirectVotingService::new(1, clock, reg.store, InMemoryVoteStore::default());

        // Non-canonical RLP rejected
        assert_eq!(
            voting.vote_with_execution_balance(1, 0, alice, &rlp_header, &[0xc2, 0x81, 0x05]),
            Err(VotingError::NonCanonicalRlp)
        );

        // Wrong signer for MPT proof rejected
        assert_eq!(
            voting.vote_with_execution_balance(1, 0, bob, &rlp_header, &proof_alice),
            Err(VotingError::MptPathMismatch)
        );

        // Valid vote then replay rejected
        voting
            .vote_with_execution_balance(1, 0, alice, &rlp_header, &proof_alice)
            .unwrap();
        assert!(matches!(
            voting.vote_with_execution_balance(1, 1, alice, &[], &proof_alice),
            Err(VotingError::PositionAlreadyVoted { topic_id: 1, .. })
        ));

        // Validator index substitution rejected
        let val_fixture = ValidatorFixtureInput {
            validator_index: 7,
            pubkey_root: keccak256(b"val_7"),
            withdrawal_credentials: eth1_withdrawal_credentials(&alice),
            effective_balance_gwei: 32_000_000_000,
            slashed: false,
            activation_eligibility_epoch: 100,
            activation_epoch: 110,
            exit_epoch: u64::MAX,
            withdrawable_epoch: u64::MAX,
        };
        let built = build_single_validator_beacon_fixture(
            &snapshot_block_hash,
            SNAPSHOT_SLOT,
            INITIAL_TS,
            100,
            &val_fixture,
            false,
        );

        let b_auth = BeaconSnapshotAuthProof {
            child_block_timestamp: INITIAL_TS,
            beacon_slot: built.beacon_slot,
            slot_branch: hex_vec(&built.slot_branch),
            beacon_state_root: format!("0x{}", hex::encode(built.beacon_state_root)),
            state_root_branch: hex_vec(&built.state_root_branch),
            execution_hash_branch: hex_vec(&built.execution_hash_branch),
        };
        let forged_val = ValidatorStakeProof {
            validator_index: 8, // substituted index!
            pubkey_root: format!("0x{}", hex::encode(val_fixture.pubkey_root)),
            withdrawal_credentials: format!("0x{}", hex::encode(val_fixture.withdrawal_credentials)),
            effective_balance_gwei: 32_000_000_000,
            slashed: false,
            activation_eligibility_epoch: 100,
            activation_epoch: 110,
            exit_epoch: u64::MAX,
            withdrawable_epoch: u64::MAX,
            validator_branch: hex_vec(&built.validator_branch),
            validators_length_chunk: format!("0x{}", hex::encode(built.validators_length_chunk)),
            beacon_state_branch: hex_vec(&built.beacon_state_branch),
        };

        assert_eq!(
            voting.vote_with_beacon_stake(
                1,
                0,
                alice,
                Some(&built.beacon_block_root),
                Some(b_auth),
                vec![forged_val]
            ),
            Err(VotingError::InvalidValidatorProof { validator_index: 8 })
        );
    }
}
