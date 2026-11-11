/**
 * Canonical RLP encoder/decoder and EIP-1186 Merkle Patricia Trie (MPT) account proof
 * verifier/builder matching `RLPReader.sol`, `MerklePatriciaProofVerifier.sol`, and `therdal-voting`.
 */

import { bytesToHex, keccak256Bytes } from "./keccak256.ts";

export type DirectVotingErrorCode =
  | "InvalidHex"
  | "InvalidRLPEncoding"
  | "NonCanonicalRLP"
  | "RLPItemNotList"
  | "RLPItemIsList"
  | "RLPValueTooLarge"
  | "RLPUnexpectedLength"
  | "ExecutionHeaderHashMismatch"
  | "InvalidRLPHeaderFieldCount"
  | "ExecutionBlockNumberMismatch"
  | "EmptyExecutionStateRoot"
  | "EmptyStateRoot"
  | "InvalidMPTProof"
  | "AccountNotFoundInTrie"
  | "MPTNodeHashMismatch"
  | "MPTPathMismatch"
  | "ZeroVotingWeight"
  | "BeaconRootUnavailable"
  | "InvalidBeaconStateRootProof"
  | "InvalidBeaconSlotProof"
  | "InvalidExecutionConsensusAlignment"
  | "ValidatorIndexOutOfRange"
  | "ValidatorSlashed"
  | "ValidatorNotActiveAtSnapshot"
  | "UnsupportedWithdrawalPrefix"
  | "UnauthorizedWithdrawalAddress"
  | "InvalidValidatorProof";

export class DirectVotingError extends Error {
  readonly code: DirectVotingErrorCode;

  constructor(code: DirectVotingErrorCode, message: string) {
    super(message);
    this.name = "DirectVotingError";
    this.code = code;
  }
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new DirectVotingError("InvalidHex", `Invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface RlpItem {
  readonly raw: Uint8Array;
  readonly offset: number;
  readonly payloadLen: number;
  readonly isList: boolean;
}

function decodeOffsetAndLen(slice: Uint8Array): { offset: number; payloadLen: number; isList: boolean } {
  if (slice.length === 0) {
    throw new DirectVotingError("InvalidRLPEncoding", "Empty RLP slice.");
  }
  const b0 = slice[0];
  if (b0 < 0x80) {
    return { offset: 0, payloadLen: 1, isList: false };
  }
  if (b0 < 0xb8) {
    const len = b0 - 0x80;
    if (1 + len > slice.length) {
      throw new DirectVotingError("InvalidRLPEncoding", "Short string truncated.");
    }
    if (len === 1 && slice[1] < 0x80) {
      throw new DirectVotingError("NonCanonicalRLP", "Single byte < 0x80 wrapped with 0x81.");
    }
    return { offset: 1, payloadLen: len, isList: false };
  }
  if (b0 < 0xc0) {
    const lenOfLen = b0 - 0xb8 + 1;
    const offset = 1 + lenOfLen;
    if (offset > slice.length) {
      throw new DirectVotingError("InvalidRLPEncoding", "Long string length truncated.");
    }
    const len = readCanonicalLen(slice.subarray(1, offset));
    if (offset + len > slice.length) {
      throw new DirectVotingError("InvalidRLPEncoding", "Long string payload truncated.");
    }
    return { offset, payloadLen: len, isList: false };
  }
  if (b0 < 0xf8) {
    const len = b0 - 0xc0;
    if (1 + len > slice.length) {
      throw new DirectVotingError("InvalidRLPEncoding", "Short list truncated.");
    }
    return { offset: 1, payloadLen: len, isList: true };
  }
  const lenOfLen = b0 - 0xf8 + 1;
  const offset = 1 + lenOfLen;
  if (offset > slice.length) {
    throw new DirectVotingError("InvalidRLPEncoding", "Long list length truncated.");
  }
  const len = readCanonicalLen(slice.subarray(1, offset));
  if (offset + len > slice.length) {
    throw new DirectVotingError("InvalidRLPEncoding", "Long list payload truncated.");
  }
  return { offset, payloadLen: len, isList: true };
}

function readCanonicalLen(lenBytes: Uint8Array): number {
  if (lenBytes.length === 0 || lenBytes.length > 6) {
    throw new DirectVotingError("InvalidRLPEncoding", "Invalid RLP length prefix size.");
  }
  if (lenBytes[0] === 0) {
    throw new DirectVotingError("NonCanonicalRLP", "Leading zero in RLP length prefix.");
  }
  let acc = 0;
  for (const b of lenBytes) {
    acc = acc * 256 + b;
  }
  if (acc <= 55) {
    throw new DirectVotingError("NonCanonicalRLP", "Short payload encoded with long prefix.");
  }
  return acc;
}

export function parseRlpItem(raw: Uint8Array): RlpItem {
  if (raw.length === 0) {
    throw new DirectVotingError("InvalidRLPEncoding", "Empty RLP input.");
  }
  const { offset, payloadLen, isList } = decodeOffsetAndLen(raw);
  if (offset + payloadLen !== raw.length) {
    throw new DirectVotingError("InvalidRLPEncoding", "Trailing bytes after RLP item.");
  }
  return { raw, offset, payloadLen, isList };
}

export function rlpToList(item: RlpItem): RlpItem[] {
  if (!item.isList) {
    throw new DirectVotingError("RLPItemNotList", "Expected RLP list.");
  }
  const items: RlpItem[] = [];
  let pos = item.offset;
  const end = item.offset + item.payloadLen;
  while (pos < end) {
    const sub = item.raw.subarray(pos, end);
    const { offset, payloadLen, isList } = decodeOffsetAndLen(sub);
    const elemLen = offset + payloadLen;
    items.push({
      raw: item.raw.subarray(pos, pos + elemLen),
      offset,
      payloadLen,
      isList,
    });
    pos += elemLen;
  }
  if (pos !== end) {
    throw new DirectVotingError("InvalidRLPEncoding", "Malformed RLP list boundary.");
  }
  return items;
}

export function rlpToBytes(item: RlpItem): Uint8Array {
  if (item.isList) {
    throw new DirectVotingError("RLPItemIsList", "Expected RLP byte string.");
  }
  return item.raw.subarray(item.offset, item.offset + item.payloadLen);
}

export function rlpToBytes32Strict(item: RlpItem): Uint8Array {
  const b = rlpToBytes(item);
  if (b.length !== 32) {
    throw new DirectVotingError("RLPUnexpectedLength", `Expected 32 bytes, got ${b.length}.`);
  }
  return b;
}

export function rlpToUint(item: RlpItem): bigint {
  const b = rlpToBytes(item);
  if (b.length > 32) {
    throw new DirectVotingError("RLPValueTooLarge", "RLP integer exceeds 32 bytes.");
  }
  if (b.length === 0) {
    return 0n;
  }
  if (b[0] === 0) {
    throw new DirectVotingError("NonCanonicalRLP", "Leading zero in RLP integer.");
  }
  let acc = 0n;
  for (const byte of b) {
    acc = (acc << 8n) | BigInt(byte);
  }
  return acc;
}

// -----------------------------------------------------------------------------
// Canonical RLP Encoders & MPT Builders/Verifiers
// -----------------------------------------------------------------------------

function toMinimalBe(val: bigint): Uint8Array {
  let rem = val;
  const bytes: number[] = [];
  while (rem > 0n) {
    bytes.unshift(Number(rem & 0xffn));
    rem >>= 8n;
  }
  return Uint8Array.from(bytes);
}

export function encodeRlpBytes(data: Uint8Array): Uint8Array {
  if (data.length === 1 && data[0] < 0x80) {
    return data;
  }
  if (data.length <= 55) {
    return concatBytes([Uint8Array.from([0x80 + data.length]), data]);
  }
  const lb = toMinimalBe(BigInt(data.length));
  return concatBytes([Uint8Array.from([0xb7 + lb.length]), lb, data]);
}

export function encodeRlpUint(val: bigint | number): Uint8Array {
  const v = BigInt(val);
  if (v === 0n) {
    return Uint8Array.from([0x80]);
  }
  return encodeRlpBytes(toMinimalBe(v));
}

export function encodeRlpList(encodedItems: readonly Uint8Array[]): Uint8Array {
  const payload = concatBytes(encodedItems);
  if (payload.length <= 55) {
    return concatBytes([Uint8Array.from([0xc0 + payload.length]), payload]);
  }
  const lb = toMinimalBe(BigInt(payload.length));
  return concatBytes([Uint8Array.from([0xf7 + lb.length]), lb, payload]);
}

const utf8 = new TextEncoder();

export function buildExecutionHeader(
  blockNumber: bigint | number,
  stateRoot: Uint8Array,
  timestamp: bigint | number,
  parentBeaconBlockRoot: Uint8Array = new Uint8Array(32)
): { rlpHeader: Uint8Array; blockHash: `0x${string}`; blockHashBytes: Uint8Array } {
  const feeRecipient = new Uint8Array(20);
  feeRecipient[18] = 0x0f;
  feeRecipient[19] = 0xee;

  const fields = [
    encodeRlpBytes(keccak256Bytes(utf8.encode("parent_hash"))),
    encodeRlpBytes(keccak256Bytes(utf8.encode("ommers_hash"))),
    encodeRlpBytes(feeRecipient),
    encodeRlpBytes(stateRoot),
    encodeRlpBytes(keccak256Bytes(utf8.encode("tx_root"))),
    encodeRlpBytes(keccak256Bytes(utf8.encode("receipts_root"))),
    encodeRlpBytes(new Uint8Array(256)),
    encodeRlpUint(0n),
    encodeRlpUint(BigInt(blockNumber)),
    encodeRlpUint(30_000_000n),
    encodeRlpUint(15_000_000n),
    encodeRlpUint(BigInt(timestamp)),
    encodeRlpBytes(utf8.encode("therdal-snapshot")),
    encodeRlpBytes(keccak256Bytes(utf8.encode("prev_randao"))),
    encodeRlpBytes(new Uint8Array(8)),
    encodeRlpUint(10_000_000_000n),
    encodeRlpBytes(keccak256Bytes(utf8.encode("withdrawals_root"))),
    encodeRlpUint(0n),
    encodeRlpUint(0n),
    encodeRlpBytes(parentBeaconBlockRoot),
  ];

  const rlpHeader = encodeRlpList(fields);
  const blockHashBytes = keccak256Bytes(rlpHeader);
  return { rlpHeader, blockHash: bytesToHex(blockHashBytes), blockHashBytes };
}

export function authenticateExecutionHeader(
  expectedBlockNumber: bigint | number,
  pinnedBlockHash: Uint8Array,
  rlpExecutionHeader: Uint8Array
): Uint8Array {
  const actualHash = keccak256Bytes(rlpExecutionHeader);
  if (!equalBytes(actualHash, pinnedBlockHash)) {
    throw new DirectVotingError(
      "ExecutionHeaderHashMismatch",
      `Expected block hash ${bytesToHex(pinnedBlockHash)}, got ${bytesToHex(actualHash)}.`
    );
  }

  const fields = rlpToList(parseRlpItem(rlpExecutionHeader));
  if (fields.length < 15) {
    throw new DirectVotingError(
      "InvalidRLPHeaderFieldCount",
      `Expected >= 15 RLP header fields, got ${fields.length}.`
    );
  }

  const decodedNum = rlpToUint(fields[8]);
  if (decodedNum !== BigInt(expectedBlockNumber)) {
    throw new DirectVotingError(
      "ExecutionBlockNumberMismatch",
      `Expected block #${expectedBlockNumber}, got #${decodedNum}.`
    );
  }

  const stateRoot = rlpToBytes32Strict(fields[3]);
  if (equalBytes(stateRoot, new Uint8Array(32))) {
    throw new DirectVotingError("EmptyExecutionStateRoot", "Header stateRoot is zero.");
  }
  return stateRoot;
}

function toNibbles(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = bytes[i] >> 4;
    out[i * 2 + 1] = bytes[i] & 0x0f;
  }
  return out;
}

function decodeCompactPath(compact: Uint8Array): { isLeaf: boolean; nibbles: Uint8Array } {
  if (compact.length === 0) {
    throw new DirectVotingError("InvalidMPTProof", "Empty compact path.");
  }
  const first = compact[0];
  const prefix = first >> 4;
  if (prefix > 3) {
    throw new DirectVotingError("InvalidMPTProof", "Invalid compact path prefix.");
  }
  const isLeaf = prefix >= 2;
  const isOdd = prefix % 2 === 1;
  const nibbles = new Uint8Array((compact.length - 1) * 2 + (isOdd ? 1 : 0));
  let idx = 0;
  if (isOdd) {
    nibbles[idx++] = first & 0x0f;
  } else if ((first & 0x0f) !== 0) {
    throw new DirectVotingError("InvalidMPTProof", "Non-zero low nibble on even compact path.");
  }
  for (let i = 1; i < compact.length; i++) {
    nibbles[idx++] = compact[i] >> 4;
    nibbles[idx++] = compact[i] & 0x0f;
  }
  return { isLeaf, nibbles };
}

export function encodeCompactPath(nibbles: Uint8Array, isLeaf: boolean): Uint8Array {
  const isOdd = nibbles.length % 2 === 1;
  const prefix = (isLeaf ? 2 : 0) + (isOdd ? 1 : 0);
  if (isOdd) {
    const out = new Uint8Array(1 + (nibbles.length - 1) / 2);
    out[0] = (prefix << 4) | (nibbles[0] & 0x0f);
    let idx = 1;
    for (let i = 1; i < nibbles.length; i += 2) {
      out[idx++] = (nibbles[i] << 4) | (nibbles[i + 1] & 0x0f);
    }
    return out;
  }
  const out = new Uint8Array(1 + nibbles.length / 2);
  out[0] = prefix << 4;
  let idx = 1;
  for (let i = 0; i < nibbles.length; i += 2) {
    out[idx++] = (nibbles[i] << 4) | (nibbles[i + 1] & 0x0f);
  }
  return out;
}

export function buildSingleAccountTrie(
  accountAddress: string,
  nonce: bigint | number,
  balanceWei: bigint
): { stateRoot: `0x${string}`; stateRootBytes: Uint8Array; rlpAccountProofNodes: Uint8Array } {
  const addrBytes = hexToBytes(accountAddress);
  if (addrBytes.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Account address must be 20 bytes.");
  }
  const keyHash = keccak256Bytes(addrBytes);
  const hp = encodeCompactPath(toNibbles(keyHash), true);
  const acctVal = encodeRlpList([
    encodeRlpUint(nonce),
    encodeRlpUint(balanceWei),
    encodeRlpBytes(keccak256Bytes(utf8.encode("empty_storage_root"))),
    encodeRlpBytes(keccak256Bytes(utf8.encode("empty_code_hash"))),
  ]);
  const leafNode = encodeRlpList([encodeRlpBytes(hp), encodeRlpBytes(acctVal)]);
  const stateRootBytes = keccak256Bytes(leafNode);
  const rlpAccountProofNodes = encodeRlpList([leafNode]);
  return { stateRoot: bytesToHex(stateRootBytes), stateRootBytes, rlpAccountProofNodes };
}

export function verifyExecutionBalanceProof(
  snapshotExecutionRoot: Uint8Array,
  voterAddress: string,
  rlpAccountProofNodes: Uint8Array
): bigint {
  if (equalBytes(snapshotExecutionRoot, new Uint8Array(32))) {
    throw new DirectVotingError("EmptyStateRoot", "snapshotExecutionRoot is zero.");
  }
  const addrBytes = hexToBytes(voterAddress);
  if (addrBytes.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Voter address must be 20 bytes.");
  }

  const proof = rlpToList(parseRlpItem(rlpAccountProofNodes));
  if (proof.length === 0 || proof.length > 65) {
    throw new DirectVotingError("InvalidMPTProof", "Invalid MPT proof node count.");
  }

  const keyNibbles = toNibbles(keccak256Bytes(addrBytes));
  let nibbleIndex = 0;
  let expectedHash = snapshotExecutionRoot;
  let expectedEmbedded = false;
  let accountRlp: Uint8Array | null = null;

  for (let i = 0; i < proof.length; i++) {
    const nodeItem = proof[i];
    const actualHash = keccak256Bytes(nodeItem.raw);
    if (i === 0) {
      if (!equalBytes(actualHash, expectedHash)) {
        throw new DirectVotingError("MPTNodeHashMismatch", "Root MPT node hash mismatch.");
      }
    } else if (expectedEmbedded) {
      if (nodeItem.raw.length >= 32 || !equalBytes(actualHash, expectedHash)) {
        throw new DirectVotingError("InvalidMPTProof", "Invalid embedded MPT node.");
      }
    } else {
      if (nodeItem.raw.length < 32) {
        throw new DirectVotingError("InvalidMPTProof", "Non-embedded node < 32 bytes.");
      }
      if (!equalBytes(actualHash, expectedHash)) {
        throw new DirectVotingError("MPTNodeHashMismatch", "Child MPT node hash mismatch.");
      }
    }

    const fields = rlpToList(nodeItem);
    if (fields.length === 17) {
      if (nibbleIndex === keyNibbles.length) {
        if (i !== proof.length - 1) {
          throw new DirectVotingError("InvalidMPTProof", "Extra nodes after branch value.");
        }
        accountRlp = rlpToBytes(fields[16]);
        break;
      }
      const nib = keyNibbles[nibbleIndex++];
      if (i === proof.length - 1) {
        throw new DirectVotingError("InvalidMPTProof", "Truncated MPT proof at branch.");
      }
      const childRef = fields[nib];
      if (childRef.isList) {
        if (childRef.raw.length >= 32) {
          throw new DirectVotingError("InvalidMPTProof", "Oversized embedded child.");
        }
        expectedHash = keccak256Bytes(childRef.raw);
        expectedEmbedded = true;
      } else {
        const refBytes = rlpToBytes(childRef);
        if (refBytes.length === 0) {
          throw new DirectVotingError("AccountNotFoundInTrie", "Account absent at branch slot.");
        }
        expectedHash = rlpToBytes32Strict(childRef);
        expectedEmbedded = false;
      }
    } else if (fields.length === 2) {
      const { isLeaf, nibbles: nodeNibbles } = decodeCompactPath(rlpToBytes(fields[0]));
      if (nibbleIndex + nodeNibbles.length > keyNibbles.length) {
        throw new DirectVotingError("MPTPathMismatch", "MPT path exceeds 64 nibbles.");
      }
      for (let j = 0; j < nodeNibbles.length; j++) {
        if (keyNibbles[nibbleIndex + j] !== nodeNibbles[j]) {
          throw new DirectVotingError("MPTPathMismatch", "MPT nibble mismatch.");
        }
      }
      nibbleIndex += nodeNibbles.length;
      if (isLeaf) {
        if (i !== proof.length - 1 || nibbleIndex !== keyNibbles.length) {
          throw new DirectVotingError("MPTPathMismatch", "Leaf depth mismatch.");
        }
        accountRlp = rlpToBytes(fields[1]);
        break;
      } else {
        if (nodeNibbles.length === 0 || i === proof.length - 1) {
          throw new DirectVotingError("InvalidMPTProof", "Invalid extension node.");
        }
        const childRef = fields[1];
        if (childRef.isList) {
          if (childRef.raw.length >= 32) {
            throw new DirectVotingError("InvalidMPTProof", "Oversized embedded child.");
          }
          expectedHash = keccak256Bytes(childRef.raw);
          expectedEmbedded = true;
        } else {
          expectedHash = rlpToBytes32Strict(childRef);
          expectedEmbedded = false;
        }
      }
    } else {
      throw new DirectVotingError("InvalidMPTProof", "Unexpected MPT node arity.");
    }
  }

  if (accountRlp === null || accountRlp.length === 0) {
    throw new DirectVotingError("AccountNotFoundInTrie", "Account value missing.");
  }

  const acctFields = rlpToList(parseRlpItem(accountRlp));
  if (acctFields.length !== 4) {
    throw new DirectVotingError("InvalidMPTProof", "Account tuple must have 4 fields.");
  }
  rlpToUint(acctFields[0]); // nonce canonical check
  const balanceWei = rlpToUint(acctFields[1]);
  rlpToBytes32Strict(acctFields[2]); // storageRoot
  rlpToBytes32Strict(acctFields[3]); // codeHash

  if (balanceWei === 0n) {
    throw new DirectVotingError("ZeroVotingWeight", "Account snapshot balance is 0 wei.");
  }
  return balanceWei;
}
