# Therdal Protocol v0.2 — Threat Model & Security Boundaries

## 1. Primary Safety & Solvency Invariants

1. **Cryptographic Settlement Invariant**: Every settled batch must be proven against its previously registered `commitmentRoot`, authenticated `snapshotExecutionRoot` / `snapshotBeaconRoot`, and the current on-chain `positionRoot` SMT, counting each ETH position at most once.
2. **Solvency Invariant**:
   `totalEarnedFees + remainingEscrow == totalEscrowContributed` (prior to refunds), and after settlement closes (`U = frozenUnusedEscrow`), `sum_i floor(U * c_i / C) <= U`. Topic creation is free (`$0` protocol fee), and `100%` of optional sponsorships enter `totalEscrowContributed`.

---

## 2. Actor Threat Matrix

| Actor | Capabilities | Malicious Vectors | Protocol Defense |
| --- | --- | --- | --- |
| **Creator** | Registers `subject`, `2..=16` free-text `options`, and `votingEndsAt` (`$0` creation fee; optional sponsorship) | Submitting blank/duplicate/oversized options, past deadlines, or forged snapshot blocks | `TopicValidation` enforces non-whitespace lengths (`<=512` / `<=256` bytes), trimmed option uniqueness, and `votingEndsAt > block.timestamp`; `snapshotBlock` (`block.number - 1`), `snapshotBlockHash`, and EIP-4788 `snapshotBeaconBlockRoot` are recorded automatically by `Therdal.sol` |
| **Direct On-Chain Voter** | Calls `voteWithExecutionBalance`, `voteWithBeaconStake`, or `voteDirect` during `Open` (`$0` protocol fee) | Submitting non-canonical RLP, forged MPT account balances, validator index substitution, slashed/exited/`0x00` BLS validators, or replaying a counted position | `RLPReader` rejects non-canonical prefixes; `MerklePatriciaProofVerifier` checks every node hash along `keccak256(msg.sender)` against `snapshotExecutionRoot`; `SSZVerifier` binds the depth-40 branch to `validatorIndex < validatorCount` and aligns `BeaconState` leaf `780` to `snapshotBlockHash`; `PositionEligibility` enforces `0x01`/`0x02` withdrawal address `== msg.sender` and reverts duplicates via `PositionAlreadyCounted` |
| **Permissionless Submitter** | Calls `publishBatch` during `Open` | Publishing spam, malformed, or unavailable blobs to block honest batches or drain escrow | Settlement is **non-sequential** so honest batches bypass malformed batches; submitters earn `$0` at publication and `35%` only after valid STARK settlement (provers earn `65%`) |
| **Permissionless Submitter** | Operates voting frontend | Omitting/censoring unfavorable voter signatures | Permissionless publication allows voters to submit through competing aggregators or self-publish |
| **Prover** | Calls `settleBatch` during `Settling` | Inflating `newlyAcceptedVoteCount` by splitting validator claims or replaying old batches | Circuit counts at most 1 accepted vote per valid `SignedVote` envelope with >=1 new position; `batch.settled = true` prevents replay |
| **Controller / Pricing Authority** | Adjusts `pricePerVoteUsdMicros` or allowlisted USD stablecoins | Retroactively raising prices on active resolutions | Each resolution freezes `paymentToken` and `pricePerVote` at creation; controller can transition to a DAO Timelock |
| **ERC-20 / Recipient Hook** | Receives fee splits or refunds | Reentrancy or transfer blocking | `nonReentrant` lock + `Checks-Effects-Interactions` + pull-based `claimableTokenRewards[token][recipient]` fallback if direct transfer fails |
