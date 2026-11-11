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
   - Pins `snapshotBlock = block.number - 1`, `snapshotBlockHash = blockhash(block.number - 1)`, and EIP-4788 `snapshotBeaconBlockRoot` automatically at creation.
   - Computes deterministic 32-byte `contentHash` (`THERDAL_TOPIC_V1`) verified identically across Solidity, Rust (`therdal-topics`), TypeScript (`@therdal/sdk`), and the browser frontend (`frontend/`).

### Stage 2: Direct Snapshot Voting (`Complete`)

ETH holders can vote directly on-chain on any `Open` topic (`contracts/Therdal.sol` + `contracts/interfaces/IDirectVoting.sol`, **`$0` protocol fee**, zero `SponsorEscrow` used):
1. **Execution Layer ETH Proofs (`voteWithExecutionBalance`)**:
   - Authenticates `snapshotExecutionRoot` from the canonical RLP execution block header matching `snapshotBlockHash` (`SnapshotAuthenticator.sol`, `RLPReader.sol`).
   - Verifies EIP-1186 Merkle Patricia Trie account proofs (`MerklePatriciaProofVerifier.sol`) for `keccak256(msg.sender)` and locks `THERDAL_WALLET` position key against double-voting.
2. **Beacon Chain Staked ETH Proofs (`voteWithBeaconStake`)**:
   - Authenticates `snapshotBeaconRoot` and `snapshotEpoch = beaconSlot / 32` from EIP-4788 `snapshotBeaconBlockRoot`, verifying SSZ execution-consensus block hash alignment at leaf index `780`.
   - Verifies depth-40 SHA-256 SSZ `Validator` inclusion proofs (`SSZVerifier.sol`), enforcing `!slashed`, `activationEpoch <= snapshotEpoch < exitEpoch`, and `0x01` or `0x02` withdrawal credentials pointing to `msg.sender`, locking each `THERDAL_VALIDATOR` key.
3. **Combined Atomic Direct Voting (`voteDirect`)**:
   - Proves both an execution wallet balance and multiple staked validators in a single transaction, verified identically across Solidity, Rust (`therdal-voting`), TypeScript (`@therdal/sdk`), and the interactive web app (`frontend/`).

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

### 4. Register a Topic & Cast Direct Snapshot Votes via CLI
```bash
# Generate deterministic RLP/MPT + Beacon SSZ snapshot fixture for voter + validator #42
cargo run --offline --bin therdal-cli -- generate-proof-fixture \
  --voter 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A \
  --balance-wei 25000000000000000000 \
  --validator-index 42 \
  --effective-balance-gwei 32000000000 \
  --snapshot-block 21499999 \
  --out ./fixture.json

# Create a topic pinned to the fixture's snapshotBlockHash, cast combined direct vote, and inspect tallies
cargo run --offline --bin therdal-cli -- vote-direct \
  --topic-id 1 \
  --option-index 0 \
  --voter 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A \
  --bundle-file ./fixture.json

cargo run --offline --bin therdal-cli -- tallies --topic-id 1
```

### 5. Launch & Deploy the Website (`therdal.org` · GitHub Pages)
```bash
# Local development server
python3 -m http.server 4173
# Public Protocol Website: http://localhost:4173/website/  (or http://localhost:4173/)
# Documentation Portal:    http://localhost:4173/website/docs.html
# Interactive Stage 2 App: http://localhost:4173/frontend/

# Build, test & preview the production GitHub Pages bundle (website/dist/)
npm run website:build
npm run website:test
npm run website:preview

# Deploy to GitHub Pages (`origin/gh-pages`, custom domain: therdal.org)
npm run website:deploy:dry-run
npm run website:deploy
```

Automatic CI/CD deployment is also configured in `.github/workflows/deploy-pages.yml` (set **Settings → Pages → Source: GitHub Actions** on GitHub). See [`docs/deployment.md`](docs/deployment.md) for `therdal.org` DNS records and full hosting details.
