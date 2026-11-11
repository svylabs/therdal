use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use therdal_topics::{
    CreateTopicRequest, JsonFileTopicStore, SystemChainClock, TopicRegistryService, TopicView,
    compute_content_hash, parse_eth_address, validate_options, validate_subject,
};

#[derive(Parser)]
#[command(
    name = "therdal-cli",
    version = "0.1.0",
    about = "Therdal Protocol (Stage 1: Topic Creation) CLI — Register free-text subjects, custom options, and voting deadlines"
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
        #[arg(long, default_value = "0x000000000000000000000000000000000000a11c")]
        creator: String,

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

        #[arg(long, default_value = "0x000000000000000000000000000000000000b0b0")]
        sponsor: String,

        #[arg(long, default_value = ".therdal-topics.json")]
        store: PathBuf,

        #[arg(long)]
        json: bool,
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

fn print_topic_human(topic: &TopicView) {
    println!("================================================================================");
    println!(
        "  Topic #{}  [{:?}]",
        topic.id, topic.phase
    );
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

fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::CreateTopic {
            subject,
            options,
            voting_ends_at,
            initial_sponsorship_usdc,
            creator,
            store,
            json,
        } => {
            let creator_addr = parse_eth_address(&creator).context("invalid --creator address")?;
            let mut svc =
                TopicRegistryService::new(SystemChainClock::default(), JsonFileTopicStore::new(store));
            let created = svc.create_topic(CreateTopicRequest {
                creator: creator_addr,
                subject,
                options,
                voting_ends_at,
                initial_sponsorship_usdc_micros: initial_sponsorship_usdc,
            })?;

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
