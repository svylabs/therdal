<p align="left">
  <img src="website/assets/logo-lockup.svg" alt="Therdal — Ethereum Signaling Protocol" height="58" />
</p>

# Therdal — A Permissionless and Verifiable Stakeholder Signaling Protocol for Ethereum

**The voice of ETH holders.**

- **Permissionless**: Anyone can create topics, sponsor participation, submit votes, or generate proofs.
- **Verifiable**: Voting eligibility, uniqueness, and results can be cryptographically verified.
- **Stakeholder signaling**: ETH holders express nonbinding preferences without claiming formal governance authority.
- **For Ethereum**: A focused identity with a clearly defined ecosystem.

---

## Staged Protocol Implementation

Therdal is being implemented in modular stages.

### Stage 1: Topic Creation (`Complete`)

Creating a topic registers on Ethereum (`contracts/Therdal.sol` + `contracts/libraries/TopicValidation.sol`):
1. **Subject (`string subject`)**: Non-empty free-text question (`1..=512` UTF-8 bytes).
2. **Options (`string[] options`)**: `2` to `16` unique free-text option strings (`1..=256` UTF-8 bytes each, deduplicated after ASCII whitespace trimming).
3. **Voting Ends (`uint64 votingEndsAt`)**: Future Unix timestamp (`votingEndsAt > block.timestamp`) when voting closes (`Open` while `block.timestamp <= votingEndsAt`, `Closed` afterward).
4. **Always Free Creation & Optional USDC Sponsorship**:
   - Creating a topic requires **`$0` protocol fee** and **`$0` mandatory deposit** (`initialSponsorship = 0`).
   - Creators or community sponsors can optionally fund a topic's `SponsorEscrow` pool (`initialSponsorship > 0` or `sponsorTopic(topicId, amount)`), with **100%** entering escrow and `TherdalController.sol` freezing `paymentToken` and `pricePerVote` (`~$0.01 / vote` default estimate) per topic.
5. **Automatic Parent Block Snapshot & Cross-Layer Commitment**:
   - Pins `snapshotBlock = block.number - 1` and `snapshotBlockHash = blockhash(block.number - 1)` automatically at creation.
   - Computes deterministic 32-byte `contentHash` (`THERDAL_TOPIC_V1`) verified identically across Solidity, Rust (`therdal-topics`), TypeScript (`@therdal/sdk`), and the browser frontend (`frontend/`).

---

## Quickstart & Verification

### 1. Run Solidity Tests (Foundry)
```bash
forge test -vv
```

### 2. Run Rust Domain & CLI Tests
```bash
cargo test --offline
```

### 3. Run TypeScript SDK Tests
```bash
cd sdk && npm test
```

### 4. Register & Inspect a Topic via CLI
```bash
cargo run --offline --bin therdal-cli -- create-topic \
  --subject "Should Ethereum increase the blob target from 6 to 12?" \
  --option "12 Blobs" \
  --option "9 Blobs" \
  --option "Keep at 6 Blobs" \
  --voting-ends-at 1900000000

cargo run --offline --bin therdal-cli -- list-topics
```

### 5. Launch the Website & Interactive Stage 1 App
```bash
python3 -m http.server 4173
# Public Protocol Website: http://localhost:4173/website/  (or http://localhost:4173/)
# Documentation Portal:    http://localhost:4173/website/docs.html
# Interactive Stage 1 App: http://localhost:4173/frontend/
```
