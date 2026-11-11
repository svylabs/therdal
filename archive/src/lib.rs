use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use therdal_circuits::blob_binding::{BlobBindingWitness, compute_batch_commitment_root};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchivedBatch {
    pub resolution_id: u64,
    pub batch_id: u64,
    pub submitter: [u8; 20],
    pub commitment_root: [u8; 32],
    pub blobs: Vec<BlobBindingWitness>,
}

/// Content-addressed and batch-indexed store for EIP-4844 blobs.
#[derive(Debug, Default, Clone)]
pub struct BlobArchive {
    batches: BTreeMap<(u64, u64), ArchivedBatch>,
    by_versioned_hash: BTreeMap<[u8; 32], BlobBindingWitness>,
    storage_dir: Option<PathBuf>,
}

impl BlobArchive {
    pub fn new_in_memory() -> Self {
        Self::default()
    }

    pub fn with_directory(dir: impl AsRef<Path>) -> Result<Self> {
        let path = dir.as_ref().to_path_buf();
        fs::create_dir_all(&path).context("failed to create archive directory")?;
        Ok(Self {
            batches: BTreeMap::new(),
            by_versioned_hash: BTreeMap::new(),
            storage_dir: Some(path),
        })
    }

    pub fn store_batch(
        &mut self,
        resolution_id: u64,
        batch_id: u64,
        submitter: [u8; 20],
        blobs: Vec<BlobBindingWitness>,
    ) -> Result<ArchivedBatch> {
        let vhashes: Vec<[u8; 32]> = blobs.iter().map(|b| b.versioned_hash).collect();
        let commitment_root = compute_batch_commitment_root(&vhashes);

        for b in &blobs {
            self.by_versioned_hash.insert(b.versioned_hash, b.clone());
        }

        let archived = ArchivedBatch {
            resolution_id,
            batch_id,
            submitter,
            commitment_root,
            blobs,
        };

        if let Some(dir) = &self.storage_dir {
            let file_path = dir.join(format!("res_{}_batch_{}.json", resolution_id, batch_id));
            let json = serde_json::to_string_pretty(&archived)?;
            fs::write(&file_path, json)?;
        }

        self.batches.insert((resolution_id, batch_id), archived.clone());
        Ok(archived)
    }

    pub fn get_batch(&self, resolution_id: u64, batch_id: u64) -> Result<ArchivedBatch> {
        if let Some(b) = self.batches.get(&(resolution_id, batch_id)) {
            return Ok(b.clone());
        }
        if let Some(dir) = &self.storage_dir {
            let file_path = dir.join(format!("res_{}_batch_{}.json", resolution_id, batch_id));
            let data = fs::read_to_string(&file_path).with_context(|| {
                format!(
                    "archived batch ({}, {}) not found at {:?}",
                    resolution_id, batch_id, file_path
                )
            })?;
            let batch: ArchivedBatch = serde_json::from_str(&data)?;
            return Ok(batch);
        }
        anyhow::bail!("batch ({}, {}) not found in archive", resolution_id, batch_id)
    }

    pub fn get_blob_by_versioned_hash(&self, vh: &[u8; 32]) -> Option<&BlobBindingWitness> {
        self.by_versioned_hash.get(vh)
    }
}
