# Stage 1: Topic Creation Protocol Implementation Tasks

## Feature Summary

Implement **Stage 1 (Topic Creation)** of the Therdal protocol across smart contracts, Rust domain/CLI crates, TypeScript SDK, interactive web frontend, and protocol documentation.

Creating a topic registers on-chain:
1. **Subject (`string subject`)**: Required, non-empty (non-whitespace-only) free-text question/subject up to `512` UTF-8 bytes.
2. **Options (`string[] options`)**: Between `2` and `16` unique, non-empty (non-whitespace-only) free-text option strings, each up to `256` UTF-8 bytes.
3. **Voting Ends (`uint64 votingEndsAt`)**: Future Unix timestamp (`votingEndsAt > block.timestamp`) defining when voting closes (`Open` while `block.timestamp <= votingEndsAt`, `Closed` once `block.timestamp > votingEndsAt`).
4. **Free Creation & Optional Initial USDC Sponsorship (`uint256 initialSponsorship`)**:
   - Topic creation requires **`$0` protocol fee** and **`$0` mandatory deposit** (`initialSponsorship = 0` performs zero ERC-20 transfers).
   - Creators may optionally supply `initialSponsorship > 0` in USDC (or an allowlisted USD stablecoin via `createTopicWithConfig`), routing **100%** into the topic's `SponsorEscrow` pool, and anyone may top up an `Open` topic via `sponsorTopic(topicId, amount)`.
5. **Automatic Snapshot Pinning & Cross-Layer Content Hash**:
   - Automatically pins `createdAt = block.timestamp`, `snapshotBlock = block.number - 1`, `snapshotBlockHash = blockhash(block.number - 1)`, frozen `paymentToken` and `pricePerVote` from `TherdalController`, and deterministic `contentHash = keccak256(abi.encodePacked("THERDAL_TOPIC_V1", keccak256(bytes(subject)), uint64(options.length), keccak256(abi.encodePacked(optionHashes)), uint64(votingEndsAt)))`.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Stage 1: Therdal Topic Creation Stack                    │
├──────────────────────────────────────────────────────────────────────────────┤
│  Solidity Contracts (contracts/)                                             │
│  ├── interfaces/ITopicRegistry.sol : Topic structs, phases, events & errors  │
│  ├── interfaces/IERC20Minimal.sol  : Minimal ERC-20 + SafeERC20Helper        │
│  ├── libraries/TopicValidation.sol : Pure subject/options/time checks & hash │
│  ├── TherdalController.sol         : Allowlisted USD tokens & pricePerVote   │
│  ├── SponsorEscrow.sol             : 100%-to-pool optional USDC escrow       │
│  └── Therdal.sol                   : Stage 1 Topic Registry & Sponsorship    │
├──────────────────────────────────────────────────────────────────────────────┤
│  Rust Workspace (topics/ & cli/)                                             │
│  ├── topics/ (therdal-topics)      : Pure validation, contentHash, traits    │
│  └── cli/    (therdal-cli)         : create-topic, list-topics, get-topic    │
├──────────────────────────────────────────────────────────────────────────────┤
│  TypeScript SDK & Interactive Frontend (sdk/ & frontend/)                    │
│  ├── sdk/src/index.ts              : Stage 1 validation, ABI & USDC helpers  │
│  └── frontend/                     : Topic Creation UI & Registry Explorer   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Documentation Sync (docs/, website/docs.html, README.md)                    │
│  └── Synchronized specs, CLI quickstart, and Stage 1 contract interfaces     │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Implement modular Stage 1 Solidity contracts (`ITopicRegistry.sol`, `TopicValidation.sol`, `TherdalController.sol`, `SponsorEscrow.sol`, `Therdal.sol`, `DeployTherdal.s.sol`) and remove obsolete Resolution prototype contracts | Complete |
| 2 | Write comprehensive Foundry unit, boundary, fuzz, adversarial, and cross-layer vector tests (`test/`) and verify with `forge test` | Complete |
| 3 | Implement modular Rust `therdal-topics` crate and Stage 1 `therdal-cli` (`create-topic`, `list-topics`, `get-topic`, `hash-topic`) with unit and cross-layer hash vector tests (`cargo test --offline`) | Complete |
| 4 | Update TypeScript SDK (`sdk/src/index.ts`) with Stage 1 topic types, validation, deterministic hashing helpers, and contract ABIs | Complete |
| 5 | Rebuild the interactive web frontend (`frontend/`) around Stage 1 Topic Creation (`subject`, dynamic free-text `options`, `votingEndsAt`, optional USDC sponsorship, topic list/detail inspector, and phase simulation) | Complete |
| 6 | Synchronize markdown specifications (`docs/topic-creation.md`, `docs/decisions.md`, `docs/economics.md`, `docs/threat-model.md`, `README.md`) and website documentation portal (`website/docs.html`) | Complete |
