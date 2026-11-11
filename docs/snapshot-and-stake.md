# Therdal Protocol v0.1 — Snapshot Authentication & Stake Eligibility

## 1. Snapshot Lifecycle: Pin at Creation, Authenticate Before Settlement

Per architectural decision A2, resolution creation is lightweight and gas-efficient:
1. **Creation (`createResolution`)**:
   - The creator specifies:
     - `snapshotBlockNumber` (`uint64`, must be `< block.number`)
     - `snapshotBeaconTimestamp` (`uint64`, timestamp of the child block carrying the EIP-4788 parent beacon block root, or `0` if validator voting is disabled)
     - `snapshotEpoch` (`uint64`, consensus epoch corresponding to the beacon snapshot)
   - At creation time, `snapshotAuthenticated` is `false` (unless authenticated inline).
2. **Authentication (`authenticateSnapshot`)**:
   - Anyone can call `authenticateSnapshot(uint256 resolutionId, SnapshotAuthProof calldata proof)` at any time after creation and prior to settling the first batch (`nextBatchToSettle == 0`).
   - Once authenticated, `snapshotExecutionRoot` and `snapshotBeaconRoot` are permanently pinned in `ResolutionState`.
   - `settleBatch` requires `snapshotAuthenticated == true` and binds both roots into the STARK proof public inputs.

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
