import assert from "node:assert/strict";
import test from "node:test";
import {
  DirectVotingError,
  authenticateBeaconSnapshot,
  authenticateExecutionHeader,
  buildExecutionHeader,
  buildMultiValidatorBeaconFixture,
  buildSingleAccountTrie,
  buildSingleValidatorBeaconFixture,
  bytesToHex,
  encodeRpcAccountProofNodes,
  encodeRpcBlockHeaderToRlp,
  keccak256Bytes,
  makeWithdrawalCredentials,
  parseRlpItem,
  rlpToList,
  verifyExecutionBalanceProof,
  verifyValidatorStakeProof,
} from "../src/index.ts";

const EOA_ALICE = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const SMART_ACCOUNT_SAFE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const ETH = 1_000_000_000_000_000_000n;

test("encodeRpcBlockHeaderToRlp round-trips Cancun JSON-RPC block headers and detects hash tampering", () => {
  const enc = new TextEncoder();
  const stateRoot = keccak256Bytes(enc.encode("live_rpc_state_root"));
  const parentBeaconRoot = keccak256Bytes(enc.encode("live_rpc_beacon_root"));
  const { blockHash } = buildExecutionHeader(128n, stateRoot, 1_760_000_012n, parentBeaconRoot);

  const rpcBlock = {
    hash: blockHash,
    parentHash: bytesToHex(keccak256Bytes(enc.encode("parent_hash"))),
    sha3Uncles: bytesToHex(keccak256Bytes(enc.encode("ommers_hash"))),
    miner: "0x0000000000000000000000000000000000000fee",
    stateRoot: bytesToHex(stateRoot),
    transactionsRoot: bytesToHex(keccak256Bytes(enc.encode("tx_root"))),
    receiptsRoot: bytesToHex(keccak256Bytes(enc.encode("receipts_root"))),
    logsBloom: `0x${"00".repeat(256)}`,
    difficulty: "0x0",
    number: "0x80",
    gasLimit: "0x1c9c380",
    gasUsed: "0xe4e1c0",
    timestamp: `0x${1_760_000_012n.toString(16)}`,
    extraData: bytesToHex(enc.encode("therdal-snapshot")),
    mixHash: bytesToHex(keccak256Bytes(enc.encode("prev_randao"))),
    nonce: "0x0000000000000000",
    baseFeePerGas: "0x2540be400",
    withdrawalsRoot: bytesToHex(keccak256Bytes(enc.encode("withdrawals_root"))),
    blobGasUsed: "0x0",
    excessBlobGas: "0x0",
    parentBeaconBlockRoot: bytesToHex(parentBeaconRoot),
  };

  const encoded = encodeRpcBlockHeaderToRlp(rpcBlock);
  assert.equal(encoded.blockHash, blockHash);
  assert.equal(encoded.blockNumber, 128n);

  const authenticatedRoot = authenticateExecutionHeader(
    128n,
    encoded.blockHashBytes,
    encoded.rlpHeader
  );
  assert.equal(bytesToHex(authenticatedRoot), bytesToHex(stateRoot));

  // Tampering with gasUsed without updating block.hash must throw ExecutionHeaderHashMismatch
  assert.throws(
    () => encodeRpcBlockHeaderToRlp({ ...rpcBlock, gasUsed: "0x1" }),
    (err) => err instanceof DirectVotingError && err.code === "ExecutionHeaderHashMismatch"
  );
});

test("encodeRpcAccountProofNodes wraps eth_getProof nodes and rejects malformed entries", () => {
  const { stateRootBytes, rlpAccountProofNodes } = buildSingleAccountTrie(
    EOA_ALICE,
    3n,
    25n * ETH
  );
  const rawNodes = rlpToList(parseRlpItem(rlpAccountProofNodes)).map((n) => bytesToHex(n.raw));

  const wrapped = encodeRpcAccountProofNodes(rawNodes);
  const verifiedWei = verifyExecutionBalanceProof(
    stateRootBytes,
    EOA_ALICE,
    wrapped.rlpAccountProofNodes
  );
  assert.equal(verifiedWei, 25n * ETH);

  assert.throws(
    () => encodeRpcAccountProofNodes([]),
    (err) => err instanceof DirectVotingError && err.code === "InvalidMPTProof"
  );
  assert.throws(
    () => encodeRpcAccountProofNodes(["0x80"]), // RLP empty string, not a list node
    (err) => err instanceof DirectVotingError && err.code === "InvalidMPTProof"
  );
});

test("buildMultiValidatorBeaconFixture matches single-validator root and supports multi-actor EOA + Smart Account stakes", () => {
  const enc = new TextEncoder();
  const snapHash = keccak256Bytes(enc.encode("anvil_snapshot_hash"));
  const pub0 = bytesToHex(keccak256Bytes(enc.encode("val_0")));

  // 1. Single validator equivalence check against buildSingleValidatorBeaconFixture
  const single = buildSingleValidatorBeaconFixture({
    pinnedExecutionBlockHash: snapHash,
    beaconSlot: 10_240_000n,
    childBlockTimestamp: 1_760_000_000n,
    validatorCount: 100n,
    validatorIndex: 42n,
    pubkeyRoot: pub0,
    withdrawalCredentials: makeWithdrawalCredentials(0x01, EOA_ALICE),
    effectiveBalanceGwei: 32_000_000_000n,
  });

  const multiEq = buildMultiValidatorBeaconFixture({
    pinnedExecutionBlockHash: snapHash,
    snapshotBlockNumber: 21_499_999n,
    beaconSlot: 10_240_000n,
    childBlockTimestamp: 1_760_000_000n,
    validatorCount: 100n,
    validators: [
      {
        validatorIndex: 42n,
        pubkeyRoot: pub0,
        withdrawalCredentials: makeWithdrawalCredentials(0x01, EOA_ALICE),
        effectiveBalanceGwei: 32_000_000_000n,
      },
    ],
  });
  assert.equal(multiEq.beaconBlockRoot, single.beaconBlockRoot);

  // 2. Multi-validator sparse tree across distant indices (0, 1, 77, 1048575) for EOA + Smart Account
  const multi = buildMultiValidatorBeaconFixture({
    pinnedExecutionBlockHash: snapHash,
    snapshotBlockNumber: 55n,
    beaconSlot: 10_240_000n,
    childBlockTimestamp: 1_760_000_012n,
    validatorCount: 2_000_000n,
    useElectraDepth: true,
    validators: [
      {
        validatorIndex: 0n,
        pubkeyRoot: bytesToHex(keccak256Bytes(enc.encode("eoa_0x01"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x01, EOA_ALICE),
        effectiveBalanceGwei: 32_000_000_000n,
      },
      {
        validatorIndex: 1n,
        pubkeyRoot: bytesToHex(keccak256Bytes(enc.encode("eoa_0x02"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x02, EOA_ALICE),
        effectiveBalanceGwei: 64_000_000_000n,
      },
      {
        validatorIndex: 1_048_575n,
        pubkeyRoot: bytesToHex(keccak256Bytes(enc.encode("sa_0x02"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x02, SMART_ACCOUNT_SAFE),
        effectiveBalanceGwei: 2_048_000_000_000n,
      },
    ],
  });

  const { snapshotBeaconRoot, snapshotEpoch } = authenticateBeaconSnapshot(
    snapHash,
    multi.beaconBlockRootBytes,
    multi.beaconAuth
  );

  assert.equal(
    verifyValidatorStakeProof(
      snapshotBeaconRoot,
      snapshotEpoch,
      EOA_ALICE,
      multi.validatorProofByIndex.get(0n)!
    ),
    32n * ETH
  );
  assert.equal(
    verifyValidatorStakeProof(
      snapshotBeaconRoot,
      snapshotEpoch,
      EOA_ALICE,
      multi.validatorProofByIndex.get(1n)!
    ),
    64n * ETH
  );
  assert.equal(
    verifyValidatorStakeProof(
      snapshotBeaconRoot,
      snapshotEpoch,
      SMART_ACCOUNT_SAFE,
      multi.validatorProofByIndex.get(1_048_575n)!
    ),
    2_048n * ETH
  );

  // Wrong voter address must fail with UnauthorizedWithdrawalAddress
  assert.throws(
    () =>
      verifyValidatorStakeProof(
        snapshotBeaconRoot,
        snapshotEpoch,
        EOA_ALICE,
        multi.validatorProofByIndex.get(1_048_575n)!
      ),
    (err) => err instanceof DirectVotingError && err.code === "UnauthorizedWithdrawalAddress"
  );
});
