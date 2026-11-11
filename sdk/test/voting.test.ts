import assert from "node:assert/strict";
import test from "node:test";
import {
  DirectVotingError,
  authenticateBeaconSnapshot,
  authenticateExecutionHeader,
  buildExecutionHeader,
  buildSingleAccountTrie,
  buildSingleValidatorBeaconFixture,
  bytesToHex,
  computeValidatorPositionKey,
  computeValidatorRoot,
  computeWalletPositionKey,
  makeWithdrawalCredentials,
  sha256Bytes,
  verifyExecutionBalanceProof,
  verifyValidatorStakeProof,
} from "../src/index.ts";

const ALICE = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";
const BOB = "0x1563915e194D8CfBA1943570603F7606A3115508";
const ETH = 1_000_000_000_000_000_000n;

test("FIPS 180-4 SHA-256 matches NIST test vectors", () => {
  const enc = new TextEncoder();
  assert.equal(
    bytesToHex(sha256Bytes(new Uint8Array(0))),
    "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    bytesToHex(sha256Bytes(enc.encode("abc"))),
    "0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("cross-layer canonical voting vectors match Solidity and Rust byte-for-byte", () => {
  assert.equal(
    computeWalletPositionKey(1n, ALICE),
    "0xfdc983c4a6627025bb1acfb58480db21d43845f0caeddd82415a6190c3fb0ec4"
  );
  assert.equal(
    computeValidatorPositionKey(1n, 42n),
    "0x55505d5e6780e2e33dce1a71b9bd0ea0afe46418ab1ee55f0fdb4d0e4f312de4"
  );

  const validatorRoot = computeValidatorRoot({
    pubkeyRoot: "0x1111111111111111111111111111111111111111111111111111111111111111",
    withdrawalCredentials: makeWithdrawalCredentials(0x01, ALICE),
    effectiveBalanceGwei: 32_000_000_000n,
    slashed: false,
    activationEligibilityEpoch: 100n,
    activationEpoch: 110n,
    exitEpoch: 0xffffffffffffffffn,
    withdrawableEpoch: 0xffffffffffffffffn,
  });
  assert.equal(
    validatorRoot,
    "0xd43c10cf2e1a1f61413cf26c8b470a6e2bc223a7cb985b7f025247b20dea6ae0"
  );

  const trie = buildSingleAccountTrie(ALICE, 5n, 25n * ETH);
  assert.equal(
    trie.stateRoot,
    "0x6c964a28f19f91df3af2d04e7dea3d12cb853416b2cab63617302e2b89e45d54"
  );
});

test("authenticates execution snapshot header and verifies EIP-1186 MPT balance proof", () => {
  const trie = buildSingleAccountTrie(ALICE, 3n, 18n * ETH);
  const header = buildExecutionHeader(21_499_999n, trie.stateRootBytes, 1_760_000_000n);

  const stateRoot = authenticateExecutionHeader(
    21_499_999n,
    header.blockHashBytes,
    header.rlpHeader
  );
  const balance = verifyExecutionBalanceProof(stateRoot, ALICE, trie.rlpAccountProofNodes);
  assert.equal(balance, 18n * ETH);

  // Wrong voter rejected
  assert.throws(
    () => verifyExecutionBalanceProof(stateRoot, BOB, trie.rlpAccountProofNodes),
    (err: unknown) => err instanceof DirectVotingError && err.code === "MPTPathMismatch"
  );

  // Non-canonical RLP rejected
  assert.throws(
    () => verifyExecutionBalanceProof(stateRoot, ALICE, Uint8Array.from([0xc2, 0x81, 0x05])),
    (err: unknown) => err instanceof DirectVotingError && err.code === "NonCanonicalRLP"
  );
});

test("authenticates beacon snapshot and verifies Deneb & Electra validator stake proofs", () => {
  const trie = buildSingleAccountTrie(ALICE, 1n, 1n * ETH);
  const header = buildExecutionHeader(21_499_999n, trie.stateRootBytes, 1_760_000_000n);

  const built = buildSingleValidatorBeaconFixture({
    pinnedExecutionBlockHash: header.blockHashBytes,
    beaconSlot: 10_240_000n, // Epoch 320,000
    childBlockTimestamp: 1_760_000_012n,
    validatorCount: 1_000_000n,
    validatorIndex: 512_345n,
    pubkeyRoot: "0x2222222222222222222222222222222222222222222222222222222222222222",
    withdrawalCredentials: makeWithdrawalCredentials(0x02, ALICE),
    effectiveBalanceGwei: 2_048_000_000_000n, // 2048 ETH Pectra MaxEB
    useElectraDepth: true,
  });

  const { snapshotBeaconRoot, snapshotEpoch } = authenticateBeaconSnapshot(
    header.blockHashBytes,
    built.beaconBlockRootBytes,
    built.beaconAuth
  );
  assert.equal(snapshotEpoch, 320_000n);

  const stakeWei = verifyValidatorStakeProof(
    snapshotBeaconRoot,
    snapshotEpoch,
    ALICE,
    built.validatorProof
  );
  assert.equal(stakeWei, 2_048n * ETH);

  // Index substitution attack rejected
  assert.throws(
    () =>
      verifyValidatorStakeProof(snapshotBeaconRoot, snapshotEpoch, ALICE, {
        ...built.validatorProof,
        validatorIndex: 512_346n,
      }),
    (err: unknown) => err instanceof DirectVotingError && err.code === "InvalidValidatorProof"
  );

  // Unauthorized withdrawal address rejected
  assert.throws(
    () =>
      verifyValidatorStakeProof(snapshotBeaconRoot, snapshotEpoch, BOB, built.validatorProof),
    (err: unknown) =>
      err instanceof DirectVotingError && err.code === "UnauthorizedWithdrawalAddress"
  );
});
