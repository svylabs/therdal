use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::fs;
use std::path::PathBuf;
use therdal_topics::{
    ChainClock, CreateTopicRequest, JsonFileTopicStore, SystemChainClock, TopicRegistryService,
    TopicView, compute_content_hash, keccak256, parse_eth_address, validate_options,
    validate_subject,
};
use therdal_voting::{
    BeaconSnapshotAuthProof, DirectVoteProofBundle, DirectVotingService, JsonFileVoteStore,
    TopicTallyView, ValidatorFixtureInput, ValidatorStakeProof, build_execution_header,
    build_single_account_trie, build_single_validator_beacon_fixture,
    compounding_withdrawal_credentials, compute_validator_position_key, compute_wallet_position_key,
    eth1_withdrawal_credentials, parse_bytes32, parse_hex_bytes,
};

#[derive(Parser)]
#[command(
    name = "therdal-cli",
    version = "0.2.0",
    about = "Therdal Protocol CLI — Stage 1 Topic Creation & Stage 2 Direct Snapshot Voting (Execution ETH & Beacon Stake Proofs)"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Register a new topic ($0 creation fee; optional initial USDC sponsorship goes 100% to pool).
    CreateTopic {
        /// Topic subject / referendum question (1..=512 UTF-8 bytes)
        #[arg(long)]
        subject: String,

        /// Free-text voting options (pass --option at least twice, up to 16 unique options)
        #[arg(long = "option", required = true)]
        options: Vec<String>,

        /// Unix timestamp (seconds) when voting ends (must be > current time)
        #[arg(long)]
        voting_ends_at: u64,

        /// Optional initial USDC sponsorship in 6-decimal micro-USDC (e.g. 100000000 = $100.00; default 0)
        #[arg(long, default_value_t = 0)]
        initial_sponsorship_usdc: u128,

        /// Creator 20-byte Ethereum address
        #[arg(long, default_value = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A")]
        creator: String,

        /// Optional explicit parent snapshot block hash (`0x...`, e.g. matching a proof fixture)
        #[arg(long)]
        snapshot_block_hash: Option<String>,

        /// Path to local JSON topic store
        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        /// Output machine-readable JSON
        #[arg(long)]
        json: bool,
    },

    /// Add optional USDC sponsorship (100% to pool, $0 fee) to an Open topic.
    SponsorTopic {
        #[arg(long)]
        topic_id: u64,

        /// Sponsorship amount in 6-decimal micro-USDC (e.g. 50000000 = $50.00)
        #[arg(long)]
        amount_usdc: u128,

        #[arg(long, default_value = "0x1563915e194D8CfBA1943570603F7606A3115508")]
        sponsor: String,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Cast a direct vote ($0 fee) using an EIP-1186 MPT proof of Execution Layer ETH held at snapshot time.
    VoteExecution {
        #[arg(long)]
        topic_id: u64,

        #[arg(long)]
        option_index: u32,

        #[arg(long)]
        voter: String,

        /// Hex-encoded RLP execution block header (`0x...`, omit or pass empty if already authenticated)
        #[arg(long, default_value = "")]
        rlp_header: String,

        /// Hex-encoded RLP list of EIP-1186 MPT account proof nodes (`0x...`)
        #[arg(long)]
        rlp_account_proof: String,

        #[arg(long, default_value_t = 1)]
        chain_id: u64,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long, default_value = ".therdal-votes.json")]
        vote_store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Cast a direct vote ($0 fee) from a JSON proof bundle (Execution MPT proof, Beacon SSZ stake proofs, or both).
    VoteDirect {
        #[arg(long)]
        topic_id: u64,

        #[arg(long)]
        option_index: u32,

        #[arg(long)]
        voter: String,

        /// Path to JSON-serialized `DirectVoteProofBundle`
        #[arg(long)]
        proof_file: PathBuf,

        #[arg(long, default_value_t = 1)]
        chain_id: u64,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long, default_value = ".therdal-votes.json")]
        vote_store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Generate a deterministic Execution MPT + Beacon SSZ direct-vote proof fixture JSON for testing or local runs.
    GenerateProofFixture {
        #[arg(long, default_value = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A")]
        voter: String,

        /// Snapshot block number (defaults to 21,499,999 = default CLI block - 1)
        #[arg(long, default_value_t = 21_499_999)]
        snapshot_block: u64,

        /// Snapshot Execution wallet balance in wei (0 disables execution claim)
        #[arg(long, default_value_t = 10_000_000_000_000_000_000)]
        wallet_balance_wei: u128,

        /// Optional validator index to include a Beacon Chain SSZ stake proof
        #[arg(long)]
        validator_index: Option<u64>,

        /// Validator effective balance in Gwei (e.g. 32_000_000_000 = 32 ETH, 2_048_000_000_000 = 2048 ETH)
        #[arg(long, default_value_t = 32_000_000_000)]
        validator_effective_gwei: u64,

        /// Use 0x02 Pectra compounding withdrawal credentials instead of 0x01
        #[arg(long)]
        compounding: bool,

        /// Write bundle JSON to file (prints fixture metadata + snapshotBlockHash to stdout)
        #[arg(long)]
        output: PathBuf,
    },

    /// Inspect live ETH-weighted option tallies, counted positions, and snapshot authentication status.
    Tallies {
        #[arg(long)]
        topic_id: u64,

        #[arg(long, default_value_t = 1)]
        chain_id: u64,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long, default_value = ".therdal-votes.json")]
        vote_store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Deterministically compute a canonical `THERDAL_WALLET` or `THERDAL_VALIDATOR` position key offline.
    PositionKey {
        #[arg(long, default_value_t = 1)]
        chain_id: u64,

        /// Compute wallet position key for 20-byte Ethereum address (`0x...`)
        #[arg(long, conflicts_with = "validator_index")]
        wallet: Option<String>,

        /// Compute validator position key for 64-bit Beacon validator index
        #[arg(long, conflicts_with = "wallet")]
        validator_index: Option<u64>,
    },

    /// List all registered topics and their live phase (`Open` / `Closed`).
    ListTopics {
        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Inspect a single topic by its 1-indexed ID.
    GetTopic {
        #[arg(long)]
        topic_id: u64,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long)]
        json: bool,
    },

    /// Deterministically compute the canonical cross-layer `contentHash` (`THERDAL_TOPIC_V1`) offline.
    HashTopic {
        #[arg(long)]
        subject: String,

        #[arg(long = "option", required = true)]
        options: Vec<String>,

        #[arg(long)]
        voting_ends_at: u64,
    },
}

fn format_usdc(micros: u128) -> String {
    let dollars = micros / 1_000_000;
    let cents = (micros % 1_000_000) / 10_000;
    format!("${dollars}.{cents:02} USDC ({micros} micro-USDC)")
}

fn format_eth_wei(wei: u128) -> String {
    let whole = wei / 1_000_000_000_000_000_000;
    let frac_gwei = (wei % 1_000_000_000_000_000_000) / 1_000_000_000_000_000; // 3 decimal places
    format!("{whole}.{frac_gwei:03} ETH ({wei} wei)")
}

fn print_topic_human(topic: &TopicView) {
    println!("================================================================================");
    println!("  Topic #{}  [{:?}]", topic.id, topic.phase);
    println!("================================================================================");
    println!("  Subject:          {}", topic.subject);
    println!("  Options ({}):", topic.options.len());
    for (idx, opt) in topic.options.iter().enumerate() {
        println!("    [{idx}] {opt}");
    }
    println!("  Creator:          {}", topic.creator);
    println!("  Created At:       {} (unix)", topic.created_at);
    println!("  Voting Ends At:   {} (unix)", topic.voting_ends_at);
    println!(
        "  Pinned Snapshot:  Block #{} ({})",
        topic.snapshot_block, topic.snapshot_block_hash
    );
    println!("  Content Hash:     {}", topic.content_hash);
    println!(
        "  Sponsored Pool:   {} ($0 creation fee)",
        format_usdc(topic.total_sponsored_usdc_micros)
    );
    println!("================================================================================");
}

fn print_tallies_human(tally: &TopicTallyView) {
    println!("================================================================================");
    println!(
        "  Topic #{} Tallies  [{:?}]  (Direct Votes: {}, Unique Positions: {})",
        tally.topic_id, tally.phase, tally.direct_vote_count, tally.total_counted_positions
    );
    println!("================================================================================");
    println!("  Subject:          {}", tally.subject);
    println!(
        "  Pinned Snapshot:  Block #{} ({})",
        tally.snapshot_block, tally.snapshot_block_hash
    );
    println!(
        "  EL State Root:    {}",
        tally
            .snapshot_execution_root
            .as_deref()
            .unwrap_or("unauthenticated")
    );
    println!(
        "  CL State Root:    {} (epoch {})",
        tally
            .snapshot_beacon_root
            .as_deref()
            .unwrap_or("unauthenticated"),
        tally.snapshot_epoch
    );
    println!("  Total Weight:     {}", format_eth_wei(tally.total_weight_wei));
    println!("--------------------------------------------------------------------------------");
    for (idx, label) in tally.options.iter().enumerate() {
        let w = tally.option_weights_wei[idx];
        let cnt = tally.option_position_counts[idx];
        let pct = if tally.total_weight_wei > 0 {
            ((w as f64) * 100.0) / (tally.total_weight_wei as f64)
        } else {
            0.0
        };
        println!(
            "    [{idx}] {label:<28} {:>6.2}%  |  {}  ({cnt} pos)",
            pct,
            format_eth_wei(w)
        );
    }
    println!("================================================================================");
}

fn build_fixture_bundle(
    voter_addr: &[u8; 20],
    snapshot_block: u64,
    wallet_balance_wei: u128,
    validator_index: Option<u64>,
    validator_effective_gwei: u64,
    compounding: bool,
) -> ([u8; 32], DirectVoteProofBundle) {
    let effective_wallet = if wallet_balance_wei > 0 {
        wallet_balance_wei
    } else {
        1_000_000_000_000_000_000
    };
    let (state_root, account_proof) = build_single_account_trie(voter_addr, 1, effective_wallet);
    let (rlp_header, snapshot_block_hash) =
        build_execution_header(snapshot_block, &state_root, 1_760_000_000, &[0u8; 32]);

    let (beacon_root_hex, beacon_auth, validator_proofs) = if let Some(v_idx) = validator_index {
        let creds = if compounding {
            compounding_withdrawal_credentials(voter_addr)
        } else {
            eth1_withdrawal_credentials(voter_addr)
        };
        let vf = ValidatorFixtureInput {
            validator_index: v_idx,
            pubkey_root: keccak256(format!("cli_validator_{v_idx}").as_bytes()),
            withdrawal_credentials: creds,
            effective_balance_gwei: validator_effective_gwei,
            slashed: false,
            activation_eligibility_epoch: 100_000,
            activation_epoch: 100_010,
            exit_epoch: u64::MAX,
            withdrawable_epoch: u64::MAX,
        };
        let built = build_single_validator_beacon_fixture(
            &snapshot_block_hash,
            10_240_000,
            1_760_000_012,
            v_idx.saturating_add(100),
            &vf,
            false,
        );
        let hex_vec = |arr: &[[u8; 32]]| {
            arr.iter()
                .map(|h| format!("0x{}", hex::encode(h)))
                .collect::<Vec<_>>()
        };
        (
            Some(format!("0x{}", hex::encode(built.beacon_block_root))),
            Some(BeaconSnapshotAuthProof {
                child_block_timestamp: built.child_block_timestamp,
                beacon_slot: built.beacon_slot,
                slot_branch: hex_vec(&built.slot_branch),
                beacon_state_root: format!("0x{}", hex::encode(built.beacon_state_root)),
                state_root_branch: hex_vec(&built.state_root_branch),
                execution_hash_branch: hex_vec(&built.execution_hash_branch),
            }),
            vec![ValidatorStakeProof {
                validator_index: v_idx,
                pubkey_root: format!("0x{}", hex::encode(vf.pubkey_root)),
                withdrawal_credentials: format!("0x{}", hex::encode(vf.withdrawal_credentials)),
                effective_balance_gwei: validator_effective_gwei,
                slashed: false,
                activation_eligibility_epoch: vf.activation_eligibility_epoch,
                activation_epoch: vf.activation_epoch,
                exit_epoch: vf.exit_epoch,
                withdrawable_epoch: vf.withdrawable_epoch,
                validator_branch: hex_vec(&built.validator_branch),
                validators_length_chunk: format!("0x{}", hex::encode(built.validators_length_chunk)),
                beacon_state_branch: hex_vec(&built.beacon_state_branch),
            }],
        )
    } else {
        (None, None, Vec::new())
    };

    let bundle = DirectVoteProofBundle {
        include_execution_balance: wallet_balance_wei > 0,
        rlp_execution_header_hex: if wallet_balance_wei > 0 {
            format!("0x{}", hex::encode(rlp_header))
        } else {
            String::new()
        },
        rlp_account_proof_nodes_hex: if wallet_balance_wei > 0 {
            format!("0x{}", hex::encode(account_proof))
        } else {
            String::new()
        },
        beacon_block_root_hex: beacon_root_hex,
        beacon_auth,
        validator_proofs,
    };

    (snapshot_block_hash, bundle)
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::CreateTopic {
            subject,
            options,
            voting_ends_at,
            initial_sponsorship_usdc,
            creator,
            snapshot_block_hash,
            store,
            json,
        } => {
            let creator_addr = parse_eth_address(&creator).context("invalid --creator address")?;
            let clock = SystemChainClock::default();
            let mut svc = TopicRegistryService::new(clock, JsonFileTopicStore::new(store));
            let req = CreateTopicRequest {
                creator: creator_addr,
                subject,
                options,
                voting_ends_at,
                initial_sponsorship_usdc_micros: initial_sponsorship_usdc,
            };
            let created = if let Some(hash_hex) = snapshot_block_hash {
                let pinned_hash =
                    parse_bytes32(&hash_hex).context("invalid --snapshot-block-hash")?;
                let snap_block = clock.current_block_number().saturating_sub(1);
                svc.create_topic_with_pinned_snapshot(req, snap_block, pinned_hash)?
            } else {
                svc.create_topic(req)?
            };

            if json {
                println!("{}", serde_json::to_string_pretty(&created)?);
            } else {
                print_topic_human(&created);
            }
            Ok(())
        }

        Commands::SponsorTopic {
            topic_id,
            amount_usdc,
            sponsor,
            store,
            json,
        } => {
            let sponsor_addr = parse_eth_address(&sponsor).context("invalid --sponsor address")?;
            let mut svc =
                TopicRegistryService::new(SystemChainClock::default(), JsonFileTopicStore::new(store));
            let updated = svc.sponsor_topic(topic_id, sponsor_addr, amount_usdc)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&updated)?);
            } else {
                print_topic_human(&updated);
            }
            Ok(())
        }

        Commands::VoteExecution {
            topic_id,
            option_index,
            voter,
            rlp_header,
            rlp_account_proof,
            chain_id,
            store,
            vote_store,
            json,
        } => {
            let voter_addr = parse_eth_address(&voter).context("invalid --voter address")?;
            let header_bytes = if rlp_header.trim().is_empty() {
                Vec::new()
            } else {
                parse_hex_bytes(&rlp_header).context("invalid --rlp-header hex")?
            };
            let proof_bytes =
                parse_hex_bytes(&rlp_account_proof).context("invalid --rlp-account-proof hex")?;

            let mut voting = DirectVotingService::new(
                chain_id,
                SystemChainClock::default(),
                JsonFileTopicStore::new(store),
                JsonFileVoteStore::new(vote_store),
            );
            voting.vote_with_execution_balance(
                topic_id,
                option_index,
                voter_addr,
                &header_bytes,
                &proof_bytes,
            )?;
            let tallies = voting.get_topic_tallies(topic_id)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&tallies)?);
            } else {
                print_tallies_human(&tallies);
            }
            Ok(())
        }

        Commands::VoteDirect {
            topic_id,
            option_index,
            voter,
            proof_file,
            chain_id,
            store,
            vote_store,
            json,
        } => {
            let voter_addr = parse_eth_address(&voter).context("invalid --voter address")?;
            let raw = fs::read_to_string(&proof_file)
                .with_context(|| format!("failed reading {:?}", proof_file))?;
            let bundle: DirectVoteProofBundle =
                serde_json::from_str(&raw).context("invalid DirectVoteProofBundle JSON")?;

            let mut voting = DirectVotingService::new(
                chain_id,
                SystemChainClock::default(),
                JsonFileTopicStore::new(store),
                JsonFileVoteStore::new(vote_store),
            );
            voting.vote_direct(topic_id, option_index, voter_addr, &bundle)?;
            let tallies = voting.get_topic_tallies(topic_id)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&tallies)?);
            } else {
                print_tallies_human(&tallies);
            }
            Ok(())
        }

        Commands::GenerateProofFixture {
            voter,
            snapshot_block,
            wallet_balance_wei,
            validator_index,
            validator_effective_gwei,
            compounding,
            output,
        } => {
            let voter_addr = parse_eth_address(&voter).context("invalid --voter address")?;
            let (snapshot_block_hash, bundle) = build_fixture_bundle(
                &voter_addr,
                snapshot_block,
                wallet_balance_wei,
                validator_index,
                validator_effective_gwei,
                compounding,
            );
            fs::write(&output, serde_json::to_string_pretty(&bundle)?)
                .with_context(|| format!("failed writing {:?}", output))?;
            println!(
                "{}",
                serde_json::to_string_pretty(&serde_json::json!({
                    "output_file": output,
                    "voter": format!("0x{}", hex::encode(voter_addr)),
                    "snapshot_block": snapshot_block,
                    "snapshot_block_hash": format!("0x{}", hex::encode(snapshot_block_hash)),
                    "include_execution_balance": bundle.include_execution_balance,
                    "validator_count": bundle.validator_proofs.len(),
                }))?
            );
            Ok(())
        }

        Commands::Tallies {
            topic_id,
            chain_id,
            store,
            vote_store,
            json,
        } => {
            let voting = DirectVotingService::new(
                chain_id,
                SystemChainClock::default(),
                JsonFileTopicStore::new(store),
                JsonFileVoteStore::new(vote_store),
            );
            let tallies = voting.get_topic_tallies(topic_id)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&tallies)?);
            } else {
                print_tallies_human(&tallies);
            }
            Ok(())
        }

        Commands::PositionKey {
            chain_id,
            wallet,
            validator_index,
        } => {
            if let Some(addr_str) = wallet {
                let addr = parse_eth_address(&addr_str).context("invalid --wallet address")?;
                let key = compute_wallet_position_key(chain_id, &addr);
                println!("0x{}", hex::encode(key));
            } else if let Some(v_idx) = validator_index {
                let key = compute_validator_position_key(chain_id, v_idx);
                println!("0x{}", hex::encode(key));
            } else {
                anyhow::bail!("Specify either --wallet <0x...> or --validator-index <u64>");
            }
            Ok(())
        }

        Commands::ListTopics { store, json } => {
            let svc =
                TopicRegistryService::new(SystemChainClock::default(), JsonFileTopicStore::new(store));
            let topics = svc.list_topics()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&topics)?);
            } else if topics.is_empty() {
                println!("No topics registered yet.");
            } else {
                for t in &topics {
                    print_topic_human(t);
                }
            }
            Ok(())
        }

        Commands::GetTopic {
            topic_id,
            store,
            json,
        } => {
            let svc =
                TopicRegistryService::new(SystemChainClock::default(), JsonFileTopicStore::new(store));
            let topic = svc.get_topic(topic_id)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&topic)?);
            } else {
                print_topic_human(&topic);
            }
            Ok(())
        }

        Commands::HashTopic {
            subject,
            options,
            voting_ends_at,
        } => {
            validate_subject(&subject)?;
            validate_options(&options)?;
            let digest = compute_content_hash(&subject, &options, voting_ends_at);
            println!("0x{}", hex::encode(digest));
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use therdal_topics::{FixedChainClock, InMemoryTopicStore};
    use therdal_voting::InMemoryVoteStore;

    #[test]
    fn test_cli_fixture_generation_and_end_to_end_direct_vote() {
        let alice = parse_eth_address("0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A").unwrap();
        let (snap_hash, bundle) = build_fixture_bundle(
            &alice,
            21_499_999,
            15_000_000_000_000_000_000,
            Some(42),
            32_000_000_000,
            true,
        );

        let clock = FixedChainClock {
            timestamp: 1_760_000_000,
            block_number: 21_500_000,
        };
        let mut reg = TopicRegistryService::new(clock, InMemoryTopicStore::default());
        reg.create_topic_with_pinned_snapshot(
            CreateTopicRequest {
                creator: alice,
                subject: "End-to-end CLI fixture check?".to_string(),
                options: vec!["Approve".to_string(), "Reject".to_string()],
                voting_ends_at: 1_760_086_400,
                initial_sponsorship_usdc_micros: 0,
            },
            21_499_999,
            snap_hash,
        )
        .unwrap();

        let mut voting = DirectVotingService::new(1, clock, reg.store, InMemoryVoteStore::default());
        let total = voting.vote_direct(1, 0, alice, &bundle).unwrap();
        assert_eq!(total, 47_000_000_000_000_000_000); // 15 ETH wallet + 32 ETH validator
    }
}
