use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use k256::ecdsa::SigningKey;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use therdal_archive::BlobArchive;
use therdal_circuits::blob_binding::{
    BlobBindingWitness, BYTES_PER_BLOB, PositionClaim, SignedVote, compute_versioned_hash,
};
use therdal_circuits::snapshot_eligibility::{
    ValidatorEligibilityWitness, WalletEligibilityWitness, build_validator_ssz_tree,
    build_wallet_merkle_tree, sign_vote, signing_key_to_address,
};
use therdal_prover::BatchProver;
use therdal_publisher::BatchPublisher;

#[derive(Parser)]
#[command(
    name = "therdal-cli",
    version = "0.2.0",
    about = "Therdal Protocol v0.2 CLI — Permissionless EIP-4844 Blobs, Non-Sequential STARK Proving & 25/25/50 USDC Fee Splitting"
)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Run a complete v0.2 end-to-end simulation: $100 USDC creation ($10 dev + $90 escrow),
    /// permissionless submitters (including a malformed spam batch), non-sequential batch proving,
    /// 25/25/50 USDC fee splitting, and pro-rata pull refunds.
    DemoE2e {
        #[arg(long)]
        output_json: Option<PathBuf>,
    },
    /// Sign an off-chain EIP-712 vote envelope and print or save the canonical JSON.
    SignVote {
        #[arg(long)]
        private_key: String,
        #[arg(long, default_value_t = 1)]
        resolution_id: u64,
        #[arg(long, default_value_t = 1)]
        chain_id: u64,
        #[arg(long)]
        choice: u8,
        #[arg(long, default_value_t = 2_000_000_000)]
        deadline: u64,
        #[arg(long)]
        validator_indices: Vec<u64>,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Permissionlessly pack one or more signed vote JSON files into an archived EIP-4844 batch.
    PublishBatch {
        #[arg(long, default_value_t = 1)]
        resolution_id: u64,
        #[arg(long, default_value_t = 0)]
        batch_id: u64,
        #[arg(long)]
        archive_dir: PathBuf,
        #[arg(long, required = true)]
        vote_files: Vec<PathBuf>,
    },
}

fn parse_hex_32(s: &str) -> Result<[u8; 32]> {
    let trimmed = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(trimmed).context("invalid hex string")?;
    anyhow::ensure!(bytes.len() == 32, "expected 32 bytes, got {}", bytes.len());
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn format_eth(wei: u128) -> String {
    let eth = wei / 1_000_000_000_000_000_000;
    let rem = (wei % 1_000_000_000_000_000_000) / 1_000_000_000_000_000;
    format!("{}.{:03} ETH", eth, rem)
}

fn format_usdc(micros: u128) -> String {
    let dollars = micros / 1_000_000;
    let cents = micros % 1_000_000;
    format!("${}.{:06} USDC", dollars, cents)
}

fn run_demo_e2e(output_json: Option<PathBuf>) -> Result<()> {
    println!("================================================================================");
    println!("  Therdal Protocol v0.2 — Non-Sequential Proving & 25/25/50 USDC Fee Simulation");
    println!("================================================================================");

    let chain_id = 1u64;
    let resolution_id = 1u64;
    let ruleset_version = 1u32;
    let snapshot_block = 21_000_000u64;
    let snapshot_epoch = 320_000u64;
    let voting_ends_at = 1_900_000_000u64;

    // v0.2 Pricing from TherdalController: $0.01 USDC per newly accepted vote (10,000 micro-USDC)
    let price_per_vote_usdc_micros: u128 = 10_000;
    let creation_fee_usdc: u128 = 10_000_000; // $10.00 nonrefundable to TherdalController
    let creator_escrow_usdc: u128 = 90_000_000; // $90.00 refundable escrow basis
    let sponsor_escrow_usdc: u128 = 60_000_000; // $60.00 additional sponsor (100% escrow)
    let total_escrow_c = creator_escrow_usdc + sponsor_escrow_usdc; // $150.00 USDC

    println!(
        "[1] Resolution #{} Created (Pinned Block: #{}, Beacon Epoch: {})",
        resolution_id, snapshot_block, snapshot_epoch
    );
    println!(
        "    Deposits -> Creator: $100.00 ($10.00 Dev Fee to Controller + $90.00 Escrow) | Sponsor: $60.00 Escrow"
    );
    println!(
        "    Frozen Price: $0.010000 USDC / vote ($10 / 1,000 votes) | Split: 25% Dev / 25% Submitter / 50% Prover"
    );

    let sk_alice = SigningKey::from_bytes(&[0x11u8; 32].into()).unwrap();
    let sk_bob = SigningKey::from_bytes(&[0x22u8; 32].into()).unwrap();
    let sk_carol = SigningKey::from_bytes(&[0x33u8; 32].into()).unwrap();

    let addr_alice = signing_key_to_address(&sk_alice);
    let addr_bob = signing_key_to_address(&sk_bob);
    let addr_carol = signing_key_to_address(&sk_carol);

    let (snapshot_execution_root, wallet_list) = build_wallet_merkle_tree(vec![
        WalletEligibilityWitness {
            account: addr_alice,
            balance_wei: 120_000_000_000_000_000_000,
            merkle_branch: vec![],
            leaf_index: 0,
        },
        WalletEligibilityWitness {
            account: addr_bob,
            balance_wei: 85_000_000_000_000_000_000,
            merkle_branch: vec![],
            leaf_index: 1,
        },
        WalletEligibilityWitness {
            account: addr_carol,
            balance_wei: 40_000_000_000_000_000_000,
            merkle_branch: vec![],
            leaf_index: 2,
        },
    ]);

    let mut wc_alice = [0u8; 32];
    wc_alice[0] = 0x01;
    wc_alice[12..32].copy_from_slice(&addr_alice);

    let mut wc_bob = [0u8; 32];
    wc_bob[0] = 0x02;
    wc_bob[12..32].copy_from_slice(&addr_bob);

    let (snapshot_beacon_root, val_list) = build_validator_ssz_tree(vec![
        ValidatorEligibilityWitness {
            validator_index: 101,
            pubkey_root: [0xA1u8; 32],
            withdrawal_credentials: wc_alice,
            effective_balance_gwei: 32_000_000_000,
            slashed: false,
            activation_eligibility_epoch: 100,
            activation_epoch: 100,
            exit_epoch: 999_999,
            withdrawable_epoch: 999_999,
            ssz_branch: vec![],
            ssz_leaf_index: 0,
        },
        ValidatorEligibilityWitness {
            validator_index: 202,
            pubkey_root: [0xB2u8; 32],
            withdrawal_credentials: wc_bob,
            effective_balance_gwei: 64_000_000_000,
            slashed: false,
            activation_eligibility_epoch: 100,
            activation_epoch: 100,
            exit_epoch: 999_999,
            withdrawable_epoch: 999_999,
            ssz_branch: vec![],
            ssz_leaf_index: 1,
        },
    ]);

    println!(
        "[2] Snapshot Roots Authenticated:\n    Execution Root: 0x{}\n    Beacon Root:    0x{}",
        hex::encode(snapshot_execution_root),
        hex::encode(snapshot_beacon_root)
    );

    let mut wallet_map = BTreeMap::new();
    for w in wallet_list {
        wallet_map.insert(w.account, w);
    }
    let mut val_map = BTreeMap::new();
    for v in val_list {
        val_map.insert(v.validator_index, v);
    }

    let mut archive = BlobArchive::new_in_memory();

    // Batch #0: Permissionless spam submitter registers a malformed blob (unprovable, gets $0!)
    let spam_commitment = vec![0xDEu8; 48];
    let spam_vh = compute_versioned_hash(&spam_commitment);
    archive.store_batch(
        resolution_id,
        0,
        [0xBAu8; 20],
        vec![BlobBindingWitness {
            raw_blob: vec![0xFFu8; BYTES_PER_BLOB],
            kzg_commitment: spam_commitment,
            versioned_hash: spam_vh,
            evaluation_challenge: [0u8; 32],
            evaluation_claim: [0u8; 32],
        }],
    )?;
    println!("[3] Batch #0 Published by Spam Submitter (Malformed blob -> bypassed, $0 paid)");

    // Batch #1 (Submitter A): Carol votes ABSTAIN (40 ETH, 1 position, 1 accepted vote)
    //                         + Alice duplicate wallet claim
    let mut pub_a = BatchPublisher::new();
    let vote_carol = sign_vote(
        &sk_carol,
        resolution_id,
        chain_id,
        2,
        [0x03u8; 32],
        voting_ends_at + 1000,
        vec![PositionClaim::wallet(addr_carol)],
    );
    let vote_alice_dup = sign_vote(
        &sk_alice,
        resolution_id,
        chain_id,
        1,
        [0x04u8; 32],
        voting_ends_at + 1000,
        vec![PositionClaim::wallet(addr_alice)],
    );
    pub_a.submit_signed_vote(vote_carol)?;
    pub_a.submit_signed_vote(vote_alice_dup)?;
    let (pub1_meta, _) = pub_a.publish_next_batch(resolution_id, 1, [0xA1u8; 20], &mut archive)?;
    println!(
        "[4] Batch #1 Published Permissionlessly by Submitter A (commitmentRoot: 0x{})",
        hex::encode(pub1_meta.commitment_root)
    );

    // Batch #2 (Submitter B): Alice votes YES (Wallet + Validator #101 = 2 positions, 1 accepted vote)
    //                         Bob votes NO (Wallet + Validator #202 = 2 positions, 1 accepted vote)
    let mut pub_b = BatchPublisher::new();
    let vote_alice = sign_vote(
        &sk_alice,
        resolution_id,
        chain_id,
        0,
        [0x01u8; 32],
        voting_ends_at + 1000,
        vec![
            PositionClaim::wallet(addr_alice),
            PositionClaim::validator(101),
        ],
    );
    let vote_bob = sign_vote(
        &sk_bob,
        resolution_id,
        chain_id,
        1,
        [0x02u8; 32],
        voting_ends_at + 1000,
        vec![PositionClaim::wallet(addr_bob), PositionClaim::validator(202)],
    );
    pub_b.submit_signed_vote(vote_alice)?;
    pub_b.submit_signed_vote(vote_bob)?;
    let (pub2_meta, _) = pub_b.publish_next_batch(resolution_id, 2, [0xB2u8; 20], &mut archive)?;
    println!(
        "[5] Batch #2 Published Permissionlessly by Submitter B (commitmentRoot: 0x{})",
        hex::encode(pub2_meta.commitment_root)
    );

    // NON-SEQUENTIAL PROVING: Prove Batch #2 FIRST, then Batch #1 SECOND (bypassing malformed Batch #0)!
    let mut prover = BatchProver::default();
    let settled2 = prover.prove_batch(
        &archive,
        chain_id,
        resolution_id,
        2,
        ruleset_version,
        snapshot_epoch,
        voting_ends_at,
        snapshot_execution_root,
        snapshot_beacon_root,
        wallet_map.clone(),
        val_map.clone(),
        price_per_vote_usdc_micros,
    )?;

    println!(
        "[6] Non-Sequentially Proved & Settled Batch #2 FIRST:\n    Positions Counted: +{} | Accepted Votes: +{}\n    New SMT Root:      0x{}\n    Proof Tag:         0x{}\n    25/25/50 Split ->  Dev: {} | Submitter B: {} | Prover: {}",
        settled2.newly_counted_positions,
        settled2.newly_accepted_vote_count,
        hex::encode(settled2.public_inputs.new_position_root),
        hex::encode(&settled2.proof_bytes),
        format_usdc(settled2.developer_share_usdc_micros),
        format_usdc(settled2.submitter_share_usdc_micros),
        format_usdc(settled2.prover_share_usdc_micros),
    );

    let settled1 = prover.prove_batch(
        &archive,
        chain_id,
        resolution_id,
        1,
        ruleset_version,
        snapshot_epoch,
        voting_ends_at,
        snapshot_execution_root,
        snapshot_beacon_root,
        wallet_map,
        val_map,
        price_per_vote_usdc_micros,
    )?;

    println!(
        "[7] Non-Sequentially Proved & Settled Batch #1 SECOND:\n    Positions Counted: +{} (Skipped Duplicates: {}) | Accepted Votes: +{}\n    New SMT Root:      0x{}\n    Proof Tag:         0x{}\n    25/25/50 Split ->  Dev: {} | Submitter A: {} | Prover: {}",
        settled1.newly_counted_positions,
        settled1.skipped_duplicate_positions,
        settled1.newly_accepted_vote_count,
        hex::encode(settled1.public_inputs.new_position_root),
        hex::encode(&settled1.proof_bytes),
        format_usdc(settled1.developer_share_usdc_micros),
        format_usdc(settled1.submitter_share_usdc_micros),
        format_usdc(settled1.prover_share_usdc_micros),
    );

    let total_accepted_votes =
        settled2.newly_accepted_vote_count + settled1.newly_accepted_vote_count;
    let total_fees_spent = (total_accepted_votes as u128) * price_per_vote_usdc_micros;
    let unused_escrow_u = total_escrow_c - total_fees_spent;
    let creator_refund = (unused_escrow_u * creator_escrow_usdc) / total_escrow_c;
    let sponsor_refund = (unused_escrow_u * sponsor_escrow_usdc) / total_escrow_c;
    let dev_total = creation_fee_usdc
        + settled2.developer_share_usdc_micros
        + settled1.developer_share_usdc_micros;

    let final_tallies = settled1.public_inputs.new_tallies;
    println!("--------------------------------------------------------------------------------");
    println!("  FINAL v0.2 RESOLUTION RESULTS & SOLVENCY SUMMARY");
    println!("  - YES:     {}", format_eth(final_tallies[0]));
    println!("  - NO:      {}", format_eth(final_tallies[1]));
    println!("  - ABSTAIN: {}", format_eth(final_tallies[2]));
    println!(
        "  - Unique Counted Positions: {} | Accepted Valid Votes: {}",
        settled1.public_inputs.new_counted_positions, total_accepted_votes
    );
    println!(
        "  - Controller (Developer) Total Earned: {} ($10 creation + 25% of settled)",
        format_usdc(dev_total)
    );
    println!(
        "  - Unused Escrow Frozen (U): {} -> Pro-Rata Refunds: Creator {}, Sponsor {}",
        format_usdc(unused_escrow_u),
        format_usdc(creator_refund),
        format_usdc(sponsor_refund)
    );
    println!("================================================================================");

    if let Some(out_path) = output_json {
        let report = serde_json::json!({
            "resolution_id": resolution_id,
            "batches_settled_order": [settled2, settled1],
        });
        fs::write(&out_path, serde_json::to_string_pretty(&report)?)?;
    }

    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::DemoE2e { output_json } => run_demo_e2e(output_json),
        Commands::SignVote {
            private_key,
            resolution_id,
            chain_id,
            choice,
            deadline,
            validator_indices,
            out,
        } => {
            let sk_bytes = parse_hex_32(&private_key)?;
            let sk = SigningKey::from_bytes(&sk_bytes.into())
                .context("invalid secp256k1 private key")?;
            let signer = signing_key_to_address(&sk);
            let mut claims = vec![PositionClaim::wallet(signer)];
            for idx in validator_indices {
                claims.push(PositionClaim::validator(idx));
            }
            let nonce = therdal_circuits::keccak256(&signer);
            let vote = sign_vote(&sk, resolution_id, chain_id, choice, nonce, deadline, claims);
            let json = serde_json::to_string_pretty(&vote)?;
            if let Some(path) = out {
                fs::write(&path, &json)?;
                println!("Signed vote written to {:?}", path);
            } else {
                println!("{}", json);
            }
            Ok(())
        }
        Commands::PublishBatch {
            resolution_id,
            batch_id,
            archive_dir,
            vote_files,
        } => {
            let mut archive = BlobArchive::with_directory(&archive_dir)?;
            let mut publisher = BatchPublisher::new();
            for vf in vote_files {
                let raw = fs::read_to_string(&vf)?;
                let vote: SignedVote = serde_json::from_str(&raw)?;
                publisher.submit_signed_vote(vote)?;
            }
            let (summary, _) =
                publisher.publish_next_batch(resolution_id, batch_id, [0x11u8; 20], &mut archive)?;
            println!("{}", serde_json::to_string_pretty(&summary)?);
            Ok(())
        }
    }
}
