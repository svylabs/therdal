# Stage 2: Direct On-Chain Voting via Execution Balance & Beacon Stake Proofs

## Feature Summary

Implement **Stage 2 (Direct On-Chain Voting)** of the Therdal protocol across Solidity smart contracts, Rust domain/CLI crates, TypeScript SDK, interactive web frontend, and protocol documentation.

Users can vote directly on any `Open` topic (`block.timestamp <= votingEndsAt`, `$0` protocol fee, zero `SponsorEscrow` consumption) by cryptographically proving ETH held or staked at the topic's pinned parent snapshot block (`snapshotBlock = block.number - 1`, `snapshotBlockHash`):

1. **Direct Voting via Execution Layer ETH Balance (`voteWithExecutionBalance`)**:
   - Authenticates `snapshotExecutionRoot` (`stateRoot`, RLP header field `3`) against the topic's pinned `snapshotBlockHash` (`keccak256(rlpExecutionHeader) == snapshotBlockHash` and RLP header field `8 == snapshotBlock`), either once via `authenticateExecutionSnapshot` or inline on first vote.
   - Verifies an EIP-1186 Merkle Patricia Trie (MPT) account inclusion proof (`rlpAccountProofNodes`) for `keccak256(abi.encodePacked(msg.sender))` against `snapshotExecutionRoot`, decoding `[nonce, balance, storageRoot, codeHash]`.
   - Enforces `balance > 0` and records canonical position uniqueness under `walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", block.chainid, msg.sender))` so each snapshot wallet balance can vote at most once per topic.

2. **Direct Voting via Beacon Chain Staked ETH (`voteWithBeaconStake`)**:
   - Automatically pins `snapshotBeaconBlockRoot` at topic creation from EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) when available (with fallback to `childBlockTimestamp` lookup).
   - Authenticates `snapshotBeaconRoot` (`BeaconBlockHeader.state_root`, depth-3 index `3`) and `snapshotEpoch = beaconSlot / 32` (`BeaconBlockHeader.slot`, depth-3 index `0`) against `canonicalBeaconBlockRoot`, and verifies SSZ execution-consensus alignment (`BeaconState.latest_execution_payload_header.block_hash == snapshotBlockHash` at leaf index `780`, depth `10` or `11`), either once via `authenticateBeaconSnapshot` or inline on first vote.
   - Verifies one or more `ValidatorStakeProof` items against `snapshotBeaconRoot`:
     - Computes `validatorRoot = hash_tree_root(Validator)` via EVM SHA-256 precompile (`0x02`).
     - Verifies the depth-40 `validators` SSZ Merkle branch strictly along the bit path of `validatorIndex` (`< 2^40`), mixes in `validatorsLengthChunk`, and verifies the `BeaconState.validators` branch at field index `11` (depth `5` for Deneb or `6` for Electra).
     - Enforces `!slashed`, `activationEpoch <= snapshotEpoch < exitEpoch`, `effectiveBalanceGwei > 0`, and `0x01` or `0x02` withdrawal credentials pointing to `msg.sender` (`address(uint160(uint256(withdrawalCredentials))) == msg.sender`).
   - Credits `uint256(effectiveBalanceGwei) * 1 gwei` wei per validator and enforces canonical position uniqueness under `validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", block.chainid, uint64(validatorIndex)))`.

3. **Combined Direct Voting (`voteDirect`)**:
   - Allows an ETH holder who controls both an execution wallet balance and one or more Beacon Chain validators at snapshot time to prove and cast all positions in a single atomic transaction.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                  Stage 2: Therdal Direct Snapshot Voting Stack               │
├──────────────────────────────────────────────────────────────────────────────┤
│  Solidity Contracts (contracts/)                                             │
│  ├── interfaces/IDirectVoting.sol            : Proof structs, views & errors │
│  ├── libraries/RLPReader.sol                 : Strict canonical RLP decoder  │
│  ├── libraries/MerklePatriciaProofVerifier.sol: EIP-1186 MPT account proofs  │
│  ├── libraries/SSZVerifier.sol               : SHA-256 SSZ & validator tree  │
│  ├── libraries/SnapshotAuthenticator.sol     : EL header & CL EIP-4788 auth  │
│  ├── libraries/PositionEligibility.sol       : Key derivation & proof checks │
│  └── Therdal.sol                             : Stage 1 Registry + Direct Vote│
├──────────────────────────────────────────────────────────────────────────────┤
│  Rust Workspace (topics/, voting/, cli/)                                     │
│  ├── voting/ (therdal-voting)                : RLP, MPT, SSZ, keys & tallies │
│  └── cli/    (therdal-cli)                   : vote-execution, vote-beacon,  │
│                                                tallies, position-key         │
├──────────────────────────────────────────────────────────────────────────────┤
│  TypeScript SDK & Interactive Frontend (sdk/ & frontend/)                    │
│  ├── sdk/src/voting.ts (+ sha256.ts, rlp.ts) : Cross-layer proofs, keys, ABI │
│  └── frontend/                               : Live MPT/SSZ Direct Voting UI │
├──────────────────────────────────────────────────────────────────────────────┤
│  Documentation Sync (docs/, website/docs.html, website/src/docs-v10.js)      │
│  └── direct-voting.md, snapshot-and-stake.md, decisions.md, threat-model.md  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Implement modular Stage 2 Solidity contracts and cryptographic proof verifiers (`IDirectVoting.sol`, `RLPReader.sol`, `MerklePatriciaProofVerifier.sol`, `SSZVerifier.sol`, `SnapshotAuthenticator.sol`, `PositionEligibility.sol`, and `Therdal.sol`) | Complete |
| 2 | Write comprehensive Foundry unit, boundary, malformed-proof, adversarial, and cross-layer vector tests (`test/contracts/DirectVoting.t.sol`, `test/adversarial/DirectVotingAdversarial.t.sol`, `test/helpers/ProofTestHelpers.sol`) and verify with `forge test` | Complete |
| 3 | Implement modular Rust `therdal-voting` crate (canonical RLP, EIP-1186 MPT, SHA-256 SSZ, snapshot authentication, position keys, and tally engine) and extend `therdal-cli` with direct voting commands (`cargo test --offline`) | Complete |
| 4 | Extend TypeScript SDK (`sdk/`) with Stage 2 position key helpers, RLP/MPT & SSZ proof builders/verifiers, and Direct Voting ABIs with cross-layer vector tests (`npm test`) | Complete |
| 5 | Upgrade interactive web frontend (`frontend/`) with Direct On-Chain Voting (Execution ETH MPT proofs, Beacon Validator SSZ proofs, combined direct voting, live ETH-weighted option tallies, and proof inspector) | Complete |
| 6 | Synchronize markdown specifications (`docs/direct-voting.md`, `docs/snapshot-and-stake.md`, `docs/decisions.md`, `docs/economics.md`, `docs/threat-model.md`, `README.md`) and two-pane website documentation portal (`website/docs.html`, `website/src/docs-v10.js`) | Complete |
