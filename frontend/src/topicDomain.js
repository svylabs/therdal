// Pure Stage 1 Topic Creation domain module (zero DOM coupling)
// Matches `contracts/libraries/TopicValidation.sol`, `topics/`, and `sdk/src/index.ts` byte-for-byte.

export const MIN_TOPIC_OPTIONS = 2;
export const MAX_TOPIC_OPTIONS = 16;
export const MAX_SUBJECT_BYTES = 512;
export const MAX_OPTION_BYTES = 256;
export const TOPIC_DOMAIN_TAG = "THERDAL_TOPIC_V1";

const MASK_64 = 0xffffffffffffffffn;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTC = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PILN = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const utf8Encoder = new TextEncoder();

function rotl64(x, n) {
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK_64;
}

function keccakF1600(state) {
  const bc = new Array(5);
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      bc[i] = state[i] ^ state[i + 5] ^ state[i + 10] ^ state[i + 15] ^ state[i + 20];
    }
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl64(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) {
        state[j + i] = (state[j + i] ^ t) & MASK_64;
      }
    }
    let t = state[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      const tmp = state[j];
      state[j] = rotl64(t, ROTC[i]);
      t = tmp;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) {
        bc[i] = state[j + i];
      }
      for (let i = 0; i < 5; i++) {
        state[j + i] = (state[j + i] ^ (~bc[(i + 1) % 5] & bc[(i + 2) % 5])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ RC[round]) & MASK_64;
  }
}

export function keccak256Bytes(input) {
  const rate = 136;
  const paddedLen = Math.ceil((input.length + 1) / rate) * rate;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.length] ^= 0x01;
  buf[paddedLen - 1] ^= 0x80;

  const state = new Array(25).fill(0n);
  for (let offset = 0; offset < paddedLen; offset += rate) {
    for (let lane = 0; lane < 17; lane++) {
      let word = 0n;
      const base = offset + lane * 8;
      for (let b = 0; b < 8; b++) {
        word |= BigInt(buf[base + b]) << BigInt(b * 8);
      }
      state[lane] = (state[lane] ^ word) & MASK_64;
    }
    keccakF1600(state);
  }

  const out = new Uint8Array(32);
  for (let lane = 0; lane < 4; lane++) {
    const word = state[lane];
    for (let b = 0; b < 8; b++) {
      out[lane * 8 + b] = Number((word >> BigInt(b * 8)) & 0xffn);
    }
  }
  return out;
}

export function bytesToHex(bytes) {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function utf8ByteLength(str) {
  return utf8Encoder.encode(str).length;
}

function isAsciiWhitespace(byte) {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function trimAsciiBytes(raw) {
  let start = 0;
  let end = raw.length;
  while (start < end && isAsciiWhitespace(raw[start])) start++;
  while (end > start && isAsciiWhitespace(raw[end - 1])) end--;
  return raw.subarray(start, end);
}

function encodeUint64Be(val) {
  const out = new Uint8Array(8);
  let rem = BigInt(val);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

export function validateTopicDraft({ subject, options, votingEndsAt, nowTimestamp, initialSponsorshipUsdc }) {
  const subjRaw = utf8Encoder.encode(subject || "");
  if (subjRaw.length === 0 || trimAsciiBytes(subjRaw).length === 0) {
    return { ok: false, error: "EmptySubject: Subject must not be empty or whitespace-only." };
  }
  if (subjRaw.length > MAX_SUBJECT_BYTES) {
    return {
      ok: false,
      error: `SubjectTooLong: Subject is ${subjRaw.length} bytes (max ${MAX_SUBJECT_BYTES} bytes).`,
    };
  }

  if (!Array.isArray(options) || options.length < MIN_TOPIC_OPTIONS || options.length > MAX_TOPIC_OPTIONS) {
    return {
      ok: false,
      error: `InvalidOptionCount: Provide between ${MIN_TOPIC_OPTIONS} and ${MAX_TOPIC_OPTIONS} options.`,
    };
  }

  const seenTrimmed = new Map();
  for (let i = 0; i < options.length; i++) {
    const raw = utf8Encoder.encode(options[i] || "");
    if (raw.length === 0 || trimAsciiBytes(raw).length === 0) {
      return { ok: false, error: `EmptyOption(${i}): Option [${i}] cannot be blank.` };
    }
    if (raw.length > MAX_OPTION_BYTES) {
      return {
        ok: false,
        error: `OptionTooLong(${i}): Option [${i}] is ${raw.length} bytes (max ${MAX_OPTION_BYTES} bytes).`,
      };
    }
    const trimmedHex = bytesToHex(keccak256Bytes(trimAsciiBytes(raw)));
    if (seenTrimmed.has(trimmedHex)) {
      return {
        ok: false,
        error: `DuplicateOption(${seenTrimmed.get(trimmedHex)}, ${i}): Options [${seenTrimmed.get(trimmedHex)}] and [${i}] are identical.`,
      };
    }
    seenTrimmed.set(trimmedHex, i);
  }

  if (!Number.isFinite(votingEndsAt) || votingEndsAt <= nowTimestamp) {
    return {
      ok: false,
      error: `InvalidVotingEndTime: Voting end time must be strictly after the current chain timestamp (${nowTimestamp}).`,
    };
  }

  if (!Number.isFinite(initialSponsorshipUsdc) || initialSponsorshipUsdc < 0) {
    return { ok: false, error: "Invalid sponsorship amount (must be >= 0 USDC)." };
  }

  return { ok: true };
}

export function computeTopicContentHash(subject, options, votingEndsAt) {
  const domainBytes = utf8Encoder.encode(TOPIC_DOMAIN_TAG);
  const subjectHash = keccak256Bytes(utf8Encoder.encode(subject));

  const packedOptHashes = new Uint8Array(options.length * 32);
  for (let i = 0; i < options.length; i++) {
    packedOptHashes.set(keccak256Bytes(utf8Encoder.encode(options[i])), i * 32);
  }
  const optionsHash = keccak256Bytes(packedOptHashes);

  const preimage = new Uint8Array(96);
  preimage.set(domainBytes, 0);
  preimage.set(subjectHash, 16);
  preimage.set(encodeUint64Be(options.length), 48);
  preimage.set(optionsHash, 56);
  preimage.set(encodeUint64Be(votingEndsAt), 88);

  return bytesToHex(keccak256Bytes(preimage));
}

export function computeParentBlockHash(parentBlockNumber) {
  const prefix = utf8Encoder.encode("THERDAL_PARENT_BLOCK_");
  const payload = new Uint8Array(prefix.length + 8);
  payload.set(prefix, 0);
  payload.set(encodeUint64Be(parentBlockNumber), prefix.length);
  return bytesToHex(keccak256Bytes(payload));
}
