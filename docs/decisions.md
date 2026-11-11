# Therdal Protocol v0.2 — Finalized Engineering Decisions

This document records the concrete protocol choices resolving the 10 open questions in Section 13 of the Therdal v0.2 specification.

---

## 1. STARK Proving System, On-Chain Verifier, Hash Function & SMT Layout
- **Proving System & Verifier Adapter**: `StarkVerifierAdapter.sol` pins a versioned program verification key (`bytes32 programVKey`) and verifies proofs over a single canonical 32-byte `publicInputsDigest` computed over 19 fixed 32-byte words (`608` bytes, including `newlyAcceptedVoteCount`).
- **SMT Layout**:
  - 256-bit binary Sparse Merkle Tree (SMT) indexed by the 256-bit position key (`positionKey`, traversed LSB to MSB).
  - Empty leaf value: `bytes32(0)`.
  - Occupied leaf value: `keccak256(abi.encodePacked(bytes1(0x00), "THERDAL_SMT_LEAF_V1", positionKey))`.
  - Internal node hash: `keccak256(abi.encodePacked(bytes1(0x01), left, right))`, with empty subtree compression `hashNode(0, 0) = 0` so the empty SMT root is `bytes32(0)`.
- **Position Keys**:
  - Execution wallet balance: `walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))`
  - Beacon validator stake: `validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))`

## 2. Blob Data Authentication Against EIP-4844 KZG Commitments
- During `publishBatch(resolutionId, blobCount)`, `BatchRegistry` reads each `blobhash(i)` (`i in [0, blobCount)`) from the current transaction and records `commitmentRoot = keccak256(abi.encodePacked(blobHashes))` alongside `submitter = msg.sender`.
- Inside the STARK transition (`circuits/src/blob_binding.rs`), the prover verifies that `keccak256(concat(blobVersionedHashes)) == registeredBatchCommitment` and checks each blob's canonical 31-byte field element packing and Fiat-Shamir barycentric evaluation equivalence opening against its `0x01` KZG versioned hash.

## 3. On-Chain Topic Registration & Snapshot Pinning
- **On-Chain Subject, Custom Options & Deadline (Stage 1)**:
  - `createTopic(subject, options, votingEndsAt, initialSponsorship)` (and `createTopicWithConfig(CreateTopicParams)`) registers `subject` (`<= 512` UTF-8 bytes), `2..=16` unique non-empty free-text `options` (`<= 256` UTF-8 bytes each), and `votingEndsAt > block.timestamp`, computing deterministic `contentHash` (`THERDAL_TOPIC_V1`).
- **Pin at Creation, Authenticate Before Settlement**:
  - `createTopic` automatically pins `snapshotBlock = uint64(block.number - 1)` and `snapshotBlockHash = blockhash(block.number - 1)` directly on-chain at creation.
  - Prior to settling batches in later protocol stages, execution and beacon state roots are authenticated against the pinned snapshot block via `BLOCKHASH`/EIP-2935 (`0x0000F90827F1C53a10cb7A02335B175320002935`) and EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`).

## 4. Eligible ETH Balances & Validator Control Rules
- **Execution Balances (`THERDAL_WALLET`)**: Proven against `snapshotExecutionRoot`; weight equals RLP-decoded `balance` in wei.
- **Validator Stakes (`THERDAL_VALIDATOR`)**: Proven against `snapshotBeaconRoot`; requires `slashed == false`, `activationEpoch <= snapshotEpoch < exitEpoch`, and `0x01` or `0x02` withdrawal credentials matching `vote.signer`.
- **Per-Vote Fee Semantics**: A single signer claiming both their wallet and multiple validators in one signed `Vote` counts as **1 accepted vote** toward `newlyAcceptedVoteCount` (provided at least one claimed position is newly counted with `weight > 0`).

## 5. Duplicate & Conflict Policy Across Records and Non-Sequential Batches
- **First Valid Settled Claim Wins**:
  - Within a batch, records and `positionClaims` are processed in canonical index order.
  - Across batches, settlement is **non-sequential**: any registered, unsettled `batchId` can be proven against the current on-chain `positionRoot` SMT.
  - Once a position key is inserted into `positionRoot` by a settled batch, any later settled batch containing a claim for that same position sees it in the SMT and skips that position (`weight = 0` added). If a vote contributes zero newly counted positions, it does **not** increment `newlyAcceptedVoteCount`.

## 6. Direct On-Chain Voting in v1
- **Disabled in v1**: Direct on-chain voting is disabled in v1 (`Section 8`) to preserve unified SMT position uniqueness.

## 7. Permissionless Submitters, Missing Archives & Stalled Settlement Recovery
- **Permissionless Publication**: Any submitter/frontend operator can call `publishBatch(resolutionId, blobCount)` during `Open`. Voters censored by one submitter can route their signed vote to any alternative submitter or self-publish.
- **Settlement Grace Period & Closure**: After `votingEndsAt`, provers settle valid batches until `settlementDeadline`. Once `settlementDeadline` passes, anyone can call `closeSettlementAndEnableRefunds(resolutionId)` to close settlement, freeze unused escrow `U`, and unlock pro-rata pull refunds.

## 8. Batch Limits & Encoding Rules
- Maximum blobs per `publishBatch` call: `MAX_BLOBS_PER_BATCH = 6`.
- Canonical binary format: `THERDAL_BLOB_V1` (`"THDLBLOB"`, version `1`, `resolutionId`, `batchId`, `voteCount`, `payloadLen`, length-prefixed `Vote` records, zero-padded).

## 9. Payment Asset, Smart-Account Controller, Price Freeze & Insufficient-Escrow Policy
- **Payment Asset**: **USDC (6 decimals)** initially, with multi-stablecoin allowlist support (`acceptedTokens[token]`) managed by `TherdalController.sol`. Prices are configured in 6-decimal USD micro-units (`$1.00 = 1_000_000`) and scaled automatically to the chosen stablecoin's decimals (`10 ** decimals / 10 ** 6`).
- **Controller & Developer Smart Account (`TherdalController.sol`)**: Operated initially by 1 signer and replaceable by a DAO / Timelock (`transferOperator`). Acts as pricing authority (constantly updating fee parameters—such as the estimated `~$0.01 / vote` rate—to reflect market realities) and initial `developerRecipient` (receiving `25%` of settled vote fees; topic creation charges `$0` fee).
- **Frozen Resolution Pricing**: Each resolution freezes its `paymentToken` and `pricePerVote` at creation so future controller price updates never retroactively reprice prepaid sponsorship escrow.
- **Insufficient Escrow Policy**: `settleBatch` reverts (`InsufficientEscrowBalance`) if `newlyAcceptedVoteCount * pricePerVote > remainingEscrow`; partial settlement of underfunded batches is disallowed.

## 10. Non-Sequential Settlement & Permissionless Spam Immunity
- No separate receipt hash chain is required beyond ordered `BatchRecord` commitments and SMT `positionRoot` transitions.
- Because batch settlement is **non-sequential** (`0 <= batchId < nextBatchId`, `!batch.settled`) and rewards are paid strictly after STARK proof verification for `newlyAcceptedVoteCount`, permissionless spam or malformed batches never block honest batches from settling and earn `$0`.
