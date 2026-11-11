# Therdal Protocol v0.1 — Full Workspace Overhaul & Implementation Plan

## Feature Summary

This feature implements a complete, clean-room overhaul of the **Therdal Protocol (v0.1)** from scratch across the entire repository (`/Users/sg/Documents/workspace/svylabs/therdal`), encompassing:

1. **Protocol Specifications & Threat Model (`docs/`)**:
   - `decisions.md`: Finalized engineering choices for all 10 open questions in Section 13.
   - `threat-model.md`: Security boundaries, publisher censorship surface, liveness recovery, and post-quantum scope.
   - `blob-format.md`: Versioned canonical binary encoding (`THERDAL_BLOB_V1`) mapped to EIP-4844 BLS12-381 scalar field elements and KZG-to-STARK equivalence binding.
   - `snapshot-and-stake.md`: Pinning `snapshotBlockNumber` and `snapshotBeaconSlot` at resolution creation, authenticating `snapshotExecutionRoot` (via `BLOCKHASH` / EIP-2935) and `snapshotBeaconRoot` (via EIP-4788 + SSZ Merkle branches) during settlement/proving, and verifying execution wallet balances and beacon validator stakes.
   - `proof-public-inputs.md`: Canonical public input layout and binding rules between `Therdal.sol`, `StarkVerifierAdapter.sol`, and the Rust prover.
   - `economics.md`: Dual per-vote sponsorship reward model (`submissionFeePerVote` and `provingFeePerVote`) configured in the main contract, where batch submitters (publishers) and provers are paid **only after** a batch is proven and settled on-chain, strictly proportional to the newly counted eligible votes/positions in that batch.

2. **Solidity On-Chain Contracts (`contracts/` & `test/`)**:
   - `BatchRegistry.sol`: Manages ordered EIP-4844 blob commitment registrations (`publishBatch(resolutionId, blobCount)`), reading `blobhash(i)` in the blob-carrying transaction, computing `commitmentRoot`, emitting individual versioned hashes, and freezing batch count upon publication cutoff.
   - `SponsorEscrow.sol`: Holds ETH sponsorships per resolution, tracks `submissionFeePerVote` and `provingFeePerVote`, and atomically disburses earned submission rewards (to the batch submitter) and proving rewards (to the batch prover) upon batch settlement for the `newlyCountedPositions = newCountedPositions - oldCountedPositions` proven in that batch, with reentrancy protection and unspent refund/recovery support.
   - `StarkVerifierAdapter.sol`: Pinned, versioned verifier adapter (`vkey` / program identifier) validating the canonical public inputs struct and delegating to the STARK/zkVM verifier (with a clearly separated test verifier for local/integration testing).
   - `Therdal.sol`: Core protocol contract implementing `ITherdal`:
     - `createResolution`: Pins `snapshotBlockNumber`, `snapshotBeaconSlot` / `beaconChildTimestamp`, `votingStartsAt`, `votingEndsAt`, `settlementDeadline`, `publisher`, `rulesetVersion`, `submissionFeePerVote`, and `provingFeePerVote`, plus optional initial ETH sponsorship.
     - `authenticateSnapshot`: Authenticates and pins `snapshotExecutionRoot` and `snapshotBeaconRoot` on-chain against `BLOCKHASH`/EIP-2935 and EIP-4788 using RLP execution header and SSZ beacon proofs before or during settlement.
     - `publishBatch`: Registers current transaction's EIP-4844 blob versioned hashes during the `Open` window.
     - `settleBatch`: Permissionless sequential batch settlement (`batchId == nextBatchToSettle`) during the `Settling` phase (`block.timestamp > votingEndsAt`). Reads old state (`positionRoot`, `tallies[3]`, `countedPositions`) from storage, binds public inputs to the registered `commitmentRoot`, authenticated snapshot roots, and ruleset, verifies the STARK proof, updates state atomically, and pays both the batch submitter (`newlyCounted * submissionFeePerVote`) and the prover (`newlyCounted * provingFeePerVote`).
     - `finalizeResolution` & `markExpired`: Transitions to `Finalized` when all batches are settled (`nextBatchToSettle == nextBatchId`), or handles recovery if `settlementDeadline` expires.
   - Direct on-chain voting is explicitly disabled in v1 per Section 8 to preserve unified SMT position uniqueness.

3. **Rust Workspace (`circuits/`, `publisher/`, `prover/`, `archive/`, `cli/`)**:
   - `circuits/` (`therdal-circuits`):
     - `blob_binding`: Canonical `THERDAL_BLOB_V1` binary encoder/decoder, 31-byte-per-field-element EIP-4844 blob packing, versioned hash computation, and Fiat-Shamir barycentric evaluation equivalence binding.
     - `snapshot_eligibility`: Execution account balance verification, beacon validator stake & withdrawal-credential authorization (`0x01`/`0x02`), and EIP-712 vote signature verification (`secp256k1` / `k256`).
     - `batch_transition`: 256-bit Sparse Merkle Tree (`SMT`) with domain-separated keys (`THERDAL_WALLET` and `THERDAL_VALIDATOR`), deterministic first-valid-claim-wins conflict resolution across positions and batches, overflow-safe `uint256[3]` tally accumulation (`Yes`, `No`, `Abstain`), and canonical public input hashing matching `Therdal.sol`.
   - `publisher/` (`therdal-publisher`): Collects signed `Vote` envelopes, validates formatting, packs votes into canonical EIP-4844 blobs, and prepares `publishBatch` transactions.
   - `archive/` (`therdal-archive`): Content-addressed local/file store indexed by `(resolutionId, batchId, versionedHash)` to persist blob payloads beyond Ethereum's 18-day EIP-4844 retention window.
   - `prover/` (`therdal-prover`): Permissionless prover engine that retrieves archived blobs for `nextBatchToSettle`, reconstructs the batch witness (votes, snapshot proofs, SMT paths), executes `batch_transition`, and generates the settlement proof and calldata for `settleBatch`.
   - `cli/` (`therdal-cli`): End-to-end command-line tool (`create-resolution`, `sign-vote`, `publish-batch`, `archive-inspect`, `prove-batch`, `verify-batch`, `demo-e2e`) to test the full protocol pipeline and generate deterministic test vectors.

4. **TypeScript SDK & Frontend Application (`sdk/` & `frontend/`)**:
   - `sdk/`: TypeScript library for EIP-712 vote signing (`Vote` envelope with `PositionRef[]`), resolution state reading, blob encoding preview, and contract interaction helpers.
   - `frontend/`: Interactive web application allowing users to browse resolutions and lifecycle phases, create & sponsor resolutions (configuring `submissionFeePerVote` and `provingFeePerVote`), sign gasless ETH-weighted votes (`Yes` / `No` / `Abstain`) with wallet + validator positions, inspect registered EIP-4844 batches & prover settlement status, and audit final tallies and participation metrics.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              Therdal Protocol v0.1                                   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  [Voter] ──(EIP-712 Signed Vote)──► [Publisher] ──(EIP-4844 Blobs)──► [Therdal.sol]  │
│                                          │                                  │        │
│                                          ▼                                  ▼        │
│                                   [Blob Archive]                   [BatchRegistry]   │
│                                          │                                  │        │
│                                          ▼                                  │        │
│                                  [Rust Prover CLI] ◄────────────────────────┘        │
│                                   - blob_binding                                     │
│                                   - snapshot_eligibility                             │
│                                   - batch_transition (SMT)                           │
│                                          │                                           │
│                                          ▼ (settleBatch + proof)                     │
│                                    [Therdal.sol]                                     │
│                         ┌────────────────┼────────────────┐                          │
│                         ▼                ▼                ▼                          │
│              [Snapshot Auth]   [StarkVerifierAdapter]  [SponsorEscrow]               │
│              (EIP-2935/4788)   (Public Inputs + Proof)  - Submitter Fee / Vote       │
│                                                         - Prover Fee / Vote          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Protocol Lifecycle & Fee Mechanics
1. **Creation (`Created` -> `Open`)**:
   - Creator specifies immutable resolution parameters, pinned `snapshotBlockNumber` and `snapshotBeaconSlot`, authorized `publisher`, `submissionFeePerVote`, and `provingFeePerVote`.
   - Creator and external sponsors fund the resolution's escrow pool via `sponsor(resolutionId)`.
2. **Publication (`Open`)**:
   - Voters sign off-chain EIP-712 `Vote` messages claiming execution wallet (`THERDAL_WALLET`) and/or validator (`THERDAL_VALIDATOR`) positions.
   - Authorized publisher packs signed votes into canonical EIP-4844 blobs and calls `publishBatch(resolutionId, blobCount)`.
   - `BatchRegistry` records `BatchRecord { commitmentRoot, submitter, blobCount, settled: false, newlyCountedPositions: 0 }` under sequential `batchId`.
3. **Snapshot Authentication & Settlement (`Closed` -> `Settling`)**:
   - Once `block.timestamp > votingEndsAt`, publication closes and the batch count is frozen.
   - Before or during the first batch settlement, anyone authenticates `snapshotExecutionRoot` (via `BLOCKHASH` or EIP-2935 + RLP header decoding) and `snapshotBeaconRoot` (via EIP-4788 + SSZ Merkle proof) for the pinned snapshot block/slot.
   - Any prover calls `settleBatch(resolutionId, batchId, newPositionRoot, newTallies, newCountedPositions, proof)` for `batchId == nextBatchToSettle`.
   - `Therdal.sol` verifies the proof against the stored `commitmentRoot`, authenticated snapshot roots, and old state (`oldPositionRoot`, `oldTallies`, `oldCountedPositions`).
   - Upon verification, `newlyCounted = newCountedPositions - oldCountedPositions` is computed:
     - Batch submitter receives `min(escrowBalance, newlyCounted * submissionFeePerVote)`.
     - Batch prover (`msg.sender`) receives `min(remainingEscrow, newlyCounted * provingFeePerVote)`.
4. **Finalization (`Finalized` / `Expired`)**:
   - When `nextBatchToSettle == nextBatchId`, `finalizeResolution(resolutionId)` freezes final tallies and allows unused sponsorship funds to be reclaimed if configured, or if `settlementDeadline` passes without completion, `markExpired` enables sponsor recovery.

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Clean up legacy prototype directories and initialize the unified repository layout (`docs/`, `contracts/`, `circuits/`, `publisher/`, `prover/`, `archive/`, `cli/`, `sdk/`, `frontend/`, `test/`) | Complete |
| 2 | Write comprehensive protocol documentation in `docs/` (`decisions.md`, `threat-model.md`, `blob-format.md`, `snapshot-and-stake.md`, `proof-public-inputs.md`, `economics.md`) | Complete |
| 3 | Implement Solidity cryptographic & verification libraries (`RLPReader.sol`, `MerklePatriciaProofVerifier.sol`, `SSZVerifier.sol`, `SparseMerkleTree.sol`, `SnapshotAuthenticator.sol`) in `contracts/libraries/` | Complete |
| 4 | Implement Solidity core contracts (`BatchRegistry.sol`, `SponsorEscrow.sol`, `StarkVerifierAdapter.sol`, `Therdal.sol`) with pinned snapshots and dual per-vote submission & proving fee settlement | Complete |
| 5 | Write Foundry unit, integration, and adversarial test suites in `test/contracts/` and `test/adversarial/`, plus deployment script in `script/DeployTherdal.s.sol` | Complete |
| 6 | Implement Rust `circuits/` crate (`blob_binding`, `snapshot_eligibility`, `batch_transition`) with 256-bit SMT, EIP-712 signature verification, duplicate position handling, and public-input hashing | Complete |
| 7 | Implement Rust `archive/`, `publisher/`, `prover/`, and `cli/` crates for blob packing, content-addressed archival, witness generation, proof creation, and end-to-end CLI testing | Complete |
| 8 | Implement TypeScript `sdk/` and interactive `frontend/` web application for resolution creation, sponsorship, EIP-712 vote signing, batch inspection, and prover settlement | Complete |
| 9 | Run full verification suite (`forge test`, `cargo test`, CLI end-to-end pipeline, and frontend build/verification) and update root `README.md` | Complete |
