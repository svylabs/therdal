# Therdal Protocol v0.1 — Snapshot Authentication & Stake Eligibility

## 1. Snapshot Lifecycle: Pin at Creation, Authenticate Before Settlement

Per architectural decision A2, topic creation automatically pins the parent Ethereum block with minimal gas overhead:
1. **Creation (`createTopic` / `createTopicWithConfig`)**:
   - When a topic is registered on `Therdal.sol`, the contract automatically records:
     - `snapshotBlock = uint64(block.number - 1)`
     - `snapshotBlockHash = blockhash(block.number - 1)`
   - Because `blockhash(block.number - 1)` is always available in the EVM during execution, the canonical parent block hash is pinned immediately at creation with zero creator-supplied trust assumptions.
2. **Authentication Before Settlement (Upcoming Settlement Stage)**:
   - Prior to settling batches, anyone supplies the RLP execution header matching `snapshotBlockHash` (or EIP-2935 fallback) and the aligned EIP-4788 beacon state root proof.
   - Once authenticated, `snapshotExecutionRoot` and `snapshotBeaconRoot` bind directly into the STARK proof public inputs.

---

## 2. Execution Layer Snapshot Authentication
`SnapshotAuthenticator.sol` verifies `snapshotExecutionRoot` for `snapshotBlockNumber`:
1. Resolves `canonicalBlockHash`:
   - If `block.number - snapshotBlockNumber <= 256`, uses `blockhash(snapshotBlockNumber)`.
   - Otherwise, queries the EIP-2935 History Storage contract (`0x0000F90827F1C53a10cb7A02335B175320002935`) via `staticcall(abi.encode(uint256(snapshotBlockNumber)))`.
2. Checks `keccak256(proof.rlpExecutionHeader) == canonicalBlockHash`.
3. RLP-decodes `rlpExecutionHeader`, verifies field `8` (`number`) equals `snapshotBlockNumber`, and extracts field `3` (`stateRoot`) as `snapshotExecutionRoot`.

---

## 3. Beacon Layer Snapshot Authentication
When validator stake voting is enabled (`snapshotBeaconTimestamp != 0`):
1. Queries the EIP-4788 Beacon Roots contract (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) with `uint256(snapshotBeaconTimestamp)` to obtain `canonicalBeaconBlockRoot`.
2. Verifies a depth-3 SHA-256 SSZ Merkle branch (`proof.stateRootBranch`, generalized leaf index `3`) from `canonicalBeaconBlockRoot` (`BeaconBlockHeader`) to `proof.beaconStateRoot`.
3. Verifies a SHA-256 SSZ Merkle alignment branch (`proof.executionHashBranch`) from `proof.beaconStateRoot` to `canonicalBlockHash`, proving that the execution snapshot and beacon snapshot represent the exact same point in Ethereum history.
4. Stores `snapshotBeaconRoot = proof.beaconStateRoot`.

---

## 4. Eligible Positions & Weight Accounting

### 4.1 Execution Account Balance (`PositionType = 0`)
- **Key**: `walletKey = keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))`
- **Authentication**:
  - Proven against `snapshotExecutionRoot` via an EIP-1186 MPT account proof for key `keccak256(abi.encodePacked(account))`, decoding RLP `[nonce, balance, storageRoot, codeHash]`.
  - Authorization requires `account == vote.signer`.
  - Weight is `balance` in wei (`uint256`).

### 4.2 Beacon Validator Stake (`PositionType = 1`)
- **Key**: `validatorKey = keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))`
- **Authentication**:
  - Proven against `snapshotBeaconRoot` via an SSZ SHA-256 Merkle inclusion branch of the `Validator` container (`pubkeyRoot`, `withdrawalCredentials`, `effectiveBalanceGwei`, `slashed`, `activationEligibilityEpoch`, `activationEpoch`, `exitEpoch`, `withdrawableEpoch`).
  - **Eligibility Conditions**:
    - `slashed == false`
    - `activationEpoch <= snapshotEpoch < exitEpoch`
    - `withdrawalCredentials[0] == 0x01 || withdrawalCredentials[0] == 0x02`
    - `address(uint160(uint256(withdrawalCredentials))) == vote.signer`
  - **Weight**: `uint256(effectiveBalanceGwei) * 1e9` wei.

### 4.3 Multi-Position Claims & Uniqueness
- A single `Vote` signed by `vote.signer` can claim the signer's execution wallet balance **and** multiple validators whose `0x01`/`0x02` withdrawal credentials point to `vote.signer`.
- Each claimed position has its own distinct key (`walletKey` or `validatorKey`) in the 256-bit SMT and increments `countedPositions` by `1` per unique eligible position with `weight > 0`.
