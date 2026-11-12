import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import {
  ANVIL_ACCOUNTS,
  bootstrapLocalDevnet,
  buildLiveExecutionProofForAddress,
  castCallDecode,
  castCalldata,
  jsonRpc,
  runStakeholderVotingShowcase,
  sendUnlockedTx,
  startAnvilNode,
} from "./local-devnet.mjs";

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 18599;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

test("ephemeral local Anvil E2E: EOA, 0x01/0x02 Beacon Stake, Direct SmartAccount, Relayed AA SmartAccount, and Post-Snapshot Transfer Invariance", async () => {
  const port = await getFreePort();
  const node = await startAnvilNode({ port, silent: true });

  try {
    const { manifest, seededTopic } = await bootstrapLocalDevnet(node.rpcUrl, {
      writeManifest: false,
    });
    const { therdal, smartAccountA, smartAccountB } = manifest.contracts;

    // 1. Verify Topic #1 pinned both snapshotBlockHash and EIP-4788 snapshotBeaconBlockRoot
    const snapshotStateRaw = castCallDecode(
      node.rpcUrl,
      therdal,
      "getSnapshotState(uint256)((uint64,bytes32,bytes32,bytes32,bytes32,uint64,bool,bool))",
      [seededTopic.topicId]
    );
    assert.match(snapshotStateRaw, new RegExp(seededTopic.snapshotBlockHash, "i"));
    assert.match(snapshotStateRaw, new RegExp(seededTopic.beaconBlockRoot, "i"));

    // 2. Post-snapshot transfer invariance on Topic #1:
    //    Send 500 ETH away from eoaBob AFTER Topic #1 was created, then prove eoaBob's FULL
    //    pre-transfer snapshot balance via live `eth_getProof` at `seededTopic.snapshotBlock`!
    const bobPreProof = await buildLiveExecutionProofForAddress(
      node.rpcUrl,
      seededTopic.snapshotBlock,
      ANVIL_ACCOUNTS.eoaBob.address
    );
    await sendUnlockedTx(node.rpcUrl, {
      from: ANVIL_ACCOUNTS.eoaBob.address,
      to: ANVIL_ACCOUNTS.bundlerRelayer.address,
      value: 500n * WEI_PER_ETH,
    });

    await sendUnlockedTx(node.rpcUrl, {
      from: ANVIL_ACCOUNTS.eoaBob.address,
      to: therdal,
      data: castCalldata("voteWithExecutionBalance(uint256,uint32,bytes,bytes)", [
        seededTopic.topicId,
        2,
        bobPreProof.rlpExecutionHeaderHex,
        bobPreProof.rlpAccountProofNodesHex,
      ]),
    });

    const bobVotedTopic1 = castCallDecode(
      node.rpcUrl,
      therdal,
      "hasWalletVoted(uint256,address)(bool)",
      [seededTopic.topicId, ANVIL_ACCOUNTS.eoaBob.address]
    );
    assert.equal(bobVotedTopic1, "true");

    // Attempting a second execution vote on Topic #1 must revert on Anvil
    await assert.rejects(async () => {
      await jsonRpc(node.rpcUrl, "eth_call", [
        {
          from: ANVIL_ACCOUNTS.eoaBob.address,
          to: therdal,
          data: castCalldata("voteWithExecutionBalance(uint256,uint32,bytes,bytes)", [
            seededTopic.topicId,
            2,
            "0x",
            bobPreProof.rlpAccountProofNodesHex,
          ]),
        },
        "latest",
      ]);
    });

    // 3. Full multi-actor showcase on Topic #2 (EOA + 0x01/0x02 Stake + SmartAccountA `execute` + Bundler-Relayed SmartAccountB `executeWithSignature`)
    const summary = await runStakeholderVotingShowcase(node.rpcUrl, manifest);

    assert.equal(
      castCallDecode(node.rpcUrl, therdal, "hasWalletVoted(uint256,address)(bool)", [
        summary.topicId,
        ANVIL_ACCOUNTS.eoaAlice.address,
      ]),
      "true"
    );
    assert.equal(
      castCallDecode(node.rpcUrl, therdal, "hasWalletVoted(uint256,address)(bool)", [
        summary.topicId,
        smartAccountA,
      ]),
      "true"
    );
    assert.equal(
      castCallDecode(node.rpcUrl, therdal, "hasWalletVoted(uint256,address)(bool)", [
        summary.topicId,
        smartAccountB,
      ]),
      "true"
    );

    for (const valIdx of [0, 1, 2, 10, 512]) {
      assert.equal(
        castCallDecode(node.rpcUrl, therdal, "hasValidatorVoted(uint256,uint64)(bool)", [
          summary.topicId,
          valIdx,
        ]),
        "true",
        `Expected validator #${valIdx} to be marked voted`
      );
    }

    // Verify exact Option 0 & Option 1 wei weights appear in on-chain `getTopicTallies`
    assert.match(summary.talliesOutput, new RegExp(summary.expectedOption0Wei.toString()));
    assert.match(summary.talliesOutput, new RegExp(summary.expectedOption1Wei.toString()));

    // Verify Topic #2's $100.00 USDC SponsorEscrow remained 100% untouched ($0 direct vote fee)
    const remainingEscrowRaw = castCallDecode(
      node.rpcUrl,
      therdal,
      "remainingEscrow(uint256)(uint256)",
      [summary.topicId]
    ).split(/\s+/)[0];
    assert.equal(BigInt(remainingEscrowRaw), 100_000_000n);
  } finally {
    node.child.kill("SIGTERM");
  }
});
