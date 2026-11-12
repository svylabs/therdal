/**
 * Live JSON-RPC Execution Proof Encoders & Multi-Validator SSZ Fixture Builder
 *
 * Bridges standard Ethereum JSON-RPC responses (`eth_getBlockByNumber`, `eth_getProof` from
 * Anvil, Geth, Reth, or Mainnet/Hoodi archive nodes) and multi-actor SSZ validator sets
 * directly to `Therdal.sol` Stage 2 calldata.
 */

import { bytesToHex, keccak256Bytes } from "./keccak256.ts";
import { computeSszZeroHashes, sha256Pair } from "./sha256.ts";
import {
  DirectVotingError,
  encodeRlpBytes,
  encodeRlpList,
  encodeRlpUint,
  equalBytes,
  hexToBytes,
  parseRlpItem,
} from "./rlp.ts";
import {
  type BeaconSnapshotAuthProof,
  type ValidatorStakeProof,
  VALIDATOR_REGISTRY_LIMIT,
  computeValidatorRoot,
  toLittleEndian64Chunk,
} from "./voting.ts";

export interface RpcExecutionBlock {
  hash: string;
  parentHash: string;
  sha3Uncles: string;
  miner: string;
  stateRoot: string;
  transactionsRoot: string;
  receiptsRoot: string;
  logsBloom: string;
  difficulty: string | number | bigint;
  number: string | number | bigint;
  gasLimit: string | number | bigint;
  gasUsed: string | number | bigint;
  timestamp: string | number | bigint;
  extraData: string;
  mixHash: string;
  nonce: string;
  baseFeePerGas?: string | number | bigint | null;
  withdrawalsRoot?: string | null;
  blobGasUsed?: string | number | bigint | null;
  excessBlobGas?: string | number | bigint | null;
  parentBeaconBlockRoot?: string | null;
  requestsHash?: string | null;
}

export interface EncodedRpcBlockHeader {
  rlpHeader: Uint8Array;
  rlpHeaderHex: `0x${string}`;
  blockHash: `0x${string}`;
  blockHashBytes: Uint8Array;
  stateRoot: `0x${string}`;
  stateRootBytes: Uint8Array;
  blockNumber: bigint;
  timestamp: bigint;
}

export interface MultiValidatorInput {
  validatorIndex: bigint;
  pubkeyRoot: `0x${string}`;
  withdrawalCredentials: `0x${string}`;
  effectiveBalanceGwei: bigint;
  slashed?: boolean;
  activationEligibilityEpoch?: bigint;
  activationEpoch?: bigint;
  exitEpoch?: bigint;
  withdrawableEpoch?: bigint;
}

const utf8 = new TextEncoder();

function parseRpcQuantity(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  const trimmed = value.trim();
  if (trimmed === "0x" || trimmed === "0X") return 0n;
  return BigInt(trimmed);
}

/**
 * Canonically RLP-encodes a JSON-RPC `eth_getBlockByNumber` block header (London/Merge/Shanghai/Cancun/Prague)
 * and verifies that `keccak256(rlpHeader)` matches `rpcBlock.hash`.
 */
export function encodeRpcBlockHeaderToRlp(rpcBlock: RpcExecutionBlock): EncodedRpcBlockHeader {
  const expectedHashBytes = hexToBytes(rpcBlock.hash);
  if (expectedHashBytes.length !== 32) {
    throw new DirectVotingError("InvalidHex", "Block hash must be 32 bytes.");
  }

  const stateRootBytes = hexToBytes(rpcBlock.stateRoot);
  if (stateRootBytes.length !== 32 || equalBytes(stateRootBytes, new Uint8Array(32))) {
    throw new DirectVotingError("EmptyExecutionStateRoot", "Block stateRoot must be non-zero 32 bytes.");
  }

  const fields: Uint8Array[] = [
    encodeRlpBytes(hexToBytes(rpcBlock.parentHash)),
    encodeRlpBytes(hexToBytes(rpcBlock.sha3Uncles)),
    encodeRlpBytes(hexToBytes(rpcBlock.miner)),
    encodeRlpBytes(stateRootBytes),
    encodeRlpBytes(hexToBytes(rpcBlock.transactionsRoot)),
    encodeRlpBytes(hexToBytes(rpcBlock.receiptsRoot)),
    encodeRlpBytes(hexToBytes(rpcBlock.logsBloom)),
    encodeRlpUint(parseRpcQuantity(rpcBlock.difficulty)),
    encodeRlpUint(parseRpcQuantity(rpcBlock.number)),
    encodeRlpUint(parseRpcQuantity(rpcBlock.gasLimit)),
    encodeRlpUint(parseRpcQuantity(rpcBlock.gasUsed)),
    encodeRlpUint(parseRpcQuantity(rpcBlock.timestamp)),
    encodeRlpBytes(hexToBytes(rpcBlock.extraData)),
    encodeRlpBytes(hexToBytes(rpcBlock.mixHash)),
    encodeRlpBytes(hexToBytes(rpcBlock.nonce)),
  ];

  if (rpcBlock.baseFeePerGas !== undefined && rpcBlock.baseFeePerGas !== null) {
    fields.push(encodeRlpUint(parseRpcQuantity(rpcBlock.baseFeePerGas)));
  }
  if (rpcBlock.withdrawalsRoot !== undefined && rpcBlock.withdrawalsRoot !== null) {
    fields.push(encodeRlpBytes(hexToBytes(rpcBlock.withdrawalsRoot)));
  }
  if (rpcBlock.blobGasUsed !== undefined && rpcBlock.blobGasUsed !== null) {
    fields.push(encodeRlpUint(parseRpcQuantity(rpcBlock.blobGasUsed)));
  }
  if (rpcBlock.excessBlobGas !== undefined && rpcBlock.excessBlobGas !== null) {
    fields.push(encodeRlpUint(parseRpcQuantity(rpcBlock.excessBlobGas)));
  }
  if (rpcBlock.parentBeaconBlockRoot !== undefined && rpcBlock.parentBeaconBlockRoot !== null) {
    fields.push(encodeRlpBytes(hexToBytes(rpcBlock.parentBeaconBlockRoot)));
  }
  if (rpcBlock.requestsHash !== undefined && rpcBlock.requestsHash !== null) {
    fields.push(encodeRlpBytes(hexToBytes(rpcBlock.requestsHash)));
  }

  const rlpHeader = encodeRlpList(fields);
  const actualHashBytes = keccak256Bytes(rlpHeader);
  if (!equalBytes(actualHashBytes, expectedHashBytes)) {
    throw new DirectVotingError(
      "ExecutionHeaderHashMismatch",
      `RLP header keccak256 (${bytesToHex(actualHashBytes)}) does not match RPC block.hash (${bytesToHex(expectedHashBytes)}).`
    );
  }

  return {
    rlpHeader,
    rlpHeaderHex: bytesToHex(rlpHeader),
    blockHash: bytesToHex(actualHashBytes),
    blockHashBytes: actualHashBytes,
    stateRoot: bytesToHex(stateRootBytes),
    stateRootBytes,
    blockNumber: parseRpcQuantity(rpcBlock.number),
    timestamp: parseRpcQuantity(rpcBlock.timestamp),
  };
}

/**
 * Wraps the `accountProof` node array returned by `eth_getProof(address, [], blockTag)` into the
 * canonical outer RLP list expected by `Therdal.voteWithExecutionBalance` and `Therdal.voteDirect`.
 */
export function encodeRpcAccountProofNodes(accountProofHexNodes: readonly string[]): {
  rlpAccountProofNodes: Uint8Array;
  rlpAccountProofNodesHex: `0x${string}`;
} {
  if (accountProofHexNodes.length === 0 || accountProofHexNodes.length > 65) {
    throw new DirectVotingError("InvalidMPTProof", "accountProof must contain 1..=65 RLP trie nodes.");
  }

  const rawNodes = accountProofHexNodes.map((hexNode) => {
    const nodeBytes = hexToBytes(hexNode);
    const parsed = parseRlpItem(nodeBytes);
    if (!parsed.isList) {
      throw new DirectVotingError("InvalidMPTProof", "Each EIP-1186 accountProof entry must be an RLP list node.");
    }
    return nodeBytes;
  });

  const rlpAccountProofNodes = encodeRlpList(rawNodes);
  return {
    rlpAccountProofNodes,
    rlpAccountProofNodesHex: bytesToHex(rlpAccountProofNodes),
  };
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

/**
 * Builds a sparse depth-40 SHA-256 SSZ `List[Validator, 2**40]` Merkle tree and aligned
 * `BeaconState` + `BeaconBlockHeader` supporting an arbitrary set of validators (EOA + Smart Account,
 * `0x01` + `0x02` withdrawal credentials) sharing one canonical `beaconBlockRoot`.
 */
export function buildMultiValidatorBeaconFixture(params: {
  pinnedExecutionBlockHash: Uint8Array;
  snapshotBlockNumber?: bigint;
  beaconSlot: bigint;
  childBlockTimestamp: bigint;
  validatorCount?: bigint;
  validators: readonly MultiValidatorInput[];
  useElectraDepth?: boolean;
}): {
  beaconBlockRoot: `0x${string}`;
  beaconBlockRootBytes: Uint8Array;
  beaconStateRoot: `0x${string}`;
  beaconAuth: BeaconSnapshotAuthProof;
  validatorProofs: ValidatorStakeProof[];
  validatorProofByIndex: Map<bigint, ValidatorStakeProof>;
} {
  if (params.validators.length === 0) {
    throw new DirectVotingError("InvalidValidatorProof", "At least one validator is required.");
  }

  const zeroHashes = computeSszZeroHashes();

  // Level 0..40 sparse map of non-default subtree hashes
  const levels: Array<Map<bigint, Uint8Array>> = Array.from(
    { length: 41 },
    () => new Map<bigint, Uint8Array>()
  );

  let maxValidatorIndex = 0n;
  const seenIndices = new Set<bigint>();

  const normalizedValidators = params.validators.map((v) => {
    if (v.validatorIndex < 0n || v.validatorIndex >= VALIDATOR_REGISTRY_LIMIT) {
      throw new DirectVotingError("ValidatorIndexOutOfRange", `Invalid validatorIndex ${v.validatorIndex}`);
    }
    if (seenIndices.has(v.validatorIndex)) {
      throw new DirectVotingError("InvalidValidatorProof", `Duplicate validatorIndex ${v.validatorIndex}`);
    }
    seenIndices.add(v.validatorIndex);
    if (v.validatorIndex > maxValidatorIndex) {
      maxValidatorIndex = v.validatorIndex;
    }

    const slashed = v.slashed ?? false;
    const activationEligibilityEpoch = v.activationEligibilityEpoch ?? 100_000n;
    const activationEpoch = v.activationEpoch ?? 100_010n;
    const exitEpoch = v.exitEpoch ?? 0xffffffffffffffffn;
    const withdrawableEpoch = v.withdrawableEpoch ?? 0xffffffffffffffffn;

    const valRootHex = computeValidatorRoot({
      pubkeyRoot: v.pubkeyRoot,
      withdrawalCredentials: v.withdrawalCredentials,
      effectiveBalanceGwei: v.effectiveBalanceGwei,
      slashed,
      activationEligibilityEpoch,
      activationEpoch,
      exitEpoch,
      withdrawableEpoch,
    });

    levels[0].set(v.validatorIndex, hexToBytes(valRootHex));

    return {
      ...v,
      slashed,
      activationEligibilityEpoch,
      activationEpoch,
      exitEpoch,
      withdrawableEpoch,
    };
  });

  const resolvedValidatorCount =
    params.validatorCount !== undefined ? params.validatorCount : maxValidatorIndex + 1n;
  if (resolvedValidatorCount <= maxValidatorIndex || resolvedValidatorCount > VALIDATOR_REGISTRY_LIMIT) {
    throw new DirectVotingError(
      "InvalidValidatorProof",
      `validatorCount (${resolvedValidatorCount}) must exceed max validatorIndex (${maxValidatorIndex}).`
    );
  }

  // Bottom-up sparse Merkleization across all 40 depth levels
  for (let d = 0; d < 40; d++) {
    const current = levels[d];
    const parent = levels[d + 1];
    const parentIndices = new Set<bigint>();
    for (const idx of current.keys()) {
      parentIndices.add(idx >> 1n);
    }
    for (const pIdx of parentIndices) {
      const left = current.get(pIdx * 2n) ?? zeroHashes[d];
      const right = current.get(pIdx * 2n + 1n) ?? zeroHashes[d];
      parent.set(pIdx, sha256Pair(left, right));
    }
  }

  const validatorsDataRoot = levels[40].get(0n) ?? zeroHashes[40];
  const lenChunk = toLittleEndian64Chunk(resolvedValidatorCount);
  const validatorsListRoot = sha256Pair(validatorsDataRoot, lenChunk);

  // Build ExecutionPayloadHeader (leaf 12 = block_hash)
  const execLeaves = Array.from({ length: 32 }, () => new Uint8Array(32));
  execLeaves[12] = params.pinnedExecutionBlockHash;
  execLeaves[6] = toLittleEndian64Chunk(params.snapshotBlockNumber ?? 1n);
  const { root: execPayloadRoot, branch: execInnerBranch } = merkleizePowerOfTwo(execLeaves, 12);

  // Build BeaconState (Deneb 32 leaves or Electra/Pectra 64 leaves)
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
  const beaconStateBranchHex = stateBranchVal.map(bytesToHex);
  const validatorsLengthChunkHex = bytesToHex(lenChunk);

  // Build BeaconBlockHeader (8 leaves, depth 3)
  const headerLeaves = Array.from({ length: 8 }, () => new Uint8Array(32));
  headerLeaves[0] = toLittleEndian64Chunk(params.beaconSlot);
  headerLeaves[1] = toLittleEndian64Chunk(7n);
  headerLeaves[2] = keccak256Bytes(utf8.encode("parent_beacon_root"));
  headerLeaves[3] = beaconStateRootBytes;
  headerLeaves[4] = keccak256Bytes(utf8.encode("beacon_body_root"));

  const { root: beaconBlockRootBytes, branch: slotBranch } = merkleizePowerOfTwo(headerLeaves, 0);
  const { branch: stateRootBranch } = merkleizePowerOfTwo(headerLeaves, 3);

  const validatorProofs: ValidatorStakeProof[] = [];
  const validatorProofByIndex = new Map<bigint, ValidatorStakeProof>();

  for (const v of normalizedValidators) {
    const branch: `0x${string}`[] = [];
    for (let d = 0; d < 40; d++) {
      const siblingIdx = (v.validatorIndex >> BigInt(d)) ^ 1n;
      const siblingHash = levels[d].get(siblingIdx) ?? zeroHashes[d];
      branch.push(bytesToHex(siblingHash));
    }

    const proof: ValidatorStakeProof = {
      validatorIndex: v.validatorIndex,
      pubkeyRoot: v.pubkeyRoot,
      withdrawalCredentials: v.withdrawalCredentials,
      effectiveBalanceGwei: v.effectiveBalanceGwei,
      slashed: v.slashed,
      activationEligibilityEpoch: v.activationEligibilityEpoch,
      activationEpoch: v.activationEpoch,
      exitEpoch: v.exitEpoch,
      withdrawableEpoch: v.withdrawableEpoch,
      validatorBranch: branch,
      validatorsLengthChunk: validatorsLengthChunkHex,
      beaconStateBranch: beaconStateBranchHex,
    };

    validatorProofs.push(proof);
    validatorProofByIndex.set(v.validatorIndex, proof);
  }

  return {
    beaconBlockRoot: bytesToHex(beaconBlockRootBytes),
    beaconBlockRootBytes,
    beaconStateRoot: bytesToHex(beaconStateRootBytes),
    beaconAuth: {
      childBlockTimestamp: params.childBlockTimestamp,
      beaconSlot: params.beaconSlot,
      slotBranch: slotBranch.map(bytesToHex),
      beaconStateRoot: bytesToHex(beaconStateRootBytes),
      stateRootBranch: stateRootBranch.map(bytesToHex),
      executionHashBranch,
    },
    validatorProofs,
    validatorProofByIndex,
  };
}
