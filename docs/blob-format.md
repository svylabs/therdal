# Therdal Protocol v0.1 — Canonical Blob Format & KZG-to-STARK Binding

## 1. Overview
Votes are published in EIP-4844 blobs via `publishBatch(resolutionId, blobCount)`. Because the EVM only exposes each blob's 32-byte `versionedHash` via the `BLOBHASH` opcode, the off-chain prover must decode the blob bytes deterministically and prove inside the STARK circuit that the decoded vote records match the on-chain `commitmentRoot`.

---

## 2. Field Element Packing (`BLS12-381` Scalar Field)
An EIP-4844 blob consists of `4,096` field elements, each 32 bytes (`131,072` bytes total), where each 32-byte big-endian chunk must be strictly less than `BLS_MODULUS`.

- **Canonical 31-Byte Packing**:
  - For every 32-byte field element `FE[k]` (`k in 0..4096`):
    - Byte `0` (most significant byte) MUST be `0x00`.
    - Bytes `1..32` carry `31` bytes of the contiguous batch byte stream (`126,976` usable payload bytes per blob).
  - If Byte `0 != 0x00` in any field element, the blob is non-canonical.

---

## 3. Batch Stream Binary Layout (`THERDAL_BLOB_V1`)
Across the `blobCount` concatenated payload streams (`blobCount * 126,976` bytes), the canonical batch payload begins at byte offset `0`:

| Offset | Field | Type | Description |
| --- | --- | --- | --- |
| `0..8` | `magic` | `[u8; 8]` | ASCII `"THDLBLOB"` (`0x5448444c424c4f42`) |
| `8..12` | `version` | `u32` (BE) | Format version (`1`) |
| `12..44` | `resolutionId` | `u256` (BE) | Target resolution ID |
| `44..52` | `batchId` | `u64` (BE) | Sequential batch ID (`0, 1, ...`) |
| `52..56` | `voteCount` | `u32` (BE) | Number of encoded `Vote` records |
| `56..60` | `payloadLen` | `u32` (BE) | Total byte length of all encoded `Vote` records |
| `60..60+payloadLen` | `records` | `VoteRecord[]` | Length-prefixed (`u32` BE) canonical `Vote` records |
| `60+payloadLen..end` | `padding` | `0x00 *` | All trailing bytes MUST be `0x00` |

### Canonical Vote Record Binary Encoding
Each `VoteRecord` inside `records` is encoded in big-endian order:
1. `recordByteLen`: `u32` (BE)
2. `choice`: `u8` (`0 = Yes`, `1 = No`, `2 = Abstain`)
3. `signer`: `[u8; 20]` (Ethereum address)
4. `nonceOrVoteId`: `[u8; 32]`
5. `deadline`: `u64` (BE)
6. `signature`: `[u8; 65]` (`r (32) || s (32) || v (1)`)
7. `positionClaimCount`: `u16` (BE)
8. `positionClaims`: `PositionClaim[positionClaimCount]`:
   - `positionType`: `u8` (`0 = Wallet`, `1 = Validator`)
   - `id`: `[u8; 32]` (`bytes32(uint256(uint160(account)))` or `bytes32(uint256(validatorIndex))`)

---

## 4. KZG-to-STARK Commitment Binding
1. **On-Chain Registration**:
   - `BatchRegistry` reads `blobHashes[0..blobCount-1]` via `blobhash(i)` and stores:
     ```solidity
     commitmentRoot = keccak256(abi.encodePacked(blobHashes));
     ```
2. **In-Circuit Verification (`circuits/src/blob_binding.rs`)**:
   - The circuit receives `registeredBatchCommitment` (`commitmentRoot`) as a public input and the raw blobs + KZG commitment openings as witness.
   - It verifies `keccak256(concat(blobVersionedHashes)) == registeredBatchCommitment`.
   - For each blob `i`:
     - Verifies `versionedHash[i][0] == 0x01` and `versionedHash[i][1..32] == sha256(kzgCommitment[i])[1..32]`.
     - Derives the deterministic Fiat-Shamir evaluation challenge `z_i = keccak256("THERDAL_BARYCENTRIC_V1", versionedHash[i], keccak256(blobBytes[i]))`.
     - Computes the polynomial evaluation `y_i = P_i(z_i)` in the BLS12-381 scalar field `Fr` over the 4,096 roots of unity and verifies the opening proof against `kzgCommitment[i]`.
   - Any modification to the decoded vote sequence changes `keccak256(blobBytes[i])`, `z_i`, and `y_i`, breaking the commitment opening.
