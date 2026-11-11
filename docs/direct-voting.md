# Therdal Protocol v0.2 — Stage 2: Direct On-Chain Voting Specification

## 1. Overview

Stage 2 enables ETH holders to vote **directly on-chain** on any `Open` topic (`block.timestamp <= votingEndsAt`) in `Therdal.sol` (`IDirectVoting.sol`) by proving ETH held at snapshot time in Execution Layer wallets, ETH staked at snapshot time in Beacon Chain validators, or both in a single atomic transaction:

- **`$0` Protocol Fee & Zero Escrow Drain**: Direct on-chain voters pay only standard Ethereum L1 transaction gas. Direct voting charges **`$0` protocol fee** and deducts **`0`** from the topic's `SponsorEscrow` pool.
- **No Token Locking**: Balances and validator stakes are proven purely against the historical parent block pinned when the topic was created (`snapshotBlock = block.number - 1`, `snapshotBlockHash`). Moving, selling, or buying ETH after topic creation has zero effect on voting eligibility or weight.
- **Unified Position Uniqueness**: Direct votes derive the exact same `THERDAL_WALLET` and `THERDAL_VALIDATOR` 32-byte position keys used across the protocol, guaranteeing every wallet balance and validator index can be counted at most once per topic.

---

## 2. Smart Contract Entry Points (`IDirectVoting.sol`)

```solidity
function authenticateExecutionSnapshot(
    uint256 topicId,
    bytes calldata rlpExecutionHeader
) external returns (bytes32 snapshotExecutionRoot);

function authenticateBeaconSnapshot(
    uint256 topicId,
    BeaconSnapshotAuthProof calldata proof
) external returns (bytes32 snapshotBeaconRoot, uint64 snapshotEpoch);

function voteWithExecutionBalance(
    uint256 topicId,
    uint32 optionIndex,
    bytes calldata rlpExecutionHeader,
    bytes calldata rlpAccountProofNodes
) external returns (uint256 weightWei);

function voteWithBeaconStake(
    uint256 topicId,
    uint32 optionIndex,
    BeaconSnapshotAuthProof calldata beaconAuth,
    ValidatorStakeProof[] calldata validatorProofs
) external returns (uint256 totalStakeWei);

function voteDirect(
    uint256 topicId,
    uint32 optionIndex,
    DirectVoteProofBundle calldata bundle
) external returns (uint256 totalWeightWei);
```

### Snapshot Authentication Amortization
- **First Direct Execution Vote**: Supplies `rlpExecutionHeader` (`keccak256(rlpExecutionHeader) == snapshotBlockHash`), authenticating and caching `snapshotExecutionRoot` on-chain. Subsequent execution voters can pass `rlpExecutionHeader = ""` (`0x`) to reuse the cached root.
- **First Direct Beacon Vote**: Supplies `BeaconSnapshotAuthProof`, authenticating and caching `snapshotBeaconRoot` and `snapshotEpoch = beaconSlot / 32` on-chain. Subsequent validator voters can pass an empty `BeaconSnapshotAuthProof` to reuse the cached beacon state root.

---

## 3. Execution Layer Balance Proofs (RLP + EIP-1186 MPT)

1. **Header Verification (`SnapshotAuthenticator.sol` + `RLPReader.sol`)**:
   - Strict Yellow Paper canonical RLP decoding (rejects leading-zero integers/lengths, non-minimal prefixes, and trailing bytes).
   - Verifies `keccak256(rlpExecutionHeader) == snapshotBlockHash` (falling back to `BLOCKHASH` or EIP-2935 `0x0000F90827F1C53a10cb7A02335B175320002935` if needed), verifies RLP header field `8` (`number == snapshotBlock`), and extracts field `3` (`stateRoot`, non-zero 32 bytes).
2. **Account Inclusion (`MerklePatriciaProofVerifier.sol`)**:
   - Traverses `rlpAccountProofNodes` from `snapshotExecutionRoot` along the 64-nibble path `keccak256(abi.encodePacked(msg.sender))` (`eth_getProof` format).
   - Supports 17-item branch nodes, 2-item extension/leaf nodes, and `<32`-byte embedded RLP child nodes.
   - RLP-decodes the 4-element account tuple `[nonce, balance, storageRoot, codeHash]` and requires `balance > 0` (`ZeroVotingWeight` on `0`).
3. **Position Key**:
   ```text
   walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(block.chainid), address(msg.sender)))
   ```

---

## 4. Beacon Chain Validator Stake Proofs (EIP-4788 + SHA-256 SSZ)

1. **Pinned EIP-4788 Beacon Root (`Therdal.sol`)**:
   - During `createTopic`, `Therdal.sol` queries EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) at `block.timestamp`, which holds `parentBeaconBlockRoot` — the exact Beacon Block root corresponding to `snapshotBlock = block.number - 1` — and pins it permanently as `snapshotBeaconBlockRoot` so validator proofs remain verifiable even after EIP-4788's 8,191-slot ring buffer wraps.
2. **Beacon Snapshot Alignment (`SnapshotAuthenticator.sol`)**:
   - Verifies depth-3 SHA-256 SSZ branch `stateRootBranch` at `BeaconBlockHeader` field index `3` -> `beaconStateRoot`.
   - Verifies depth-3 SHA-256 SSZ branch `slotBranch` at `BeaconBlockHeader` field index `0` -> `beaconSlot` (`snapshotEpoch = beaconSlot / 32`).
   - Verifies SSZ execution-consensus alignment branch `executionHashBranch` (depth `10` Deneb or `11` Electra) at generalized leaf index `780` (`(24 << 5) | 12`), proving `BeaconState.latest_execution_payload_header.block_hash == snapshotBlockHash`.
3. **Validator Container & Index-Bound Merkle Proof (`SSZVerifier.sol` + `PositionEligibility.sol`)**:
   - Computes `validatorRoot = hash_tree_root(Validator)` via EVM SHA-256 precompile (`0x02`) over the 8 SSZ chunks (`pubkeyRoot`, `withdrawalCredentials`, `effectiveBalanceGwei`, `slashed`, `activationEligibilityEpoch`, `activationEpoch`, `exitEpoch`, `withdrawableEpoch`).
   - Traverses the depth-40 `validatorBranch` strictly using the bits of `validatorIndex` (`< 2^40`), mixes in `validatorsLengthChunk` (verifying canonical uint64 LE encoding and `validatorIndex < validatorCount`), and verifies `beaconStateBranch` (depth `5` Deneb or `6` Electra) at `BeaconState` field `11` (`validators`).
   - Enforces eligibility:
     - `slashed == false` (`ValidatorSlashed`)
     - `activationEpoch <= snapshotEpoch < exitEpoch` (`ValidatorNotActiveAtSnapshot`)
     - `withdrawalCredentials[0] == 0x01 || withdrawalCredentials[0] == 0x02` (`UnsupportedWithdrawalPrefix`)
     - `address(uint160(uint256(withdrawalCredentials))) == msg.sender` (`UnauthorizedWithdrawalAddress`)
     - `effectiveBalanceGwei > 0` (`ZeroVotingWeight`), crediting `uint256(effectiveBalanceGwei) * 1 gwei` wei.
4. **Position Key**:
   ```text
   validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(block.chainid), uint64(validatorIndex)))
   ```

---

## 5. Deterministic Cross-Layer Test Vectors

Verified identically across Solidity (`test/contracts/DirectVoting.t.sol`), Rust (`voting/src/lib.rs`), TypeScript (`sdk/test/voting.test.ts`), and Browser JS (`frontend/src/votingDomain.js`):

| Vector | Inputs | Expected 32-Byte Digest |
| --- | --- | --- |
| `walletKey` | `chainId = 1`, `account = 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A` | `0xfdc983c4a6627025bb1acfb58480db21d43845f0caeddd82415a6190c3fb0ec4` |
| `validatorKey` | `chainId = 1`, `validatorIndex = 42` | `0x55505d5e6780e2e33dce1a71b9bd0ea0afe46418ab1ee55f0fdb4d0e4f312de4` |
| `validatorRoot` | `pubkeyRoot = 0x11..11`, `creds = 0x01 \|\| 0*11 \|\| alice`, `effBal = 32_000_000_000`, `!slashed`, `elig = 100`, `act = 110`, `exit = u64::MAX`, `withdr = u64::MAX` | `0xd43c10cf2e1a1f61413cf26c8b470a6e2bc223a7cb985b7f025247b20dea6ae0` |
| `singleAccountTrieRoot` | `account = alice`, `nonce = 5`, `balance = 25 ether` (`empty_storage_root`, `empty_code_hash`) | `0x6c964a28f19f91df3af2d04e7dea3d12cb853416b2cab63617302e2b89e45d54` |
