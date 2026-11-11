/**
 * Pure zero-dependency Ethereum Keccak-256 (pre-NIST 0x01 padding, rate = 1088 bits = 136 bytes).
 */

const MASK_64 = 0xffffffffffffffffn;

const RC: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTC: readonly number[] = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14,
  27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PILN: readonly number[] = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4,
  15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

function rotl64(x: bigint, n: number): bigint {
  return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK_64;
}

function keccakF1600(state: bigint[]): void {
  const bc = new Array<bigint>(5);
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

export function keccak256Bytes(input: Uint8Array): Uint8Array {
  const rate = 136;
  const paddedLen = Math.ceil((input.length + 1) / rate) * rate;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[input.length] ^= 0x01;
  buf[paddedLen - 1] ^= 0x80;

  const state = new Array<bigint>(25).fill(0n);
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

export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = "0x";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex as `0x${string}`;
}
