use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use therdal_archive::BlobArchive;
use therdal_circuits::batch_transition::{
    BatchPublicInputs, BatchWitness, PositionSmt, execute_batch_transition,
};
use therdal_circuits::keccak256;
use therdal_circuits::snapshot_eligibility::{
    ValidatorEligibilityWitness, WalletEligibilityWitness,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenBatchSettlement {
    pub resolution_id: u64,
    pub batch_id: u64,
    pub submitter: [u8; 20],
    pub public_inputs: BatchPublicInputs,
    pub public_inputs_digest: [u8; 32],
    pub proof_bytes: Vec<u8>,
    pub newly_counted_positions: u64,
    pub newly_accepted_vote_count: u64,
    pub skipped_duplicate_positions: u64,
    pub developer_share_usdc_micros: u128,
    pub submitter_share_usdc_micros: u128,
    pub prover_share_usdc_micros: u128,
}

/// Permissionless prover engine supporting non-sequential batch proving (v0.2)
/// and 25% Developer / 25% Submitter / 50% Prover USDC fee calculation.
pub struct BatchProver {
    pub program_vkey: [u8; 32],
    pub smt: PositionSmt,
    pub tallies: [u128; 3],
    pub counted_positions: u64,
}

impl Default for BatchProver {
    fn default() -> Self {
        Self::new(keccak256(b"THERDAL_BATCH_PROGRAM_V2"))
    }
}

impl BatchProver {
    pub fn new(program_vkey: [u8; 32]) -> Self {
        Self {
            program_vkey,
            smt: PositionSmt::new(),
            tallies: [0, 0, 0],
            counted_positions: 0,
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn prove_batch(
        &mut self,
        archive: &BlobArchive,
        chain_id: u64,
        resolution_id: u64,
        batch_id: u64,
        ruleset_version: u32,
        snapshot_epoch: u64,
        voting_ends_at: u64,
        snapshot_execution_root: [u8; 32],
        snapshot_beacon_root: [u8; 32],
        wallet_witnesses: BTreeMap<[u8; 20], WalletEligibilityWitness>,
        validator_witnesses: BTreeMap<u64, ValidatorEligibilityWitness>,
        price_per_vote_usdc_micros: u128,
    ) -> Result<ProvenBatchSettlement> {
        let archived = archive
            .get_batch(resolution_id, batch_id)
            .context("failed to retrieve batch from archive")?;

        let witness = BatchWitness {
            chain_id,
            resolution_id,
            ruleset_version,
            snapshot_epoch,
            voting_ends_at,
            snapshot_execution_root,
            snapshot_beacon_root,
            batch_id,
            registered_batch_commitment: archived.commitment_root,
            blobs: archived.blobs,
            wallet_witnesses,
            validator_witnesses,
        };

        let out = execute_batch_transition(
            self.smt.clone(),
            self.tallies,
            self.counted_positions,
            &witness,
        )
        .context("batch transition failed")?;

        self.smt = out.updated_smt;
        self.tallies = out.public_inputs.new_tallies;
        self.counted_positions = out.public_inputs.new_counted_positions;

        let public_inputs_digest = out.public_inputs.compute_digest();
        let proof_tag = out.public_inputs.compute_proof_tag(&self.program_vkey);

        let total_fee = (out.newly_accepted_vote_count as u128) * price_per_vote_usdc_micros;
        let developer_share_usdc_micros = total_fee / 4; // 25%
        let submitter_share_usdc_micros = total_fee / 4; // 25%
        let prover_share_usdc_micros =
            total_fee - developer_share_usdc_micros - submitter_share_usdc_micros; // 50%

        Ok(ProvenBatchSettlement {
            resolution_id,
            batch_id,
            submitter: archived.submitter,
            public_inputs: out.public_inputs,
            public_inputs_digest,
            proof_bytes: proof_tag.to_vec(),
            newly_counted_positions: out.newly_counted_positions,
            newly_accepted_vote_count: out.newly_accepted_vote_count,
            skipped_duplicate_positions: out.skipped_duplicate_positions,
            developer_share_usdc_micros,
            submitter_share_usdc_micros,
            prover_share_usdc_micros,
        })
    }
}
