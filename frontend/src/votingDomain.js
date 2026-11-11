// Pure Stage 2 Direct Snapshot Voting domain module (zero DOM coupling)
// Matches `contracts/Therdal.sol`, `voting/`, and `sdk/src/voting.ts` byte-for-byte.

import { bytesToHex, keccak256Bytes } from "./topicDomain.js";

export const WALLET_DOMAIN_TAG = "THERDAL_WALLET";
export const VALIDATOR_DOMAIN_TAG = "THERDAL_VALIDATOR";
export const SLOTS_PER_EPOCH = 32n;
export const VALIDATOR_REGISTRY_DEPTH = 40;
export const VALIDATOR_REGISTRY_LIMIT = 1n << 40n;
export const BEACON_STATE_VALIDATORS_FIELD_INDEX = 11n;
export const EXECUTION_BLOCK_HASH_LEAF_INDEX = 780n; // (24 << 5) | 12
export const GWEI_TO_WEI = 1_000_000_000n;
export const ETH_TO_WEI = 1_000_000_000_000_000_000n;

export const PositionType = {
  ExecutionWallet: 0,
  BeaconValidator: 1,
};

const utf8 = new TextEncoder();

export class DirectVotingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DirectVotingError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Pure FIPS 180-4 SHA-256 (matching EVM precompile 0x02 & SSZVerifier.sol)
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const SHA256_H0 = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

function rotr32(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

export function sha256Bytes(data) {
  const bitLen = BigInt(data.length) * 8n;
  const rem = (data.length + 9) % 64;
  const padZeros = rem === 0 ? 0 : 64 - rem;
  const totalLen = data.length + 1 + padZeros + 8;

  const padded = new Uint8Array(totalLen);
  padded.set(data, 0);
  padded[data.length] = 0x80;
  let remBits = bitLen;
  for (let i = 7; i >= 0; i--) {
    padded[totalLen - 8 + i] = Number(remBits & 0xffn);
    remBits >>= 8n;
  }

  const state = new Uint32Array(SHA256_H0);
  const w = new Uint32Array(64);
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, state[i], false);
  }
  return out;
}

export function sha256Pair(left, right) {
  const pair = new Uint8Array(64);
  pair.set(left, 0);
  pair.set(right, 32);
  return sha256Bytes(pair);
}

let cachedZeroHashes = null;
export function computeSszZeroHashes() {
  if (cachedZeroHashes !== null) return cachedZeroHashes;
  const z = new Array(41);
  z[0] = new Uint8Array(32);
  for (let h = 1; h <= 40; h++) {
    z[h] = sha256Pair(z[h - 1], z[h - 1]);
  }
  cachedZeroHashes = z;
  return z;
}

// ---------------------------------------------------------------------------
// Byte & Hex Utilities
// ---------------------------------------------------------------------------

export function hexToBytes(hex) {
  const clean = String(hex).trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new DirectVotingError("InvalidHex", `Invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function concatBytes(chunks) {
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

export function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function encodeUint256Be(value) {
  const out = new Uint8Array(32);
  let rem = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

function encodeUint64Be(value) {
  const out = new Uint8Array(8);
  let rem = BigInt(value);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

export function formatEthFromWei(weiBigInt, decimals = 2) {
  const wei = BigInt(weiBigInt);
  const whole = wei / ETH_TO_WEI;
  const frac = wei % ETH_TO_WEI;
  if (decimals <= 0) return whole.toLocaleString();
  const scale = 10n ** BigInt(18 - decimals);
  const fracDigits = String(frac / scale).padStart(decimals, "0");
  return `${whole.toLocaleString()}.${fracDigits}`;
}

// ---------------------------------------------------------------------------
// Canonical Position Keys (`PositionEligibility.sol`)
// ---------------------------------------------------------------------------

export function computeWalletPositionKey(chainId, accountAddress) {
  const addrBytes = hexToBytes(accountAddress);
  if (addrBytes.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Account address must be 20 bytes.");
  }
  const preimage = concatBytes([
    utf8.encode(WALLET_DOMAIN_TAG),
    encodeUint256Be(chainId),
    addrBytes,
  ]);
  return bytesToHex(keccak256Bytes(preimage));
}

export function computeValidatorPositionKey(chainId, validatorIndex) {
  const preimage = concatBytes([
    utf8.encode(VALIDATOR_DOMAIN_TAG),
    encodeUint256Be(chainId),
    encodeUint64Be(validatorIndex),
  ]);
  return bytesToHex(keccak256Bytes(preimage));
}

// ---------------------------------------------------------------------------
// Canonical RLP Encoder / Decoder (`RLPReader.sol`)
// ---------------------------------------------------------------------------

function toMinimalBe(val) {
  let rem = BigInt(val);
  const bytes = [];
  while (rem > 0n) {
    bytes.unshift(Number(rem & 0xffn));
    rem >>= 8n;
  }
  return Uint8Array.from(bytes);
}

export function encodeRlpBytes(data) {
  if (data.length === 1 && data[0] < 0x80) return data;
  if (data.length <= 55) {
    return concatBytes([Uint8Array.from([0x80 + data.length]), data]);
  }
  const lb = toMinimalBe(data.length);
  return concatBytes([Uint8Array.from([0xb7 + lb.length]), lb, data]);
}

export function encodeRlpUint(val) {
  const v = BigInt(val);
  if (v === 0n) return Uint8Array.from([0x80]);
  return encodeRlpBytes(toMinimalBe(v));
}

export function encodeRlpList(encodedItems) {
  const payload = concatBytes(encodedItems);
  if (payload.length <= 55) {
    return concatBytes([Uint8Array.from([0xc0 + payload.length]), payload]);
  }
  const lb = toMinimalBe(payload.length);
  return concatBytes([Uint8Array.from([0xf7 + lb.length]), lb, payload]);
}

function readCanonicalLen(lenBytes) {
  if (lenBytes.length === 0 || lenBytes.length > 6) {
    throw new DirectVotingError("InvalidRLPEncoding", "Invalid RLP length prefix size.");
  }
  if (lenBytes[0] === 0) {
    throw new DirectVotingError("NonCanonicalRLP", "Leading zero in RLP length prefix.");
  }
  let acc = 0;
  for (const b of lenBytes) acc = acc * 256 + b;
  if (acc <= 55) {
    throw new DirectVotingError("NonCanonicalRLP", "Short payload encoded with long prefix.");
  }
  return acc;
}

function decodeOffsetAndLen(slice) {
  if (slice.length === 0) {
    throw new DirectVotingError("InvalidRLPEncoding", "Empty RLP slice.");
  }
  const b0 = slice[0];
  if (b0 < 0x80) return { offset: 0, payloadLen: 1, isList: false };
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

export function parseRlpItem(raw) {
  if (raw.length === 0) {
    throw new DirectVotingError("InvalidRLPEncoding", "Empty RLP input.");
  }
  const { offset, payloadLen, isList } = decodeOffsetAndLen(raw);
  if (offset + payloadLen !== raw.length) {
    throw new DirectVotingError("InvalidRLPEncoding", "Trailing bytes after RLP item.");
  }
  return { raw, offset, payloadLen, isList };
}

export function rlpToList(item) {
  if (!item.isList) {
    throw new DirectVotingError("RLPItemNotList", "Expected RLP list.");
  }
  const items = [];
  let pos = item.offset;
  const end = item.offset + item.payloadLen;
  while (pos < end) {
    const sub = item.raw.subarray(pos, end);
    const { offset, payloadLen, isList } = decodeOffsetAndLen(sub);
    const elemLen = offset + payloadLen;
    items.push({ raw: item.raw.subarray(pos, pos + elemLen), offset, payloadLen, isList });
    pos += elemLen;
  }
  if (pos !== end) {
    throw new DirectVotingError("InvalidRLPEncoding", "Malformed RLP list boundary.");
  }
  return items;
}

export function rlpToBytes(item) {
  if (item.isList) {
    throw new DirectVotingError("RLPItemIsList", "Expected RLP byte string.");
  }
  return item.raw.subarray(item.offset, item.offset + item.payloadLen);
}

export function rlpToBytes32Strict(item) {
  const b = rlpToBytes(item);
  if (b.length !== 32) {
    throw new DirectVotingError("RLPUnexpectedLength", `Expected 32 bytes, got ${b.length}.`);
  }
  return b;
}

export function rlpToUint(item) {
  const b = rlpToBytes(item);
  if (b.length > 32) {
    throw new DirectVotingError("RLPValueTooLarge", "RLP integer exceeds 32 bytes.");
  }
  if (b.length === 0) return 0n;
  if (b[0] === 0) {
    throw new DirectVotingError("NonCanonicalRLP", "Leading zero in RLP integer.");
  }
  let acc = 0n;
  for (const byte of b) acc = (acc << 8n) | BigInt(byte);
  return acc;
}

// ---------------------------------------------------------------------------
// Execution Header & EIP-1186 Merkle Patricia Trie (`MerklePatriciaProofVerifier.sol`)
// ---------------------------------------------------------------------------

export function buildExecutionHeader(
  blockNumber,
  stateRoot,
  timestamp,
  parentBeaconBlockRoot = new Uint8Array(32)
) {
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
  return { rlpHeader, rlpHeaderHex: bytesToHex(rlpHeader), blockHash: bytesToHex(blockHashBytes), blockHashBytes };
}

export function authenticateExecutionHeader(expectedBlockNumber, pinnedBlockHash, rlpExecutionHeader) {
  const actualHash = keccak256Bytes(rlpExecutionHeader);
  if (!equalBytes(actualHash, pinnedBlockHash)) {
    throw new DirectVotingError(
      "ExecutionHeaderHashMismatch",
      `Expected block hash ${bytesToHex(pinnedBlockHash)}, got ${bytesToHex(actualHash)}.`
    );
  }
  const fields = rlpToList(parseRlpItem(rlpExecutionHeader));
  if (fields.length < 15) {
    throw new DirectVotingError("InvalidRLPHeaderFieldCount", "Expected >= 15 RLP header fields.");
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

function toNibbles(bytes) {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i++) {
    out[i * 2] = bytes[i] >> 4;
    out[i * 2 + 1] = bytes[i] & 0x0f;
  }
  return out;
}

function encodeCompactPath(nibbles, isLeaf) {
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

function decodeCompactPath(compact) {
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

function encodeAccountValueRlp(nonce, balanceWei) {
  return encodeRlpList([
    encodeRlpUint(nonce),
    encodeRlpUint(balanceWei),
    encodeRlpBytes(keccak256Bytes(utf8.encode("empty_storage_root"))),
    encodeRlpBytes(keccak256Bytes(utf8.encode("empty_code_hash"))),
  ]);
}

export function buildSingleAccountTrie(accountAddress, nonce, balanceWei) {
  const addrBytes = hexToBytes(accountAddress);
  const keyHash = keccak256Bytes(addrBytes);
  const hp = encodeCompactPath(toNibbles(keyHash), true);
  const acctVal = encodeAccountValueRlp(nonce, balanceWei);
  const leafNode = encodeRlpList([encodeRlpBytes(hp), encodeRlpBytes(acctVal)]);
  const stateRootBytes = keccak256Bytes(leafNode);
  const rlpAccountProofNodes = encodeRlpList([leafNode]);
  return {
    stateRoot: bytesToHex(stateRootBytes),
    stateRootBytes,
    rlpAccountProofNodes,
    rlpAccountProofHex: bytesToHex(rlpAccountProofNodes),
  };
}

function buildRadixNode(entries, depth) {
  if (entries.length === 1) {
    const rem = entries[0].nibbles.subarray(depth);
    const rlp = encodeRlpList([encodeRlpBytes(encodeCompactPath(rem, true)), encodeRlpBytes(entries[0].valueRlp)]);
    return { rlp, kind: "leaf", entries };
  }

  let lcp = 0;
  const maxRem = entries[0].nibbles.length - depth;
  while (lcp < maxRem) {
    const nib = entries[0].nibbles[depth + lcp];
    if (entries.every((e) => e.nibbles[depth + lcp] === nib)) {
      lcp++;
    } else {
      break;
    }
  }

  if (lcp > 0) {
    const shared = entries[0].nibbles.subarray(depth, depth + lcp);
    const child = buildRadixNode(entries, depth + lcp);
    const childRef = child.rlp.length < 32 ? child.rlp : encodeRlpBytes(keccak256Bytes(child.rlp));
    const rlp = encodeRlpList([encodeRlpBytes(encodeCompactPath(shared, false)), childRef]);
    return { rlp, kind: "extension", sharedLen: lcp, child };
  }

  const buckets = Array.from({ length: 16 }, () => []);
  for (const e of entries) {
    buckets[e.nibbles[depth]].push(e);
  }
  const children = new Array(16).fill(null);
  const branchItems = new Array(17);
  for (let b = 0; b < 16; b++) {
    if (buckets[b].length === 0) {
      branchItems[b] = encodeRlpBytes(new Uint8Array(0));
    } else {
      const child = buildRadixNode(buckets[b], depth + 1);
      children[b] = child;
      branchItems[b] = child.rlp.length < 32 ? child.rlp : encodeRlpBytes(keccak256Bytes(child.rlp));
    }
  }
  branchItems[16] = encodeRlpBytes(new Uint8Array(0));
  const rlp = encodeRlpList(branchItems);
  return { rlp, kind: "branch", children };
}

function collectProofNodes(node, targetNibbles, depth, outNodes) {
  outNodes.push(node.rlp);
  if (node.kind === "leaf") return;
  if (node.kind === "extension") {
    collectProofNodes(node.child, targetNibbles, depth + node.sharedLen, outNodes);
    return;
  }
  const nib = targetNibbles[depth];
  if (node.children[nib]) {
    collectProofNodes(node.children[nib], targetNibbles, depth + 1, outNodes);
  }
}

export function buildMultiAccountTrie(accounts) {
  const entries = accounts.map((acc) => {
    const addrBytes = hexToBytes(acc.address);
    const nibbles = toNibbles(keccak256Bytes(addrBytes));
    const valueRlp = encodeAccountValueRlp(acc.nonce, acc.balanceWei);
    return { address: acc.address.toLowerCase(), nibbles, valueRlp };
  });

  const rootNode = buildRadixNode(entries, 0);
  const stateRootBytes = keccak256Bytes(rootNode.rlp);
  const proofsByAddress = new Map();

  for (const entry of entries) {
    const nodes = [];
    collectProofNodes(rootNode, entry.nibbles, 0, nodes);
    const encodedProof = encodeRlpList(nodes);
    proofsByAddress.set(entry.address, {
      rlpAccountProofNodes: encodedProof,
      rlpAccountProofHex: bytesToHex(encodedProof),
      nodeCount: nodes.length,
    });
  }

  return {
    stateRoot: bytesToHex(stateRootBytes),
    stateRootBytes,
    proofsByAddress,
  };
}

export function verifyExecutionBalanceProof(snapshotExecutionRoot, voterAddress, rlpAccountProofNodes) {
  if (equalBytes(snapshotExecutionRoot, new Uint8Array(32))) {
    throw new DirectVotingError("EmptyStateRoot", "snapshotExecutionRoot is zero.");
  }
  const addrBytes = hexToBytes(voterAddress);
  const proof = rlpToList(parseRlpItem(rlpAccountProofNodes));
  if (proof.length === 0 || proof.length > 65) {
    throw new DirectVotingError("InvalidMPTProof", "Invalid MPT proof node count.");
  }

  const keyNibbles = toNibbles(keccak256Bytes(addrBytes));
  let nibbleIndex = 0;
  let expectedHash = snapshotExecutionRoot;
  let expectedEmbedded = false;
  let accountRlp = null;

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
  rlpToUint(acctFields[0]);
  const balanceWei = rlpToUint(acctFields[1]);
  rlpToBytes32Strict(acctFields[2]);
  rlpToBytes32Strict(acctFields[3]);

  if (balanceWei === 0n) {
    throw new DirectVotingError("ZeroVotingWeight", "Account snapshot balance is 0 wei.");
  }
  return balanceWei;
}

// ---------------------------------------------------------------------------
// SSZ Beacon Snapshot & Depth-40 Validator Proofs (`SSZVerifier.sol`)
// ---------------------------------------------------------------------------

export function toLittleEndian64Chunk(value) {
  const out = new Uint8Array(32);
  let rem = BigInt(value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

export function decodeLittleEndian64Chunk(chunk) {
  if (chunk.length !== 32) return null;
  for (let i = 8; i < 32; i++) {
    if (chunk[i] !== 0) return null;
  }
  let acc = 0n;
  for (let i = 0; i < 8; i++) {
    acc |= BigInt(chunk[i]) << BigInt(i * 8);
  }
  return acc;
}

export function toBoolChunk(value) {
  const out = new Uint8Array(32);
  if (value) out[0] = 1;
  return out;
}

export function makeWithdrawalCredentials(prefix, withdrawalAddress) {
  const addr = hexToBytes(withdrawalAddress);
  const out = new Uint8Array(32);
  out[0] = prefix;
  out.set(addr, 12);
  return bytesToHex(out);
}

export function computeValidatorRoot(params) {
  const pk = typeof params.pubkeyRoot === "string" ? hexToBytes(params.pubkeyRoot) : params.pubkeyRoot;
  const wc =
    typeof params.withdrawalCredentials === "string"
      ? hexToBytes(params.withdrawalCredentials)
      : params.withdrawalCredentials;

  const n00 = sha256Pair(pk, wc);
  const n01 = sha256Pair(toLittleEndian64Chunk(params.effectiveBalanceGwei), toBoolChunk(params.slashed));
  const n02 = sha256Pair(
    toLittleEndian64Chunk(params.activationEligibilityEpoch),
    toLittleEndian64Chunk(params.activationEpoch)
  );
  const n03 = sha256Pair(
    toLittleEndian64Chunk(params.exitEpoch),
    toLittleEndian64Chunk(params.withdrawableEpoch)
  );
  return bytesToHex(sha256Pair(sha256Pair(n00, n01), sha256Pair(n02, n03)));
}

export function computeSszBranchRoot(leaf, branch, leafIndex) {
  let cur = leaf;
  const idx = BigInt(leafIndex);
  for (let i = 0; i < branch.length; i++) {
    const bit = (idx >> BigInt(i)) & 1n;
    cur = bit === 1n ? sha256Pair(branch[i], cur) : sha256Pair(cur, branch[i]);
  }
  return cur;
}

function verifySszBranch(root, leaf, branch, leafIndex) {
  return equalBytes(computeSszBranchRoot(leaf, branch, leafIndex), root);
}

function merkleizePowerOfTwo(leaves, targetIdx) {
  const depth = Math.log2(leaves.length);
  const branch = [];
  let layer = leaves.slice();
  let idx = targetIdx;
  for (let d = 0; d < depth; d++) {
    branch.push(layer[idx ^ 1]);
    const next = [];
    for (let j = 0; j < layer.length; j += 2) {
      next.push(sha256Pair(layer[j], layer[j + 1]));
    }
    layer = next;
    idx >>= 1;
  }
  return { root: layer[0], branch };
}

function buildSparseValidatorTree(validatorEntries) {
  const z = computeSszZeroHashes();
  const levelMaps = Array.from({ length: 41 }, () => new Map());

  for (const v of validatorEntries) {
    levelMaps[0].set(BigInt(v.validatorIndex), hexToBytes(computeValidatorRoot(v)));
  }

  for (let d = 0; d < 40; d++) {
    const cur = levelMaps[d];
    const parentIndices = new Set();
    for (const idx of cur.keys()) {
      parentIndices.add(idx >> 1n);
    }
    for (const pIdx of parentIndices) {
      const left = cur.get(pIdx << 1n) || z[d];
      const right = cur.get((pIdx << 1n) | 1n) || z[d];
      levelMaps[d + 1].set(pIdx, sha256Pair(left, right));
    }
  }

  const dataRoot = levelMaps[40].get(0n) || z[40];
  const branchesByIndex = new Map();
  for (const v of validatorEntries) {
    const idx = BigInt(v.validatorIndex);
    const branch = [];
    for (let d = 0; d < 40; d++) {
      const sibIdx = (idx >> BigInt(d)) ^ 1n;
      const sib = levelMaps[d].get(sibIdx) || z[d];
      branch.push(bytesToHex(sib));
    }
    branchesByIndex.set(idx, branch);
  }
  return { dataRoot, branchesByIndex };
}

/**
 * Builds an authentic multi-account + multi-validator Ethereum snapshot for a topic (`block.number - 1`).
 * Every account MPT proof and every depth-40 validator SSZ proof verifies identically against `Therdal.sol`.
 */
export function buildFullTopicSnapshot({
  snapshotBlock,
  snapshotTimestamp,
  beaconSlot,
  childBlockTimestamp,
  accounts,
  validators,
  validatorCount = 1_050_000n,
}) {
  const trie = buildMultiAccountTrie(accounts);

  // First compute a deterministic placeholder parentBeaconBlockRoot for the execution header,
  // then align the BeaconState's latest_execution_payload_header.block_hash to the exact RLP blockHash!
  const parentBeaconSeed = keccak256Bytes(
    concatBytes([utf8.encode("THERDAL_PARENT_BEACON_SEED_"), encodeUint64Be(snapshotBlock)])
  );
  const execHeader = buildExecutionHeader(
    snapshotBlock,
    trie.stateRootBytes,
    snapshotTimestamp,
    parentBeaconSeed
  );

  const sparseTree = buildSparseValidatorTree(validators);
  const lenChunk = toLittleEndian64Chunk(validatorCount);
  const validatorsListRoot = sha256Pair(sparseTree.dataRoot, lenChunk);

  const execLeaves = Array.from({ length: 32 }, () => new Uint8Array(32));
  execLeaves[12] = execHeader.blockHashBytes;
  execLeaves[6] = toLittleEndian64Chunk(snapshotBlock);
  const { root: execPayloadRoot, branch: execInnerBranch } = merkleizePowerOfTwo(execLeaves, 12);

  // Electra 64-leaf (depth-6) BeaconState
  const stateLeaves = Array.from({ length: 64 }, () => new Uint8Array(32));
  stateLeaves[11] = validatorsListRoot;
  stateLeaves[24] = execPayloadRoot;
  const { root: beaconStateRootBytes, branch: stateBranchVal } = merkleizePowerOfTwo(stateLeaves, 11);
  const { branch: stateBranchExec } = merkleizePowerOfTwo(stateLeaves, 24);

  const executionHashBranch = [...execInnerBranch, ...stateBranchExec].map(bytesToHex);

  const headerLeaves = Array.from({ length: 8 }, () => new Uint8Array(32));
  headerLeaves[0] = toLittleEndian64Chunk(beaconSlot);
  headerLeaves[1] = toLittleEndian64Chunk(7n);
  headerLeaves[2] = parentBeaconSeed;
  headerLeaves[3] = beaconStateRootBytes;
  headerLeaves[4] = keccak256Bytes(utf8.encode("beacon_body_root"));

  const { root: beaconBlockRootBytes, branch: slotBranch } = merkleizePowerOfTwo(headerLeaves, 0);
  const { branch: stateRootBranch } = merkleizePowerOfTwo(headerLeaves, 3);

  const validatorProofsByIndex = new Map();
  for (const v of validators) {
    const idx = BigInt(v.validatorIndex);
    validatorProofsByIndex.set(Number(idx), {
      ...v,
      validatorIndex: idx,
      validatorBranch: sparseTree.branchesByIndex.get(idx),
      validatorsLengthChunk: bytesToHex(lenChunk),
      beaconStateBranch: stateBranchVal.map(bytesToHex),
    });
  }

  return {
    snapshotBlock,
    snapshotBlockHash: execHeader.blockHash,
    snapshotBlockHashBytes: execHeader.blockHashBytes,
    rlpExecutionHeader: execHeader.rlpHeader,
    rlpExecutionHeaderHex: execHeader.rlpHeaderHex,
    expectedExecutionRoot: trie.stateRoot,
    accountProofsByAddress: trie.proofsByAddress,
    snapshotBeaconBlockRoot: bytesToHex(beaconBlockRootBytes),
    snapshotBeaconBlockRootBytes: beaconBlockRootBytes,
    expectedBeaconStateRoot: bytesToHex(beaconStateRootBytes),
    beaconSlot: BigInt(beaconSlot),
    expectedSnapshotEpoch: BigInt(beaconSlot) / SLOTS_PER_EPOCH,
    beaconAuth: {
      childBlockTimestamp: BigInt(childBlockTimestamp),
      beaconSlot: BigInt(beaconSlot),
      slotBranch: slotBranch.map(bytesToHex),
      beaconStateRoot: bytesToHex(beaconStateRootBytes),
      stateRootBranch: stateRootBranch.map(bytesToHex),
      executionHashBranch,
    },
    validatorProofsByIndex,
  };
}

export function authenticateBeaconSnapshot(pinnedExecutionBlockHash, canonicalBeaconBlockRoot, proof) {
  if (equalBytes(canonicalBeaconBlockRoot, new Uint8Array(32))) {
    throw new DirectVotingError("BeaconRootUnavailable", "Canonical beacon block root is zero.");
  }

  const stateRoot = hexToBytes(proof.beaconStateRoot);
  const stateRootBranch = proof.stateRootBranch.map(hexToBytes);
  if (
    stateRoot.length !== 32 ||
    equalBytes(stateRoot, new Uint8Array(32)) ||
    stateRootBranch.length !== 3 ||
    !verifySszBranch(canonicalBeaconBlockRoot, stateRoot, stateRootBranch, 3n)
  ) {
    throw new DirectVotingError("InvalidBeaconStateRootProof", "Invalid beacon state_root branch.");
  }

  const slotBranch = proof.slotBranch.map(hexToBytes);
  if (
    slotBranch.length !== 3 ||
    !verifySszBranch(
      canonicalBeaconBlockRoot,
      toLittleEndian64Chunk(proof.beaconSlot),
      slotBranch,
      0n
    )
  ) {
    throw new DirectVotingError("InvalidBeaconSlotProof", "Invalid beacon slot branch.");
  }

  const alignBranch = proof.executionHashBranch.map(hexToBytes);
  if (
    (alignBranch.length !== 10 && alignBranch.length !== 11) ||
    !verifySszBranch(stateRoot, pinnedExecutionBlockHash, alignBranch, EXECUTION_BLOCK_HASH_LEAF_INDEX)
  ) {
    throw new DirectVotingError(
      "InvalidExecutionConsensusAlignment",
      "BeaconState latest_execution_payload_header.block_hash != snapshotBlockHash."
    );
  }

  return {
    snapshotBeaconRoot: stateRoot,
    snapshotBeaconRootHex: bytesToHex(stateRoot),
    snapshotEpoch: BigInt(proof.beaconSlot) / SLOTS_PER_EPOCH,
  };
}

export function verifyValidatorStakeProof(snapshotBeaconRoot, snapshotEpoch, voterAddress, proof) {
  const idx = BigInt(proof.validatorIndex);
  if (idx < 0n || idx >= VALIDATOR_REGISTRY_LIMIT) {
    throw new DirectVotingError("ValidatorIndexOutOfRange", "Validator index >= 2**40.");
  }
  if (proof.slashed) {
    throw new DirectVotingError("ValidatorSlashed", `Validator #${idx} is slashed.`);
  }
  if (BigInt(proof.activationEpoch) > snapshotEpoch || snapshotEpoch >= BigInt(proof.exitEpoch)) {
    throw new DirectVotingError(
      "ValidatorNotActiveAtSnapshot",
      `Validator #${idx} inactive at epoch ${snapshotEpoch}.`
    );
  }

  const wc = hexToBytes(proof.withdrawalCredentials);
  const voterBytes = hexToBytes(voterAddress);
  if (wc[0] !== 0x01 && wc[0] !== 0x02) {
    throw new DirectVotingError(
      "UnsupportedWithdrawalPrefix",
      `Unsupported withdrawal prefix 0x${wc[0].toString(16).padStart(2, "0")}.`
    );
  }
  if (!equalBytes(wc.subarray(12, 32), voterBytes)) {
    throw new DirectVotingError(
      "UnauthorizedWithdrawalAddress",
      `Validator #${idx} withdrawal address does not match active wallet.`
    );
  }
  if (BigInt(proof.effectiveBalanceGwei) <= 0n) {
    throw new DirectVotingError("ZeroVotingWeight", "Validator effectiveBalanceGwei is 0.");
  }

  const validatorBranch = proof.validatorBranch.map(hexToBytes);
  const lenChunk = hexToBytes(proof.validatorsLengthChunk);
  const stateBranch = proof.beaconStateBranch.map(hexToBytes);
  const validatorCount = decodeLittleEndian64Chunk(lenChunk);

  if (
    validatorBranch.length !== VALIDATOR_REGISTRY_DEPTH ||
    (stateBranch.length !== 5 && stateBranch.length !== 6) ||
    validatorCount === null ||
    idx >= validatorCount ||
    validatorCount > VALIDATOR_REGISTRY_LIMIT
  ) {
    throw new DirectVotingError("InvalidValidatorProof", "Malformed validator SSZ branch lengths.");
  }

  const valRoot = hexToBytes(computeValidatorRoot(proof));
  const dataRoot = computeSszBranchRoot(valRoot, validatorBranch, idx);
  const listRoot = sha256Pair(dataRoot, lenChunk);
  const computedStateRoot = computeSszBranchRoot(
    listRoot,
    stateBranch,
    BEACON_STATE_VALIDATORS_FIELD_INDEX
  );

  if (!equalBytes(computedStateRoot, snapshotBeaconRoot)) {
    throw new DirectVotingError(
      "InvalidValidatorProof",
      `Validator #${idx} SSZ proof does not match snapshotBeaconRoot.`
    );
  }

  return BigInt(proof.effectiveBalanceGwei) * GWEI_TO_WEI;
}
