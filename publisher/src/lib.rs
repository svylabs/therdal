use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use therdal_archive::{ArchivedBatch, BlobArchive};
use therdal_circuits::blob_binding::{SignedVote, encode_votes_into_blobs};
use therdal_circuits::snapshot_eligibility::verify_vote_signature;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedBatchPublication {
    pub resolution_id: u64,
    pub batch_id: u64,
    pub submitter: [u8; 20],
    pub blob_count: u8,
    pub commitment_root: [u8; 32],
    pub blob_versioned_hashes: Vec<[u8; 32]>,
    pub accepted_votes: usize,
}

/// Authorized publisher / aggregator service that collects signed votes, validates signatures,
/// encodes canonical EIP-4844 blobs, and archives them for permissionless provers.
#[derive(Debug, Default)]
pub struct BatchPublisher {
    pending_votes: Vec<SignedVote>,
}

impl BatchPublisher {
    pub fn new() -> Self {
        Self {
            pending_votes: Vec::new(),
        }
    }

    /// Validates a signed vote's EIP-712 signature and canonical structure before queueing it for publication.
    pub fn submit_signed_vote(&mut self, vote: SignedVote) -> Result<()> {
        verify_vote_signature(&vote).context("invalid vote signature")?;
        vote.encode_canonical()
            .context("non-canonical vote encoding")?;
        self.pending_votes.push(vote);
        Ok(())
    }

    pub fn pending_count(&self) -> usize {
        self.pending_votes.len()
    }

    /// Packs all queued votes for `resolution_id` into EIP-4844 blobs, stores them in `archive`,
    /// and returns the publication summary ready for `Therdal.publishBatch`.
    pub fn publish_next_batch(
        &mut self,
        resolution_id: u64,
        batch_id: u64,
        submitter: [u8; 20],
        archive: &mut BlobArchive,
    ) -> Result<(PreparedBatchPublication, ArchivedBatch)> {
        let votes: Vec<SignedVote> = self.pending_votes.drain(..).collect();
        if votes.is_empty() {
            anyhow::bail!("no pending votes to publish");
        }

        let blobs = encode_votes_into_blobs(resolution_id, batch_id, &votes)
            .context("failed to pack votes into EIP-4844 blobs")?;
        let blob_count = u8::try_from(blobs.len()).context("blob count overflow")?;
        let blob_versioned_hashes: Vec<[u8; 32]> =
            blobs.iter().map(|b| b.versioned_hash).collect();

        let archived = archive.store_batch(resolution_id, batch_id, submitter, blobs)?;

        let summary = PreparedBatchPublication {
            resolution_id,
            batch_id,
            submitter,
            blob_count,
            commitment_root: archived.commitment_root,
            blob_versioned_hashes,
            accepted_votes: votes.len(),
        };

        Ok((summary, archived))
    }
}
