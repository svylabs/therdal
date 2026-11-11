# Therdal Protocol v0.2 — Permissionless Publication, Smart-Account Controller & 25/25/50 Stablecoin Fee Splitting

## Feature Summary

Upgrade the **Therdal Protocol** workspace (`docs/`, `contracts/`, `circuits/`, `publisher/`, `prover/`, `archive/`, `cli/`, `sdk/`, `frontend/`, `test/`) from v0.1 to the **v0.2 Engineering Specification**, introducing:

1. **`TherdalController.sol` (Smart-Account Governance & Developer Treasury)**:
   - Smart-account controller contract initially operated by a single signer (`operator`), replaceable at any time with a DAO / Timelock (`transferOperator` / `replaceController`).
   - Acts as the initial **Protocol Developer** fee recipient (`developerRecipient`) and pricing authority:
     - Configures `pricePerVoteUsdMicros` (default `$0.01` = `10,000` micro-USD = `$10` per `1,000` newly accepted valid votes).
     - Configures mandatory creation deposit (`$100` = `$10` nonrefundable creation fee to `developerRecipient` + `$90` into resolution settlement escrow).
     - Manages the allowlist of accepted USD stablecoins (`USDC` with 6 decimals initially, extensible to other USD stablecoins like `USDT`, `DAI`, `PYUSD`, `USDS` with automatic decimal scaling).
     - Supports generic smart-account execution (`execute`) and token withdrawals for protocol treasury management.

2. **Permissionless Blob Publication & Non-Sequential Batch Settlement**:
   - Removes the single authorized publisher restriction: **anyone** can submit EIP-4844 blobs via `publishBatch(resolutionId, blobCount)` during the `Open` window.
   - **Non-Sequential Settlement**: During `Settling`, any prover can settle **any** registered, unsettled `batchId` (`0 <= batchId < nextBatchId`) against the current on-chain `positionRoot`, `tallies`, and `countedPositions`.
   - Malformed, empty, or spam batches never block honest batches from settling and earn `$0` because rewards are tied strictly to proven `newlyAcceptedVoteCount`.

3. **Authenticated `newlyAcceptedVoteCount`, 25/25/50 Fee Split & Solvency Invariants**:
   - The STARK batch circuit and `BatchPublicInputs` authenticate `newlyAcceptedVoteCount` — the count of valid signed votes in the batch that contributed at least one newly counted eligible ETH position. A single voter claiming multiple validators in one vote counts as **1 accepted vote** (increasing ETH weight without multiplying the per-vote fee).
   - Each resolution freezes its `paymentToken` and `pricePerVote` at creation so future controller price updates never retroactively reprice prepaid escrow.
   - On `settleBatch`, `totalFee = newlyAcceptedVoteCount * state.pricePerVote`:
     - Reverts if `totalFee > remainingEscrow` (`InsufficientEscrowBalance` — no underfunded settlement).
     - **25% Protocol Developer** (`totalFee / 4`) -> `developerRecipient` (`TherdalController`).
     - **25% Blob Submitter / Frontend Operator** (`totalFee / 4`) -> `batch.submitter`.
     - **50% Successful STARK Prover** (`totalFee - devShare - submitterShare`) -> `msg.sender`.
   - Zero newly accepted votes incurs zero fee and pays zero rewards.

4. **Settlement Grace Period & Pro-Rata Pull Refunds (`closeSettlementAndEnableRefunds` & `claimRefund`)**:
   - Creator's `$100` deposit credits `$10` immediately to `developerRecipient` and records `$90` as the creator's refundable escrow contribution (`c_creator = $90`).
   - Additional `sponsor(resolutionId, amount)` transfers contribute `100%` to settlement escrow.
   - When all batches settle (`finalizeResolution`) or once `settlementDeadline` expires (`closeSettlementAndEnableRefunds`), unused escrow `U` is frozen and contributors withdraw pro-rata refunds via pull-based `claimRefund`:
     `refund_i = floor(U * c_i / C)`

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                               Therdal Protocol v0.2                                      │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  [TherdalController (Smart Account)] ──(Sets pricePerVote & Stablecoin Allowlist)──┐     │
│   - Initial Operator: 1 Signer (Upgradable to DAO Timelock)                        │     │
│   - Receives $10 Creation Fee + 25% Developer Settlement Share                     ▼     │
│                                                                              [Therdal.sol]│
│  [Creator] ──($100 USDC: $10 Dev Fee + $90 Escrow)──────────────────────────►  │         │
│  [Sponsor] ──(100% USDC Escrow Contribution)────────────────────────────────►  │         │
│                                                                                │         │
│  [Any Submitter] ──(Permissionless publishBatch + EIP-4844 Blobs)───────────► [BatchReg] │
│         │                                                                      │         │
│         ▼                                                                      │         │
│  [Blob Archive] ──► [Rust Prover (Non-Sequential)] ◄───────────────────────────┘         │
│                      - Authenticates newlyAcceptedVoteCount                              │
│                      - Updates 256-bit SMT & ETH Tallies                                 │
│                                 │                                                        │
│                                 ▼ (settleBatch for any unsettled batchId)                │
│                           [SponsorEscrow]                                                │
│                            ├─ 25% Developer (TherdalController)                          │
│                            ├─ 25% Batch Submitter                                        │
│                            ├─ 50% STARK Prover                                           │
│                            └─ Pro-rata Pull Refunds: floor(U * c_i / C)                  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `docs/` (`decisions.md`, `threat-model.md`, `blob-format.md`, `snapshot-and-stake.md`, `proof-public-inputs.md`, `economics.md`) to v0.2 specification | Complete |
| 2 | Implement `TherdalController.sol` (smart-account pricing authority & DAO-upgradable developer treasury) and `IERC20Minimal.sol` in `contracts/` | Complete |
| 3 | Upgrade `ITherdal.sol`, `BatchRegistry.sol`, `SponsorEscrow.sol`, `StarkVerifierAdapter.sol`, and `Therdal.sol` for USDC/multi-stablecoin deposits, permissionless non-sequential batches, `newlyAcceptedVoteCount`, 25/25/50 fee split, and pro-rata pull refunds | Complete |
| 4 | Update Foundry tests (`TherdalCore.t.sol`, `TherdalAdversarial.t.sol`, `DeployTherdal.s.sol`, and `MockUSDC`) to verify $100=$10+$90 creation, 25/25/50 splits, non-sequential settlement, insufficient-escrow reverts, DAO controller handoff, and pro-rata refunds | Complete |
| 5 | Upgrade Rust workspace (`circuits/`, `publisher/`, `prover/`, `archive/`, `cli/`) for permissionless submitters, non-sequential batch proving, `newly_accepted_vote_count` public input binding, and 25/25/50 USDC economics | Complete |
| 6 | Update cross-language integration test (`RustProverCompatibility.t.sol`), TypeScript `sdk/`, and interactive `frontend/` web app for v0.2 USDC fee splitting & non-sequential settlement | Complete |
| 7 | Run full verification suite (`forge test`, `cargo test`, `therdal-cli demo-e2e`, and frontend syntax check) and update root `README.md` | Complete |
