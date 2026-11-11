# Therdal Protocol v0.2 — Proof Public Inputs Specification

## 1. Public Input Structure (`BatchPublicInputs`)

When `Therdal.settleBatch` is called for `(resolutionId, batchId)`, the settlement contract constructs the following canonical public inputs from on-chain storage and caller transition targets:

```solidity
struct BatchPublicInputs {
    uint256 chainId;
    uint256 resolutionId;
    uint32 rulesetVersion;
    bytes32 snapshotExecutionRoot;
    bytes32 snapshotBeaconRoot;
    uint256 batchId;
    bytes32 registeredBatchCommitment;
    bytes32 oldPositionRoot;
    bytes32 newPositionRoot;
    uint256[3] oldTallies;
    uint256[3] newTallies;
    uint256 oldCountedPositions;
    uint256 newCountedPositions;
    uint256 newlyAcceptedVoteCount;
}
```

### Key v0.2 Addition: `newlyAcceptedVoteCount`
- `newlyAcceptedVoteCount` is the authenticated count of valid signed `Vote` records in `batchId` that contributed **at least one** newly counted eligible ETH position (`weight > 0` absent from `oldPositionRoot`).
- A single voter claiming both their execution wallet balance and `K` validators in one `Vote` increments `newCountedPositions` by `1 + K`, but increments `newlyAcceptedVoteCount` by **1**.
- Invalid, expired, or 100%-duplicate votes increment `newlyAcceptedVoteCount` by **0**.
- Therefore, `0 <= newlyAcceptedVoteCount <= (newCountedPositions - oldCountedPositions)`.

---

## 2. Canonical 608-Byte Public Inputs Digest (`19 * 32` Bytes)

Both `StarkVerifierAdapter.sol` and `circuits/src/batch_transition.rs` compute the exact same 32-byte digest over `19` contiguous 32-byte big-endian ABI words (`608` bytes):

1. `keccak256("THERDAL_PUBLIC_INPUTS_V2")` (`32` bytes)
2. `chainId` (`uint256`, `32` bytes)
3. `resolutionId` (`uint256`, `32` bytes)
4. `rulesetVersion` (`uint256(uint32)`, `32` bytes)
5. `snapshotExecutionRoot` (`bytes32`, `32` bytes)
6. `snapshotBeaconRoot` (`bytes32`, `32` bytes)
7. `batchId` (`uint256`, `32` bytes)
8. `registeredBatchCommitment` (`bytes32`, `32` bytes)
9. `oldPositionRoot` (`bytes32`, `32` bytes)
10. `newPositionRoot` (`bytes32`, `32` bytes)
11. `oldTallies[0]` (`uint256`, `32` bytes)
12. `oldTallies[1]` (`uint256`, `32` bytes)
13. `oldTallies[2]` (`uint256`, `32` bytes)
14. `newTallies[0]` (`uint256`, `32` bytes)
15. `newTallies[1]` (`uint256`, `32` bytes)
16. `newTallies[2]` (`uint256`, `32` bytes)
17. `oldCountedPositions` (`uint256`, `32` bytes)
18. `newCountedPositions` (`uint256`, `32` bytes)
19. `newlyAcceptedVoteCount` (`uint256`, `32` bytes)
