/**
 * Stage 2 Direct On-Chain Voting SDK:
 * - Canonical `THERDAL_WALLET` & `THERDAL_VALIDATOR` position keys matching Solidity & Rust
 * - SHA-256 SSZ Merkleization, Beacon snapshot authentication, and depth-40 `Validator` verification
 * - Stage 2 Direct Voting contract ABIs
 */

import { bytesToHex, keccak256Bytes } from "./keccak256.ts";
import { computeSszZeroHashes, sha256Pair } from "./sha256.ts";
import { DirectVotingError, concatBytes, equalBytes, hexToBytes } from "./rlp.ts";

export const WALLET_DOMAIN_TAG = "THERDAL_WALLET";
export const VALIDATOR_DOMAIN_TAG = "THERDAL_VALIDATOR";
export const SLOTS_PER_EPOCH = 32n;
export const VALIDATOR_REGISTRY_DEPTH = 40;
export const VALIDATOR_REGISTRY_LIMIT = 1n << 40n;
export const BEACON_STATE_VALIDATORS_FIELD_INDEX = 11n;
export const EXECUTION_BLOCK_HASH_LEAF_INDEX = 780n; // (24 << 5) | 12
export const GWEI_TO_WEI = 1_000_000_000n;

export const PositionType = {
  ExecutionWallet: 0,
  BeaconValidator: 1,
} as const;
export type PositionTypeValue = (typeof PositionType)[keyof typeof PositionType];

export interface BeaconSnapshotAuthProof {
  childBlockTimestamp: bigint;
  beaconSlot: bigint;
  slotBranch: `0x${string}`[];
  beaconStateRoot: `0x${string}`;
  stateRootBranch: `0x${string}`[];
  executionHashBranch: `0x${string}`[];
}

export interface ValidatorStakeProof {
  validatorIndex: bigint;
  pubkeyRoot: `0x${string}`;
  withdrawalCredentials: `0x${string}`;
  effectiveBalanceGwei: bigint;
  slashed: boolean;
  activationEligibilityEpoch: bigint;
  activationEpoch: bigint;
  exitEpoch: bigint;
  withdrawableEpoch: bigint;
  validatorBranch: `0x${string}`[];
  validatorsLengthChunk: `0x${string}`;
  beaconStateBranch: `0x${string}`[];
}

export interface DirectVoteProofBundle {
  includeExecutionBalance: boolean;
  rlpExecutionHeader: `0x${string}`;
  rlpAccountProofNodes: `0x${string}`;
  beaconAuth: BeaconSnapshotAuthProof;
  validatorProofs: ValidatorStakeProof[];
}

export interface TopicTallyView {
  topicId: bigint;
  optionWeightsWei: bigint[];
  optionPositionCounts: bigint[];
  totalWeightWei: bigint;
  totalCountedPositions: bigint;
  directVoteCount: bigint;
}

const utf8 = new TextEncoder();

function encodeUint256Be(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rem = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

function encodeUint64Be(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rem = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

/**
 * Computes `keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))` (`66` bytes).
 */
export function computeWalletPositionKey(
  chainId: bigint | number,
  accountAddress: string
): `0x${string}` {
  const addrBytes = hexToBytes(accountAddress);
  if (addrBytes.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Account address must be 20 bytes.");
  }
  const preimage = concatBytes([
    utf8.encode(WALLET_DOMAIN_TAG),
    encodeUint256Be(BigInt(chainId)),
    addrBytes,
  ]);
  return bytesToHex(keccak256Bytes(preimage));
}

/**
 * Computes `keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))` (`57` bytes).
 */
export function computeValidatorPositionKey(
  chainId: bigint | number,
  validatorIndex: bigint | number
): `0x${string}` {
  const preimage = concatBytes([
    utf8.encode(VALIDATOR_DOMAIN_TAG),
    encodeUint256Be(BigInt(chainId)),
    encodeUint64Be(BigInt(validatorIndex)),
  ]);
  return bytesToHex(keccak256Bytes(preimage));
}

export function toLittleEndian64Chunk(value: bigint | number): Uint8Array {
  const out = new Uint8Array(32);
  let rem = BigInt(value);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

export function decodeLittleEndian64Chunk(chunk: Uint8Array): bigint | null {
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

export function toBoolChunk(value: boolean): Uint8Array {
  const out = new Uint8Array(32);
  if (value) out[0] = 1;
  return out;
}

export function makeWithdrawalCredentials(
  prefix: 0x01 | 0x02,
  withdrawalAddress: string
): `0x${string}` {
  const addr = hexToBytes(withdrawalAddress);
  if (addr.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Withdrawal address must be 20 bytes.");
  }
  const out = new Uint8Array(32);
  out[0] = prefix;
  out.set(addr, 12);
  return bytesToHex(out);
}

export function computeSszBranchRoot(
  leaf: Uint8Array,
  branch: readonly Uint8Array[],
  leafIndex: bigint
): Uint8Array {
  let cur = leaf;
  for (let i = 0; i < branch.length; i++) {
    const bit = (leafIndex >> BigInt(i)) & 1n;
    cur = bit === 1n ? sha256Pair(branch[i], cur) : sha256Pair(cur, branch[i]);
  }
  return cur;
}

export function verifySszBranch(
  root: Uint8Array,
  leaf: Uint8Array,
  branch: readonly Uint8Array[],
  leafIndex: bigint
): boolean {
  return equalBytes(computeSszBranchRoot(leaf, branch, leafIndex), root);
}

export function computeValidatorRoot(params: {
  pubkeyRoot: string | Uint8Array;
  withdrawalCredentials: string | Uint8Array;
  effectiveBalanceGwei: bigint | number;
  slashed: boolean;
  activationEligibilityEpoch: bigint | number;
  activationEpoch: bigint | number;
  exitEpoch: bigint | number;
  withdrawableEpoch: bigint | number;
}): `0x${string}` {
  const pk =
    typeof params.pubkeyRoot === "string" ? hexToBytes(params.pubkeyRoot) : params.pubkeyRoot;
  const wc =
    typeof params.withdrawalCredentials === "string"
      ? hexToBytes(params.withdrawalCredentials)
      : params.withdrawalCredentials;

  const n00 = sha256Pair(pk, wc);
  const n01 = sha256Pair(
    toLittleEndian64Chunk(params.effectiveBalanceGwei),
    toBoolChunk(params.slashed)
  );
  const n02 = sha256Pair(
    toLittleEndian64Chunk(params.activationEligibilityEpoch),
    toLittleEndian64Chunk(params.activationEpoch)
  );
  const n03 = sha256Pair(
    toLittleEndian64Chunk(params.exitEpoch),
    toLittleEndian64Chunk(params.withdrawableEpoch)
  );

  const n10 = sha256Pair(n00, n01);
  const n11 = sha256Pair(n02, n03);
  return bytesToHex(sha256Pair(n10, n11));
}

export function authenticateBeaconSnapshot(
  pinnedExecutionBlockHash: Uint8Array,
  canonicalBeaconBlockRoot: Uint8Array,
  proof: BeaconSnapshotAuthProof
): { snapshotBeaconRoot: Uint8Array; snapshotEpoch: bigint } {
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
    !verifySszBranch(
      stateRoot,
      pinnedExecutionBlockHash,
      alignBranch,
      EXECUTION_BLOCK_HASH_LEAF_INDEX
    )
  ) {
    throw new DirectVotingError(
      "InvalidExecutionConsensusAlignment",
      "Beacon state execution_payload_header.block_hash does not match snapshotBlockHash."
    );
  }

  return {
    snapshotBeaconRoot: stateRoot,
    snapshotEpoch: proof.beaconSlot / SLOTS_PER_EPOCH,
  };
}

export function verifyValidatorStakeProof(
  snapshotBeaconRoot: Uint8Array,
  snapshotEpoch: bigint,
  voterAddress: string,
  proof: ValidatorStakeProof
): bigint {
  if (proof.validatorIndex < 0n || proof.validatorIndex >= VALIDATOR_REGISTRY_LIMIT) {
    throw new DirectVotingError("ValidatorIndexOutOfRange", "Validator index >= 2**40.");
  }
  if (proof.slashed) {
    throw new DirectVotingError("ValidatorSlashed", `Validator #${proof.validatorIndex} is slashed.`);
  }
  if (proof.activationEpoch > snapshotEpoch || snapshotEpoch >= proof.exitEpoch) {
    throw new DirectVotingError(
      "ValidatorNotActiveAtSnapshot",
      `Validator #${proof.validatorIndex} inactive at epoch ${snapshotEpoch}.`
    );
  }

  const wc = hexToBytes(proof.withdrawalCredentials);
  const voterBytes = hexToBytes(voterAddress);
  if (wc.length !== 32 || voterBytes.length !== 20) {
    throw new DirectVotingError("InvalidHex", "Invalid credential or voter address length.");
  }
  if (wc[0] !== 0x01 && wc[0] !== 0x02) {
    throw new DirectVotingError(
      "UnsupportedWithdrawalPrefix",
      `Unsupported withdrawal prefix 0x${wc[0].toString(16).padStart(2, "0")}.`
    );
  }
  if (!equalBytes(wc.subarray(12, 32), voterBytes)) {
    throw new DirectVotingError(
      "UnauthorizedWithdrawalAddress",
      "Validator withdrawal address does not match voter."
    );
  }
  if (proof.effectiveBalanceGwei <= 0n) {
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
    proof.validatorIndex >= validatorCount ||
    validatorCount > VALIDATOR_REGISTRY_LIMIT
  ) {
    throw new DirectVotingError("InvalidValidatorProof", "Malformed validator SSZ branch lengths.");
  }

  const valRoot = hexToBytes(computeValidatorRoot(proof));
  const dataRoot = computeSszBranchRoot(valRoot, validatorBranch, proof.validatorIndex);
  const listRoot = sha256Pair(dataRoot, lenChunk);
  const computedStateRoot = computeSszBranchRoot(
    listRoot,
    stateBranch,
    BEACON_STATE_VALIDATORS_FIELD_INDEX
  );

  if (!equalBytes(computedStateRoot, snapshotBeaconRoot)) {
    throw new DirectVotingError(
      "InvalidValidatorProof",
      `Validator #${proof.validatorIndex} SSZ proof does not match snapshotBeaconRoot.`
    );
  }

  return proof.effectiveBalanceGwei * GWEI_TO_WEI;
}

function merkleizePowerOfTwo(
  leaves: readonly Uint8Array[],
  targetIdx: number
): { root: Uint8Array; branch: Uint8Array[] } {
  const depth = Math.log2(leaves.length);
  const branch: Uint8Array[] = [];
  let layer = leaves.slice();
  let idx = targetIdx;
  for (let d = 0; d < depth; d++) {
    branch.push(layer[idx ^ 1]);
    const next: Uint8Array[] = [];
    for (let j = 0; j < layer.length; j += 2) {
      next.push(sha256Pair(layer[j], layer[j + 1]));
    }
    layer = next;
    idx >>= 1;
  }
  return { root: layer[0], branch };
}

export function buildSingleValidatorBeaconFixture(params: {
  pinnedExecutionBlockHash: Uint8Array;
  beaconSlot: bigint;
  childBlockTimestamp: bigint;
  validatorCount: bigint;
  validatorIndex: bigint;
  pubkeyRoot: `0x${string}`;
  withdrawalCredentials: `0x${string}`;
  effectiveBalanceGwei: bigint;
  slashed?: boolean;
  activationEligibilityEpoch?: bigint;
  activationEpoch?: bigint;
  exitEpoch?: bigint;
  withdrawableEpoch?: bigint;
  useElectraDepth?: boolean;
}): {
  beaconBlockRoot: `0x${string}`;
  beaconBlockRootBytes: Uint8Array;
  beaconAuth: BeaconSnapshotAuthProof;
  validatorProof: ValidatorStakeProof;
} {
  const slashed = params.slashed ?? false;
  const activationEligibilityEpoch = params.activationEligibilityEpoch ?? 100_000n;
  const activationEpoch = params.activationEpoch ?? 100_010n;
  const exitEpoch = params.exitEpoch ?? 0xffffffffffffffffn;
  const withdrawableEpoch = params.withdrawableEpoch ?? 0xffffffffffffffffn;

  const z = computeSszZeroHashes();
  const valRoot = hexToBytes(
    computeValidatorRoot({
      pubkeyRoot: params.pubkeyRoot,
      withdrawalCredentials: params.withdrawalCredentials,
      effectiveBalanceGwei: params.effectiveBalanceGwei,
      slashed,
      activationEligibilityEpoch,
      activationEpoch,
      exitEpoch,
      withdrawableEpoch,
    })
  );

  const validatorBranch: `0x${string}`[] = [];
  let cur = valRoot;
  for (let i = 0; i < 40; i++) {
    validatorBranch.push(bytesToHex(z[i]));
    if (((params.validatorIndex >> BigInt(i)) & 1n) === 1n) {
      cur = sha256Pair(z[i], cur);
    } else {
      cur = sha256Pair(cur, z[i]);
    }
  }
  const lenChunk = toLittleEndian64Chunk(params.validatorCount);
  const validatorsListRoot = sha256Pair(cur, lenChunk);

  const execLeaves = Array.from({ length: 32 }, () => new Uint8Array(32));
  execLeaves[12] = params.pinnedExecutionBlockHash;
  execLeaves[6] = toLittleEndian64Chunk(21_499_999n);
  const { root: execPayloadRoot, branch: execInnerBranch } = merkleizePowerOfTwo(execLeaves, 12);

  const stateLeafCount = params.useElectraDepth ? 64 : 32;
  const stateLeaves = Array.from({ length: stateLeafCount }, () => new Uint8Array(32));
  stateLeaves[11] = validatorsListRoot;
  stateLeaves[24] = execPayloadRoot;
  const { root: beaconStateRootBytes, branch: stateBranchVal } = merkleizePowerOfTwo(
    stateLeaves,
    11
  );
  const { branch: stateBranchExec } = merkleizePowerOfTwo(stateLeaves, 24);

  const executionHashBranch = [...execInnerBranch, ...stateBranchExec].map(bytesToHex);

  const headerLeaves = Array.from({ length: 8 }, () => new Uint8Array(32));
  headerLeaves[0] = toLittleEndian64Chunk(params.beaconSlot);
  headerLeaves[1] = toLittleEndian64Chunk(7n);
  headerLeaves[2] = keccak256Bytes(utf8.encode("parent_beacon_root"));
  headerLeaves[3] = beaconStateRootBytes;
  headerLeaves[4] = keccak256Bytes(utf8.encode("beacon_body_root"));

  const { root: beaconBlockRootBytes, branch: slotBranch } = merkleizePowerOfTwo(headerLeaves, 0);
  const { branch: stateRootBranch } = merkleizePowerOfTwo(headerLeaves, 3);

  return {
    beaconBlockRoot: bytesToHex(beaconBlockRootBytes),
    beaconBlockRootBytes,
    beaconAuth: {
      childBlockTimestamp: params.childBlockTimestamp,
      beaconSlot: params.beaconSlot,
      slotBranch: slotBranch.map(bytesToHex),
      beaconStateRoot: bytesToHex(beaconStateRootBytes),
      stateRootBranch: stateRootBranch.map(bytesToHex),
      executionHashBranch,
    },
    validatorProof: {
      validatorIndex: params.validatorIndex,
      pubkeyRoot: params.pubkeyRoot,
      withdrawalCredentials: params.withdrawalCredentials,
      effectiveBalanceGwei: params.effectiveBalanceGwei,
      slashed,
      activationEligibilityEpoch,
      activationEpoch,
      exitEpoch,
      withdrawableEpoch,
      validatorBranch,
      validatorsLengthChunk: bytesToHex(lenChunk),
      beaconStateBranch: stateBranchVal.map(bytesToHex),
    },
  };
}

export const THERDAL_STAGE2_VOTING_ABI = [
  "function authenticateExecutionSnapshot(uint256 topicId, bytes rlpExecutionHeader) external returns (bytes32 snapshotExecutionRoot)",
  "function authenticateBeaconSnapshot(uint256 topicId, (uint64 childBlockTimestamp, uint64 beaconSlot, bytes32[] slotBranch, bytes32 beaconStateRoot, bytes32[] stateRootBranch, bytes32[] executionHashBranch) proof) external returns (bytes32 snapshotBeaconRoot, uint64 snapshotEpoch)",
  "function voteWithExecutionBalance(uint256 topicId, uint32 optionIndex, bytes rlpExecutionHeader, bytes rlpAccountProofNodes) external returns (uint256 weightWei)",
  "function voteWithBeaconStake(uint256 topicId, uint32 optionIndex, (uint64 childBlockTimestamp, uint64 beaconSlot, bytes32[] slotBranch, bytes32 beaconStateRoot, bytes32[] stateRootBranch, bytes32[] executionHashBranch) beaconAuth, (uint64 validatorIndex, bytes32 pubkeyRoot, bytes32 withdrawalCredentials, uint64 effectiveBalanceGwei, bool slashed, uint64 activationEligibilityEpoch, uint64 activationEpoch, uint64 exitEpoch, uint64 withdrawableEpoch, bytes32[] validatorBranch, bytes32 validatorsLengthChunk, bytes32[] beaconStateBranch)[] validatorProofs) external returns (uint256 totalStakeWei)",
  "function voteDirect(uint256 topicId, uint32 optionIndex, (bool includeExecutionBalance, bytes rlpExecutionHeader, bytes rlpAccountProofNodes, (uint64 childBlockTimestamp, uint64 beaconSlot, bytes32[] slotBranch, bytes32 beaconStateRoot, bytes32[] stateRootBranch, bytes32[] executionHashBranch) beaconAuth, (uint64 validatorIndex, bytes32 pubkeyRoot, bytes32 withdrawalCredentials, uint64 effectiveBalanceGwei, bool slashed, uint64 activationEligibilityEpoch, uint64 activationEpoch, uint64 exitEpoch, uint64 withdrawableEpoch, bytes32[] validatorBranch, bytes32 validatorsLengthChunk, bytes32[] beaconStateBranch)[] validatorProofs) bundle) external returns (uint256 totalWeightWei)",
  "function getSnapshotState(uint256 topicId) external view returns ((uint64 snapshotBlock, bytes32 snapshotBlockHash, bytes32 snapshotBeaconBlockRoot, bytes32 snapshotExecutionRoot, bytes32 snapshotBeaconRoot, uint64 snapshotEpoch, bool executionAuthenticated, bool beaconAuthenticated))",
  "function getTopicTallies(uint256 topicId) external view returns ((uint256 topicId, uint256[] optionWeightsWei, uint256[] optionPositionCounts, uint256 totalWeightWei, uint256 totalCountedPositions, uint256 directVoteCount))",
  "function getPositionReceipt(uint256 topicId, bytes32 positionKey) external view returns ((bool claimed, uint8 positionType, address voter, uint32 optionIndex, uint256 weightWei))",
  "function hasWalletVoted(uint256 topicId, address account) external view returns (bool)",
  "function hasValidatorVoted(uint256 topicId, uint64 validatorIndex) external view returns (bool)",
  "function computeWalletPositionKey(address account) external view returns (bytes32)",
  "function computeValidatorPositionKey(uint64 validatorIndex) external view returns (bytes32)",
  "event ExecutionSnapshotAuthenticated(uint256 indexed topicId, uint64 snapshotBlock, bytes32 snapshotBlockHash, bytes32 snapshotExecutionRoot)",
  "event BeaconSnapshotAuthenticated(uint256 indexed topicId, bytes32 beaconBlockRoot, bytes32 snapshotBeaconRoot, uint64 beaconSlot, uint64 snapshotEpoch)",
  "event PositionCounted(uint256 indexed topicId, bytes32 indexed positionKey, address indexed voter, uint8 positionType, uint64 validatorIndex, uint32 optionIndex, uint256 weightWei)",
  "event DirectVoteCast(uint256 indexed topicId, address indexed voter, uint32 indexed optionIndex, uint256 totalWeightWei, uint256 executionWeightWei, uint256 beaconWeightWei, uint256 positionsCounted)",
] as const;
