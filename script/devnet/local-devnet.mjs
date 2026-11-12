#!/usr/bin/env node
/**
 * Therdal Local Ethereum Devnet Orchestrator & Stakeholder Voting Demo
 *
 * Capabilities:
 * - Launches a Cancun-enabled local `anvil` node (`chainId = 31337`).
 * - Etches `MockSystemRootOracle` at canonical EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`)
 *   and EIP-2935 (`0x0000F90827F1C53a10cb7A02335B175320002935`) system addresses.
 * - Deploys `MockStablecoin` (USDC), `TherdalController`, `Therdal`, and two funded
 *   `MockERC4337SmartAccount` contracts (`smartAccountA` for direct `execute`, `smartAccountB`
 *   for bundler-relayed `executeWithSignature`).
 * - Mines a post-genesis snapshot block (`>= 1` so Anvil computes full MPT `stateRoot`), builds
 *   multi-validator SHA-256 SSZ `BeaconState` + `BeaconBlockHeader` proofs (`0x01` & `0x02`
 *   withdrawal credentials across EOAs and Smart Accounts), registers Topic #1, and saves
 *   `.therdal-devnet.json`.
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bytesToHex,
  encodeRpcAccountProofNodes,
  encodeRpcBlockHeaderToRlp,
  hexToBytes,
  keccak256Bytes,
  makeWithdrawalCredentials,
  buildMultiValidatorBeaconFixture,
  verifyExecutionBalanceProof,
} from "../../sdk/src/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const DEFAULT_MANIFEST_PATH = path.join(REPO_ROOT, ".therdal-devnet.json");

export const EIP4788_BEACON_ROOTS = "0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02";
export const EIP2935_HISTORY_STORAGE = "0x0000F90827F1C53a10cb7A02335B175320002935";
export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const WEI_PER_ETH = 1_000_000_000_000_000_000n;

/**
 * Standard deterministic Anvil accounts (`test test ... junk` mnemonic).
 */
export const ANVIL_ACCOUNTS = {
  deployer: {
    index: 0,
    role: "Protocol Operator & Topic Creator",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    privateKey:
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  },
  eoaAlice: {
    index: 1,
    role: "EOA Voter + Staker (0x01 32 ETH + 0x02 64 ETH)",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    privateKey:
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  },
  eoaBob: {
    index: 2,
    role: "EOA Voter + Solo Staker (0x01 32 ETH)",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    privateKey:
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  },
  ownerSmartAccountA: {
    index: 3,
    role: "Owner of SmartAccountA (Direct `execute` Treasury + 128 ETH 0x01 Stake)",
    address: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    privateKey:
      "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  },
  ownerSmartAccountB: {
    index: 4,
    role: "Offline Signer of SmartAccountB (AA Relayed + 2,048 ETH 0x02 MaxEB Stake)",
    address: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
    privateKey:
      "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  },
  bundlerRelayer: {
    index: 5,
    role: "ERC-4337 Gas-Paying Bundler / Relayer EOA",
    address: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
    privateKey:
      "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  },
};

// -----------------------------------------------------------------------------
// JSON-RPC & Foundry CLI Helpers
// -----------------------------------------------------------------------------

export async function jsonRpc(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await res.json();
  if (payload.error) {
    const err = new Error(
      `RPC ${method} failed (${payload.error.code}): ${payload.error.message}`
    );
    err.rpcError = payload.error;
    throw err;
  }
  return payload.result;
}

export function ensureContractsCompiled() {
  const requiredArtifact = path.join(
    REPO_ROOT,
    "out",
    "SmartAccountHelpers.sol",
    "MockERC4337SmartAccount.json"
  );
  if (!fs.existsSync(requiredArtifact)) {
    execFileSync("forge", ["build"], { cwd: REPO_ROOT, stdio: "inherit" });
  }
}

function readArtifact(solFile, contractName) {
  const fullPath = path.join(REPO_ROOT, "out", solFile, `${contractName}.json`);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

export function castCalldata(sig, args = []) {
  return execFileSync(
    "cast",
    ["calldata", sig, ...args.map((a) => String(a))],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
}

export function castAbiEncode(sig, args = []) {
  return execFileSync(
    "cast",
    ["abi-encode", sig, ...args.map((a) => String(a))],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
}

export function castCallDecode(rpcUrl, to, sig, args = []) {
  return execFileSync(
    "cast",
    ["call", "--rpc-url", rpcUrl, to, sig, ...args.map((a) => String(a))],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
}

export function castSignRawDigest(privateKey, digestHex) {
  return execFileSync(
    "cast",
    ["wallet", "sign", "--no-hash", "--private-key", privateKey, digestHex],
    { cwd: REPO_ROOT, encoding: "utf8" }
  ).trim();
}

function concatCreationBytecode(bytecodeHex, encodedConstructorArgsHex) {
  const cleanCode = bytecodeHex.replace(/^0x/, "");
  const cleanArgs = (encodedConstructorArgsHex || "").replace(/^0x/, "");
  return `0x${cleanCode}${cleanArgs}`;
}

export async function sendUnlockedTx(rpcUrl, { from, to = null, data = "0x", value = 0n }) {
  const txParams = {
    from,
    data,
    value: `0x${BigInt(value).toString(16)}`,
    gas: "0x989680", // 10,000,000 gas limit for deep SHA-256 SSZ / MPT verification
  };
  if (to !== null) {
    txParams.to = to;
  }
  const txHash = await jsonRpc(rpcUrl, "eth_sendTransaction", [txParams]);
  const deadline = Date.now() + 5_000;
  let receipt = null;
  while (Date.now() < deadline) {
    receipt = await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [txHash]);
    if (receipt) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!receipt) {
    throw new Error(`Timed out waiting for receipt of transaction ${txHash}`);
  }
  if (receipt.status !== "0x1") {
    throw new Error(`Transaction ${txHash} reverted on local node.`);
  }
  return receipt;
}

/**
 * Computes storage slot for `mapping(uint256 => bytes32) internal _roots` at slot `0` in `MockSystemRootOracle`:
 * `keccak256(abi.encode(uint256(key), uint256(0)))`
 */
export function computeSystemOracleSlot(keyUint256) {
  const preimage = new Uint8Array(64);
  let rem = BigInt(keyUint256);
  for (let i = 31; i >= 0; i--) {
    preimage[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  // bytes 32..63 are already 0x00 (mapping slot = 0)
  return bytesToHex(keccak256Bytes(preimage));
}

// -----------------------------------------------------------------------------
// Anvil Process Lifecycle
// -----------------------------------------------------------------------------

export async function startAnvilNode({
  port = 8545,
  chainId = 31337,
  hardfork = "cancun",
  silent = true,
} = {}) {
  const args = [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--chain-id",
    String(chainId),
    "--hardfork",
    hardfork,
  ];
  if (silent) {
    args.push("--silent");
  }

  const child = spawn("anvil", args, {
    cwd: REPO_ROOT,
    stdio: silent ? "ignore" : "inherit",
  });

  const rpcUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    try {
      const netChainId = await jsonRpc(rpcUrl, "eth_chainId");
      if (BigInt(netChainId) === BigInt(chainId)) {
        return { child, rpcUrl, port, chainId };
      }
    } catch {
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  child.kill("SIGTERM");
  throw new Error(`Timed out waiting for Anvil at ${rpcUrl}`);
}

// -----------------------------------------------------------------------------
// Tuple Formatting Helpers for `cast calldata`
// -----------------------------------------------------------------------------

export function formatBeaconAuthTuple(beaconAuth) {
  if (!beaconAuth) {
    return `(0,0,[],${ZERO_BYTES32},[],[])`;
  }
  const slots = `[${beaconAuth.slotBranch.join(",")}]`;
  const states = `[${beaconAuth.stateRootBranch.join(",")}]`;
  const align = `[${beaconAuth.executionHashBranch.join(",")}]`;
  return `(${beaconAuth.childBlockTimestamp},${beaconAuth.beaconSlot},${slots},${beaconAuth.beaconStateRoot},${states},${align})`;
}

export function formatValidatorProofTuple(vp) {
  const branch = `[${vp.validatorBranch.join(",")}]`;
  const stateBranch = `[${vp.beaconStateBranch.join(",")}]`;
  return `(${vp.validatorIndex},${vp.pubkeyRoot},${vp.withdrawalCredentials},${vp.effectiveBalanceGwei},${vp.slashed},${vp.activationEligibilityEpoch},${vp.activationEpoch},${vp.exitEpoch},${vp.withdrawableEpoch},${branch},${vp.validatorsLengthChunk},${stateBranch})`;
}

export function formatDirectVoteBundleTuple({
  includeExecutionBalance,
  rlpExecutionHeaderHex = "0x",
  rlpAccountProofNodesHex = "0x",
  beaconAuth = null,
  validatorProofs = [],
}) {
  const hdr = rlpExecutionHeaderHex || "0x";
  const acct = rlpAccountProofNodesHex || "0x";
  const authStr = formatBeaconAuthTuple(beaconAuth);
  const valsStr = `[${validatorProofs.map(formatValidatorProofTuple).join(",")}]`;
  return `(${Boolean(includeExecutionBalance)},${hdr},${acct},${authStr},${valsStr})`;
}

// -----------------------------------------------------------------------------
// Live RPC Snapshot Proof Builder
// -----------------------------------------------------------------------------

export async function buildLiveExecutionProofForAddress(rpcUrl, snapshotBlockNumber, voterAddress) {
  const blockTag = `0x${BigInt(snapshotBlockNumber).toString(16)}`;
  const [rpcBlock, rpcProof] = await Promise.all([
    jsonRpc(rpcUrl, "eth_getBlockByNumber", [blockTag, false]),
    jsonRpc(rpcUrl, "eth_getProof", [voterAddress, [], blockTag]),
  ]);

  const header = encodeRpcBlockHeaderToRlp(rpcBlock);
  const { rlpAccountProofNodes, rlpAccountProofNodesHex } = encodeRpcAccountProofNodes(
    rpcProof.accountProof
  );

  // Verify locally via @therdal/sdk before sending on-chain
  const verifiedBalanceWei = verifyExecutionBalanceProof(
    header.stateRootBytes,
    voterAddress,
    rlpAccountProofNodes
  );

  return {
    snapshotBlockNumber: header.blockNumber,
    snapshotBlockHash: header.blockHash,
    snapshotExecutionRoot: header.stateRoot,
    rlpExecutionHeaderHex: header.rlpHeaderHex,
    rlpAccountProofNodesHex,
    verifiedBalanceWei,
  };
}

// -----------------------------------------------------------------------------
// Seed Topic + Multi-Validator Beacon Snapshot on Running Node
// -----------------------------------------------------------------------------

export async function createSeededTopicWithStakes(
  rpcUrl,
  {
    therdalAddress,
    usdcAddress,
    creatorAddress = ANVIL_ACCOUNTS.deployer.address,
    smartAccountAAddress,
    smartAccountBAddress,
    subject = "Should Ethereum scale L1 execution gas limit to 60M in the next hardfork?",
    options = [
      "Yes — 60M Gas Limit",
      "Conservative — 45M Step",
      "No — Keep Current Limit",
    ],
    sponsorshipUsdcMicros = 100_000_000n, // $100.00 USDC
    beaconSlot = 10_240_000n, // Epoch 320,000
  }
) {
  const utf8 = new TextEncoder();

  // Pre-approve sponsorship if requested so the next block after snapshot is `createTopic` itself
  if (sponsorshipUsdcMicros > 0n) {
    await sendUnlockedTx(rpcUrl, {
      from: creatorAddress,
      to: usdcAddress,
      data: castCalldata("approve(address,uint256)", [therdalAddress, sponsorshipUsdcMicros]),
    });
  } else {
    // Ensure we are strictly past Genesis Block 0 so Anvil computes canonical MPT stateRoot
    const latestHex = await jsonRpc(rpcUrl, "eth_blockNumber");
    if (BigInt(latestHex) === 0n) {
      await jsonRpc(rpcUrl, "evm_mine", []);
    }
  }

  // Current head block `S` will become `snapshotBlock = block.number - 1` when `createTopic` mines `S + 1`
  const snapshotRpcBlock = await jsonRpc(rpcUrl, "eth_getBlockByNumber", ["latest", false]);
  const encodedHeader = encodeRpcBlockHeaderToRlp(snapshotRpcBlock);
  const creationTimestamp = encodedHeader.timestamp + 12n;
  const votingEndsAt = creationTimestamp + 7n * 86_400n;

  // Build realistic validator set across EOAs & Smart Accounts (0x01 ETH1 + 0x02 Pectra Compounding)
  const beaconFixture = buildMultiValidatorBeaconFixture({
    pinnedExecutionBlockHash: encodedHeader.blockHashBytes,
    snapshotBlockNumber: encodedHeader.blockNumber,
    beaconSlot,
    childBlockTimestamp: creationTimestamp,
    validatorCount: 1_500_000n,
    useElectraDepth: true,
    validators: [
      {
        validatorIndex: 0n,
        pubkeyRoot: bytesToHex(keccak256Bytes(utf8.encode("devnet_alice_val_0"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x01, ANVIL_ACCOUNTS.eoaAlice.address),
        effectiveBalanceGwei: 32_000_000_000n, // 32 ETH (0x01)
      },
      {
        validatorIndex: 1n,
        pubkeyRoot: bytesToHex(keccak256Bytes(utf8.encode("devnet_alice_val_1"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x02, ANVIL_ACCOUNTS.eoaAlice.address),
        effectiveBalanceGwei: 64_000_000_000n, // 64 ETH (0x02 compounding)
      },
      {
        validatorIndex: 2n,
        pubkeyRoot: bytesToHex(keccak256Bytes(utf8.encode("devnet_bob_val_2"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x01, ANVIL_ACCOUNTS.eoaBob.address),
        effectiveBalanceGwei: 32_000_000_000n, // 32 ETH (0x01)
      },
      {
        validatorIndex: 10n,
        pubkeyRoot: bytesToHex(keccak256Bytes(utf8.encode("devnet_smart_account_a_val_10"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x01, smartAccountAAddress),
        effectiveBalanceGwei: 128_000_000_000n, // 128 ETH (0x01 Smart Account treasury)
      },
      {
        validatorIndex: 512n,
        pubkeyRoot: bytesToHex(keccak256Bytes(utf8.encode("devnet_smart_account_b_val_512"))),
        withdrawalCredentials: makeWithdrawalCredentials(0x02, smartAccountBAddress),
        effectiveBalanceGwei: 2_048_000_000_000n, // 2,048 ETH (0x02 Pectra MaxEB Smart Account)
      },
    ],
  });

  // Simulate Ethereum's EIP-4788 / EIP-2935 pre-block system calls at the start of block `S + 1`
  // WITHOUT calling `anvil_setStorageAt` on block `S` (which would mutate `S`'s historical MPT trie!).
  await jsonRpc(rpcUrl, "evm_setAutomine", [false]);
  await jsonRpc(rpcUrl, "anvil_setNextBlockTimestamp", [
    `0x${creationTimestamp.toString(16)}`,
  ]);

  const optionsArg = `[${options.map((o) => `"${o}"`).join(",")}]`;
  const txHash4788 = await jsonRpc(rpcUrl, "eth_sendTransaction", [
    {
      from: creatorAddress,
      to: EIP4788_BEACON_ROOTS,
      data: castCalldata("setRoot(uint256,bytes32)", [
        creationTimestamp,
        beaconFixture.beaconBlockRoot,
      ]),
      gas: "0x100000",
    },
  ]);
  const txHash2935 = await jsonRpc(rpcUrl, "eth_sendTransaction", [
    {
      from: creatorAddress,
      to: EIP2935_HISTORY_STORAGE,
      data: castCalldata("setRoot(uint256,bytes32)", [
        encodedHeader.blockNumber,
        encodedHeader.blockHash,
      ]),
      gas: "0x100000",
    },
  ]);
  const txHashCreate = await jsonRpc(rpcUrl, "eth_sendTransaction", [
    {
      from: creatorAddress,
      to: therdalAddress,
      data: castCalldata("createTopic(string,string[],uint64,uint256)", [
        subject,
        optionsArg,
        votingEndsAt,
        sponsorshipUsdcMicros,
      ]),
      gas: "0x989680",
    },
  ]);

  // Mine block `S + 1` containing [setRoot(4788), setRoot(2935), createTopic] and re-enable automine
  await jsonRpc(rpcUrl, "evm_mine", []);
  await jsonRpc(rpcUrl, "evm_setAutomine", [true]);

  for (const h of [txHash4788, txHash2935, txHashCreate]) {
    const rcpt = await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [h]);
    if (!rcpt || rcpt.status !== "0x1") {
      throw new Error(`Block S+1 setup transaction ${h} reverted.`);
    }
  }

  const topicCountRaw = castCallDecode(rpcUrl, therdalAddress, "topicCount()(uint256)");
  const topicId = BigInt(topicCountRaw.split(/\s+/)[0]);

  return {
    topicId,
    subject,
    options,
    votingEndsAt,
    snapshotBlock: encodedHeader.blockNumber,
    snapshotBlockHash: encodedHeader.blockHash,
    snapshotExecutionRoot: encodedHeader.stateRoot,
    rlpExecutionHeaderHex: encodedHeader.rlpHeaderHex,
    beaconBlockRoot: beaconFixture.beaconBlockRoot,
    beaconStateRoot: beaconFixture.beaconStateRoot,
    beaconAuth: beaconFixture.beaconAuth,
    validatorProofByIndex: beaconFixture.validatorProofByIndex,
  };
}

// -----------------------------------------------------------------------------
// Full Protocol Bootstrap on Local Anvil Node
// -----------------------------------------------------------------------------

export async function bootstrapLocalDevnet(
  rpcUrl,
  { manifestPath = DEFAULT_MANIFEST_PATH, writeManifest = true } = {}
) {
  ensureContractsCompiled();

  const chainIdHex = await jsonRpc(rpcUrl, "eth_chainId");
  const chainId = Number(BigInt(chainIdHex));
  const deployer = ANVIL_ACCOUNTS.deployer.address;

  // 1. Etch MockSystemRootOracle runtime bytecode at EIP-4788 & EIP-2935 system contract addresses
  const oracleArtifact = readArtifact("ProofTestHelpers.sol", "MockSystemRootOracle");
  await jsonRpc(rpcUrl, "anvil_setCode", [
    EIP4788_BEACON_ROOTS,
    oracleArtifact.deployedBytecode.object,
  ]);
  await jsonRpc(rpcUrl, "anvil_setCode", [
    EIP2935_HISTORY_STORAGE,
    oracleArtifact.deployedBytecode.object,
  ]);

  // 2. Deploy MockStablecoin (6-decimal USDC) & mint $10,000 USDC to deployer
  const usdcArtifact = readArtifact("TestHelpers.sol", "MockStablecoin");
  const usdcDeployReceipt = await sendUnlockedTx(rpcUrl, {
    from: deployer,
    data: concatCreationBytecode(
      usdcArtifact.bytecode.object,
      castAbiEncode("constructor(string,string,uint8)", ["USD Coin", "USDC", 6])
    ),
  });
  const usdcAddress = usdcDeployReceipt.contractAddress;

  await sendUnlockedTx(rpcUrl, {
    from: deployer,
    to: usdcAddress,
    data: castCalldata("mint(address,uint256)", [deployer, 10_000_000_000n]),
  });

  // 3. Deploy TherdalController & Therdal
  const controllerArtifact = readArtifact("TherdalController.sol", "TherdalController");
  const ctrlReceipt = await sendUnlockedTx(rpcUrl, {
    from: deployer,
    data: concatCreationBytecode(
      controllerArtifact.bytecode.object,
      castAbiEncode("constructor(address,address,uint8)", [deployer, usdcAddress, 6])
    ),
  });
  const controllerAddress = ctrlReceipt.contractAddress;

  const therdalArtifact = readArtifact("Therdal.sol", "Therdal");
  const therdalReceipt = await sendUnlockedTx(rpcUrl, {
    from: deployer,
    data: concatCreationBytecode(
      therdalArtifact.bytecode.object,
      castAbiEncode("constructor(address)", [controllerAddress])
    ),
  });
  const therdalAddress = therdalReceipt.contractAddress;

  // 4. Deploy & fund SmartAccountA (50 ETH) and SmartAccountB (120 ETH) BEFORE snapshot block!
  const saArtifact = readArtifact("SmartAccountHelpers.sol", "MockERC4337SmartAccount");

  const saAReceipt = await sendUnlockedTx(rpcUrl, {
    from: deployer,
    value: 50n * WEI_PER_ETH,
    data: concatCreationBytecode(
      saArtifact.bytecode.object,
      castAbiEncode("constructor(address)", [ANVIL_ACCOUNTS.ownerSmartAccountA.address])
    ),
  });
  const smartAccountAAddress = saAReceipt.contractAddress;

  const saBReceipt = await sendUnlockedTx(rpcUrl, {
    from: deployer,
    value: 120n * WEI_PER_ETH,
    data: concatCreationBytecode(
      saArtifact.bytecode.object,
      castAbiEncode("constructor(address)", [ANVIL_ACCOUNTS.ownerSmartAccountB.address])
    ),
  });
  const smartAccountBAddress = saBReceipt.contractAddress;

  // 5. Seed Topic #1 pinned to real Anvil MPT stateRoot + multi-validator EIP-4788 Beacon root
  const seededTopic = await createSeededTopicWithStakes(rpcUrl, {
    therdalAddress,
    usdcAddress,
    smartAccountAAddress,
    smartAccountBAddress,
  });

  const serializeBigInts = (obj) =>
    JSON.parse(
      JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v))
    );

  const manifest = {
    rpcUrl,
    chainId,
    contracts: {
      therdal: therdalAddress,
      controller: controllerAddress,
      usdc: usdcAddress,
      smartAccountA: smartAccountAAddress,
      smartAccountB: smartAccountBAddress,
      eip4788BeaconRoots: EIP4788_BEACON_ROOTS,
      eip2935HistoryStorage: EIP2935_HISTORY_STORAGE,
    },
    accounts: ANVIL_ACCOUNTS,
    seededTopic: serializeBigInts({
      topicId: seededTopic.topicId,
      subject: seededTopic.subject,
      options: seededTopic.options,
      votingEndsAt: seededTopic.votingEndsAt,
      snapshotBlock: seededTopic.snapshotBlock,
      snapshotBlockHash: seededTopic.snapshotBlockHash,
      snapshotExecutionRoot: seededTopic.snapshotExecutionRoot,
      rlpExecutionHeaderHex: seededTopic.rlpExecutionHeaderHex,
      beaconBlockRoot: seededTopic.beaconBlockRoot,
      beaconStateRoot: seededTopic.beaconStateRoot,
      beaconAuth: seededTopic.beaconAuth,
      validators: Object.fromEntries(
        Array.from(seededTopic.validatorProofByIndex.entries()).map(([idx, p]) => [
          idx.toString(),
          p,
        ])
      ),
    }),
  };

  if (writeManifest && manifestPath) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  return { manifest, seededTopic };
}

// -----------------------------------------------------------------------------
// End-to-End Multi-Stakeholder Showcase (EOA + Stake + Direct AA + Relayed AA)
// -----------------------------------------------------------------------------

export async function runStakeholderVotingShowcase(rpcUrl, manifest) {
  const { therdal, usdc, smartAccountA, smartAccountB } = manifest.contracts;

  // Create a fresh topic so `npm run devnet:demo` is idempotent across repeated runs
  const topic = await createSeededTopicWithStakes(rpcUrl, {
    therdalAddress: therdal,
    usdcAddress: usdc,
    smartAccountAAddress: smartAccountA,
    smartAccountBAddress: smartAccountB,
  });

  const topicId = topic.topicId;

  // 1. EOA Alice: Combined Execution Wallet ETH + Validator #0 (0x01 32 ETH) + Validator #1 (0x02 64 ETH) -> Option 0
  const aliceExec = await buildLiveExecutionProofForAddress(
    rpcUrl,
    topic.snapshotBlock,
    ANVIL_ACCOUNTS.eoaAlice.address
  );
  const aliceBundle = formatDirectVoteBundleTuple({
    includeExecutionBalance: true,
    rlpExecutionHeaderHex: aliceExec.rlpExecutionHeaderHex,
    rlpAccountProofNodesHex: aliceExec.rlpAccountProofNodesHex,
    beaconAuth: topic.beaconAuth,
    validatorProofs: [
      topic.validatorProofByIndex.get(0n),
      topic.validatorProofByIndex.get(1n),
    ],
  });
  await sendUnlockedTx(rpcUrl, {
    from: ANVIL_ACCOUNTS.eoaAlice.address,
    to: therdal,
    data: castCalldata(
      "voteDirect(uint256,uint32,(bool,bytes,bytes,(uint64,uint64,bytes32[],bytes32,bytes32[],bytes32[]),(uint64,bytes32,bytes32,uint64,bool,uint64,uint64,uint64,uint64,bytes32[],bytes32,bytes32[])[]))",
      [topicId, 0, aliceBundle]
    ),
  });

  // 2. EOA Bob: Beacon Stake ONLY (Validator #2, 0x01 32 ETH) reusing cached Beacon root -> Option 1
  const bobValTuple = `[${formatValidatorProofTuple(topic.validatorProofByIndex.get(2n))}]`;
  await sendUnlockedTx(rpcUrl, {
    from: ANVIL_ACCOUNTS.eoaBob.address,
    to: therdal,
    data: castCalldata(
      "voteWithBeaconStake(uint256,uint32,(uint64,uint64,bytes32[],bytes32,bytes32[],bytes32[]),(uint64,bytes32,bytes32,uint64,bool,uint64,uint64,uint64,uint64,bytes32[],bytes32,bytes32[])[])",
      [topicId, 1, formatBeaconAuthTuple(null), bobValTuple]
    ),
  });

  // 3. SmartAccountA: Direct owner `execute` with 50 ETH contract balance + Validator #10 (128 ETH 0x01) -> Option 0
  //    Reuses BOTH cached Execution & Beacon roots (`rlpHeader = 0x`, `beaconAuth = empty`)!
  const saAExec = await buildLiveExecutionProofForAddress(
    rpcUrl,
    topic.snapshotBlock,
    smartAccountA
  );
  const saABundle = formatDirectVoteBundleTuple({
    includeExecutionBalance: true,
    rlpExecutionHeaderHex: "0x",
    rlpAccountProofNodesHex: saAExec.rlpAccountProofNodesHex,
    beaconAuth: null,
    validatorProofs: [topic.validatorProofByIndex.get(10n)],
  });
  const saAVoteCalldata = castCalldata(
    "voteDirect(uint256,uint32,(bool,bytes,bytes,(uint64,uint64,bytes32[],bytes32,bytes32[],bytes32[]),(uint64,bytes32,bytes32,uint64,bool,uint64,uint64,uint64,uint64,bytes32[],bytes32,bytes32[])[]))",
    [topicId, 0, saABundle]
  );
  await sendUnlockedTx(rpcUrl, {
    from: ANVIL_ACCOUNTS.ownerSmartAccountA.address,
    to: smartAccountA,
    data: castCalldata("execute(address,uint256,bytes)", [therdal, 0, saAVoteCalldata]),
  });

  // 4. SmartAccountB: Bundler-relayed AA `executeWithSignature` with 120 ETH + Validator #512 (2,048 ETH 0x02 MaxEB) -> Option 1
  const saBExec = await buildLiveExecutionProofForAddress(
    rpcUrl,
    topic.snapshotBlock,
    smartAccountB
  );
  const saBBundle = formatDirectVoteBundleTuple({
    includeExecutionBalance: true,
    rlpExecutionHeaderHex: "0x",
    rlpAccountProofNodesHex: saBExec.rlpAccountProofNodesHex,
    beaconAuth: null,
    validatorProofs: [topic.validatorProofByIndex.get(512n)],
  });
  const saBVoteCalldata = castCalldata(
    "voteDirect(uint256,uint32,(bool,bytes,bytes,(uint64,uint64,bytes32[],bytes32,bytes32[],bytes32[]),(uint64,bytes32,bytes32,uint64,bool,uint64,uint64,uint64,uint64,bytes32[],bytes32,bytes32[])[]))",
    [topicId, 1, saBBundle]
  );

  const saBNonceStr = castCallDecode(rpcUrl, smartAccountB, "nonce()(uint256)").split(/\s+/)[0];
  const sigDeadline = topic.votingEndsAt;
  const digest = castCallDecode(
    rpcUrl,
    smartAccountB,
    "getExecuteDigest(address,uint256,bytes,uint256,uint64)(bytes32)",
    [therdal, 0, saBVoteCalldata, saBNonceStr, sigDeadline]
  ).trim();
  const ownerBSignature = castSignRawDigest(
    ANVIL_ACCOUNTS.ownerSmartAccountB.privateKey,
    digest
  );

  // Relayer EOA (`bundlerRelayer`) pays gas — `ownerSmartAccountB` never sends an on-chain tx!
  await sendUnlockedTx(rpcUrl, {
    from: ANVIL_ACCOUNTS.bundlerRelayer.address,
    to: smartAccountB,
    data: castCalldata("executeWithSignature(address,uint256,bytes,uint64,bytes)", [
      therdal,
      0,
      saBVoteCalldata,
      sigDeadline,
      ownerBSignature,
    ]),
  });

  const talliesOutput = castCallDecode(
    rpcUrl,
    therdal,
    "getTopicTallies(uint256)((uint256,uint256[],uint256[],uint256,uint256,uint256))",
    [topicId]
  );

  return {
    topicId,
    snapshotBlock: topic.snapshotBlock,
    aliceWalletWei: aliceExec.verifiedBalanceWei,
    saAWalletWei: saAExec.verifiedBalanceWei,
    saBWalletWei: saBExec.verifiedBalanceWei,
    expectedOption0Wei:
      aliceExec.verifiedBalanceWei + (32n + 64n) * WEI_PER_ETH + (50n + 128n) * WEI_PER_ETH,
    expectedOption1Wei: 32n * WEI_PER_ETH + (120n + 2_048n) * WEI_PER_ETH,
    talliesOutput,
  };
}

// -----------------------------------------------------------------------------
// CLI Entrypoint
// -----------------------------------------------------------------------------

function formatEth(wei) {
  const whole = wei / WEI_PER_ETH;
  const milli = ((wei % WEI_PER_ETH) * 1000n) / WEI_PER_ETH;
  return `${whole}.${milli.toString().padStart(3, "0")} ETH`;
}

function printDevnetBanner(manifest) {
  console.log("================================================================================");
  console.log("  Therdal Local Ethereum Devnet Ready");
  console.log("================================================================================");
  console.log(`  RPC URL:               ${manifest.rpcUrl}  (Chain ID: ${manifest.chainId})`);
  console.log(`  Therdal Registry:      ${manifest.contracts.therdal}`);
  console.log(`  TherdalController:     ${manifest.contracts.controller}`);
  console.log(`  Mock USDC (6 dec):     ${manifest.contracts.usdc}`);
  console.log(`  SmartAccountA (50 ETH):${manifest.contracts.smartAccountA}`);
  console.log(`  SmartAccountB (120ETH):${manifest.contracts.smartAccountB}`);
  console.log(`  EIP-4788 Beacon Roots: ${manifest.contracts.eip4788BeaconRoots}`);
  console.log(`  EIP-2935 Block Hashes: ${manifest.contracts.eip2935HistoryStorage}`);
  console.log("--------------------------------------------------------------------------------");
  console.log(
    `  Seeded Topic #${manifest.seededTopic.topicId}: "${manifest.seededTopic.subject}"`
  );
  console.log(
    `  Pinned Snapshot Block: #${manifest.seededTopic.snapshotBlock} (${manifest.seededTopic.snapshotBlockHash})`
  );
  console.log(
    `  Pinned Beacon Root:    ${manifest.seededTopic.beaconBlockRoot}`
  );
  console.log(`  Manifest Saved To:     ${DEFAULT_MANIFEST_PATH}`);
  console.log("================================================================================");
}

async function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0] || "start";
  const portFlagIdx = args.indexOf("--port");
  const port = portFlagIdx !== -1 ? Number(args[portFlagIdx + 1]) : 8545;
  const rpcFlagIdx = args.indexOf("--rpc-url");
  const rpcUrl = rpcFlagIdx !== -1 ? args[rpcFlagIdx + 1] : `http://127.0.0.1:${port}`;

  if (subcommand === "start") {
    const node = await startAnvilNode({ port, silent: false });
    const shutdown = () => {
      node.child.kill("SIGTERM");
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    const { manifest } = await bootstrapLocalDevnet(node.rpcUrl);
    printDevnetBanner(manifest);
    console.log("  Press Ctrl+C to stop local Anvil devnet.\n");
    await new Promise(() => {}); // Keep foreground daemon alive
  } else if (subcommand === "seed") {
    const { manifest } = await bootstrapLocalDevnet(rpcUrl);
    printDevnetBanner(manifest);
  } else if (subcommand === "demo") {
    const manifest = fs.existsSync(DEFAULT_MANIFEST_PATH)
      ? JSON.parse(fs.readFileSync(DEFAULT_MANIFEST_PATH, "utf8"))
      : (await bootstrapLocalDevnet(rpcUrl)).manifest;

    const summary = await runStakeholderVotingShowcase(rpcUrl, manifest);
    console.log("================================================================================");
    console.log(`  Live Multi-Stakeholder Voting Showcase Complete (Topic #${summary.topicId})`);
    console.log("================================================================================");
    console.log(
      `  Option [0] Expected Weight: ${formatEth(summary.expectedOption0Wei)} (EOA Alice + 0x01/0x02 Stake + SmartAccountA)`
    );
    console.log(
      `  Option [1] Expected Weight: ${formatEth(summary.expectedOption1Wei)} (EOA Bob Stake + Relayed SmartAccountB 0x02 MaxEB)`
    );
    console.log(`  On-Chain Tallies Tuple:     ${summary.talliesOutput}`);
    console.log("================================================================================");
  } else {
    throw new Error(`Unknown subcommand "${subcommand}". Expected: start | seed | demo`);
  }
}

if (path.resolve(process.argv[1] || "") === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
