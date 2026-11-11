# Therdal Protocol v0.2 — Snapshot Authentication & Stake Eligibility

## 1. Snapshot Lifecycle: Pin at Creation, Authenticate on First Proof

Per architectural decision A2, topic creation automatically pins the parent Ethereum execution and consensus block roots with minimal gas overhead:
1. **Creation (`createTopic` / `createTopicWithConfig`)**:
   - When a topic is registered on `Therdal.sol`, the contract automatically records:
     - `snapshotBlock = uint64(block.number - 1)`
     - `snapshotBlockHash = blockhash(block.number - 1)`
     - `snapshotBeaconBlockRoot = tryReadParentBeaconRoot(uint64(block.timestamp))` via EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`), capturing `header_B.parentBeaconBlockRoot` (the exact Beacon Block root of `snapshotBlock = B - 1`) before EIP-4788's 8,191-slot ring buffer can wrap.
2. **Authentication Before Direct Voting or Batch Settlement**:
   - On the first direct execution vote (`voteWithExecutionBalance` / `voteDirect`) or via `authenticateExecutionSnapshot`, anyone supplies the RLP execution header matching `snapshotBlockHash` to authenticate and cache `snapshotExecutionRoot`.
   - On the first direct validator vote (`voteWithBeaconStake` / `voteDirect`) or via `authenticateBeaconSnapshot`, anyone supplies `BeaconSnapshotAuthProof` to authenticate and cache `snapshotBeaconRoot` and `snapshotEpoch = beaconSlot / 32`.
   - Once authenticated, `snapshotExecutionRoot` and `snapshotBeaconRoot` serve both Stage 2 direct on-chain votes and STARK batch settlement proofs.

---

## 2. Execution Layer Snapshot Authentication
`SnapshotAuthenticator.sol` verifies `snapshotExecutionRoot` for `snapshotBlock`:
1. Resolves `canonicalBlockHash` from the topic's pinned `snapshotBlockHash` (with fallback to `blockhash(snapshotBlock)` within 256 blocks or EIP-2935 History Storage `0x0000F90827F1C53a10cb7A02335B175320002935`).
2. Checks `keccak256(rlpExecutionHeader) == canonicalBlockHash`.
3. Canonically RLP-decodes `rlpExecutionHeader` (`>= 15` fields), verifies field `8` (`number`) equals `snapshotBlock`, and extracts field `3` (`stateRoot`) as `snapshotExecutionRoot`.

---

## 3. Beacon Layer Snapshot Authentication
`SnapshotAuthenticator.sol` verifies `snapshotBeaconRoot` and `snapshotEpoch`:
1. Uses the topic's pinned `snapshotBeaconBlockRoot` (or queries EIP-4788 `0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02` using `proof.childBlockTimestamp` if unpinned).
2. Verifies a depth-3 SHA-256 SSZ Merkle branch (`proof.stateRootBranch`, leaf index `3`) from `canonicalBeaconBlockRoot` (`BeaconBlockHeader`) to `proof.beaconStateRoot`.
3. Verifies a depth-3 SHA-256 SSZ Merkle branch (`proof.slotBranch`, leaf index `0`) from `canonicalBeaconBlockRoot` to `toLittleEndian64Chunk(proof.beaconSlot)` and computes `snapshotEpoch = beaconSlot / 32`.
4. Verifies a SHA-256 SSZ Merkle alignment branch (`proof.executionHashBranch`, depth `10` for Deneb or `11` for Electra, leaf index `780`) from `proof.beaconStateRoot` to `snapshotBlockHash`, proving `BeaconState.latest_execution_payload_header.block_hash == snapshotBlockHash`.

---

## 4. Eligible Positions & Weight Accounting

### 4.1 Execution Account Balance (`PositionType = 0`)
- **Key**: `walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))`
- **Authentication**:
  - Proven against `snapshotExecutionRoot` via an EIP-1186 MPT account proof (`rlpAccountProofNodes`) for key `keccak256(abi.encodePacked(account))`, decoding canonical RLP `[nonce, balance, storageRoot, codeHash]`.
  - Authorization requires `account == msg.sender` (direct voting) or `account == vote.signer` (offline signed voting).
  - Weight is `balance` in wei (`uint256`, must be `> 0`).

### 4.2 Beacon Validator Stake (`PositionType = 1`)
- **Key**: `validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))`
- **Authentication**:
  - Proven against `snapshotBeaconRoot` via `SSZVerifier.verifyValidatorInBeaconState`:
    1. Computes `validatorRoot = hash_tree_root(Validator)` via SHA-256 precompile (`0x02`).
    2. Traverses the depth-40 `validatorBranch` strictly along `validatorIndex` (`< 2^40`).
    3. Mixes in `validatorsLengthChunk` (verifying `validatorIndex < validatorCount`) and traverses `beaconStateBranch` (depth `5` Deneb or `6` Electra) at `BeaconState` field `11`.
  - **Eligibility Conditions**:
    - `slashed == false`
    - `activationEpoch <= snapshotEpoch < exitEpoch`
    - `withdrawalCredentials[0] == 0x01 || withdrawalCredentials[0] == 0x02`
    - `address(uint160(uint256(withdrawalCredentials))) == voter`
  - **Weight**: `uint256(effectiveBalanceGwei) * 1e9` wei (`> 0`).

### 4.3 Multi-Position Claims & Uniqueness
- Both `voteDirect` (on-chain) and a signed `Vote` (offline batch) allow a single ETH holder to prove their execution wallet balance **and** multiple `0x01`/`0x02` validators in one submission.
- Each counted position is recorded under its canonical `walletKey` or `validatorKey` so no wallet balance or validator index can ever vote twice on the same topic.
