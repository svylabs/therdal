// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../../contracts/interfaces/IDirectVoting.sol";
import {SSZVerifier} from "../../contracts/libraries/SSZVerifier.sol";

/**
 * @title MockSystemRootOracle
 * @notice Minimal mock etched at EIP-4788 (`0x000F3df6D732807Ef1319fB7B8bB8522d0Beac02`) or
 *         EIP-2935 (`0x0000F90827F1C53a10cb7A02335B175320002935`).
 *         Responds to raw 32-byte `staticcall(abi.encode(uint256(key)))` with the configured `bytes32` root,
 *         reverting when unconfigured (matching EIP-4788 / EIP-2935 miss semantics).
 */
contract MockSystemRootOracle {
    mapping(uint256 => bytes32) internal _roots;

    error RootNotFound();

    function setRoot(uint256 key, bytes32 root) external {
        _roots[key] = root;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        if (input.length != 32) {
            revert RootNotFound();
        }
        uint256 key = abi.decode(input, (uint256));
        bytes32 root = _roots[key];
        if (root == bytes32(0)) {
            revert RootNotFound();
        }
        return abi.encode(root);
    }
}

/**
 * @title RlpEncoderHelper
 * @notice Canonical RLP encoder used in tests to construct genuine Ethereum execution block headers,
 *         account tuples, and EIP-1186 Merkle Patricia Trie proof nodes.
 */
library RlpEncoderHelper {
    function encodeBytes(bytes memory data) internal pure returns (bytes memory) {
        uint256 len = data.length;
        if (len == 1 && uint8(data[0]) < 0x80) {
            return data;
        }
        if (len <= 55) {
            // casting to 'uint8' is safe because 0x80 + len <= 0xb7
            // forge-lint: disable-next-line(unsafe-typecast)
            return abi.encodePacked(uint8(0x80 + len), data);
        }
        bytes memory lenBytes = _toMinimalBigEndian(len);
        // casting to 'uint8' is safe because lenBytes.length <= 8
        // forge-lint: disable-next-line(unsafe-typecast)
        return abi.encodePacked(uint8(0xb7 + lenBytes.length), lenBytes, data);
    }

    function encodeBytes32(bytes32 val) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0xa0), val);
    }

    function encodeAddress(address addr) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(0x94), addr);
    }

    function encodeUint(uint256 val) internal pure returns (bytes memory) {
        if (val == 0) {
            return abi.encodePacked(uint8(0x80));
        }
        return encodeBytes(_toMinimalBigEndian(val));
    }

    function encodeList(bytes[] memory encodedItems) internal pure returns (bytes memory) {
        uint256 totalPayload = 0;
        for (uint256 i = 0; i < encodedItems.length; i++) {
            totalPayload += encodedItems[i].length;
        }

        bytes memory payload = new bytes(totalPayload);
        uint256 offset = 0;
        for (uint256 i = 0; i < encodedItems.length; i++) {
            bytes memory item = encodedItems[i];
            for (uint256 j = 0; j < item.length; j++) {
                payload[offset++] = item[j];
            }
        }

        if (totalPayload <= 55) {
            // casting to 'uint8' is safe because 0xc0 + totalPayload <= 0xf7
            // forge-lint: disable-next-line(unsafe-typecast)
            return abi.encodePacked(uint8(0xc0 + totalPayload), payload);
        }
        bytes memory lenBytes = _toMinimalBigEndian(totalPayload);
        // casting to 'uint8' is safe because lenBytes.length <= 8
        // forge-lint: disable-next-line(unsafe-typecast)
        return abi.encodePacked(uint8(0xf7 + lenBytes.length), lenBytes, payload);
    }

    function buildExecutionHeader(
        uint64 blockNumber,
        bytes32 stateRoot,
        uint64 timestamp,
        bytes32 parentBeaconBlockRoot
    ) internal pure returns (bytes memory rlpHeader, bytes32 blockHash) {
        bytes[] memory fields = new bytes[](20);
        fields[0] = encodeBytes32(keccak256("parent_hash"));
        fields[1] = encodeBytes32(keccak256("ommers_hash"));
        fields[2] = encodeAddress(address(0xFEE));
        fields[3] = encodeBytes32(stateRoot);
        fields[4] = encodeBytes32(keccak256("tx_root"));
        fields[5] = encodeBytes32(keccak256("receipts_root"));
        fields[6] = encodeBytes(new bytes(256)); // logsBloom
        fields[7] = encodeUint(0); // difficulty (PoS = 0)
        fields[8] = encodeUint(blockNumber);
        fields[9] = encodeUint(30_000_000); // gasLimit
        fields[10] = encodeUint(15_000_000); // gasUsed
        fields[11] = encodeUint(timestamp);
        fields[12] = encodeBytes("therdal-snapshot");
        fields[13] = encodeBytes32(keccak256("prev_randao"));
        fields[14] = encodeBytes(new bytes(8)); // nonce
        fields[15] = encodeUint(10 gwei); // baseFeePerGas
        fields[16] = encodeBytes32(keccak256("withdrawals_root"));
        fields[17] = encodeUint(0); // blobGasUsed
        fields[18] = encodeUint(0); // excessBlobGas
        fields[19] = encodeBytes32(parentBeaconBlockRoot);

        rlpHeader = encodeList(fields);
        blockHash = keccak256(rlpHeader);
    }

    function encodeAccountLeafValue(
        uint256 nonce,
        uint256 balanceWei
    ) internal pure returns (bytes memory) {
        bytes[] memory fields = new bytes[](4);
        fields[0] = encodeUint(nonce);
        fields[1] = encodeUint(balanceWei);
        fields[2] = encodeBytes32(keccak256("empty_storage_root"));
        fields[3] = encodeBytes32(keccak256("empty_code_hash"));
        return encodeList(fields);
    }

    /**
     * @notice Encodes compact hex-prefix (`HP`) path for MPT leaf (`isLeaf = true`) or extension (`isLeaf = false`).
     */
    function encodeCompactPath(
        bytes memory nibbles,
        bool isLeaf
    ) internal pure returns (bytes memory out) {
        bool isOdd = (nibbles.length % 2 == 1);
        uint8 prefix = (isLeaf ? 2 : 0) + (isOdd ? 1 : 0);

        if (isOdd) {
            out = new bytes(1 + (nibbles.length - 1) / 2);
            out[0] = bytes1((prefix << 4) | uint8(nibbles[0]));
            uint256 idx = 1;
            for (uint256 i = 1; i < nibbles.length; i += 2) {
                out[idx++] = bytes1((uint8(nibbles[i]) << 4) | uint8(nibbles[i + 1]));
            }
        } else {
            out = new bytes(1 + nibbles.length / 2);
            out[0] = bytes1(prefix << 4);
            uint256 idx = 1;
            for (uint256 i = 0; i < nibbles.length; i += 2) {
                out[idx++] = bytes1((uint8(nibbles[i]) << 4) | uint8(nibbles[i + 1]));
            }
        }
    }

    function toNibbles(bytes32 keyHash) internal pure returns (bytes memory nibbles) {
        nibbles = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            uint8 b = uint8(keyHash[i]);
            nibbles[i * 2] = bytes1(b >> 4);
            nibbles[i * 2 + 1] = bytes1(b & 0x0f);
        }
    }

    function sliceNibbles(
        bytes memory nibbles,
        uint256 start,
        uint256 end
    ) internal pure returns (bytes memory sub) {
        sub = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            sub[i - start] = nibbles[i];
        }
    }

    /**
     * @notice Builds a single-leaf MPT state trie for `(account, balanceWei)`, returning `(stateRoot, rlpAccountProofNodes)`.
     */
    function buildSingleAccountTrie(
        address account,
        uint256 nonce,
        uint256 balanceWei
    ) internal pure returns (bytes32 stateRoot, bytes memory rlpProofNodes) {
        bytes32 keyHash = keccak256(abi.encodePacked(account));
        bytes memory fullNibbles = toNibbles(keyHash);
        bytes memory hp = encodeCompactPath(fullNibbles, true);
        bytes memory accountVal = encodeAccountLeafValue(nonce, balanceWei);

        bytes[] memory leafFields = new bytes[](2);
        leafFields[0] = encodeBytes(hp);
        leafFields[1] = encodeBytes(accountVal);
        bytes memory leafNodeRlp = encodeList(leafFields);

        stateRoot = keccak256(leafNodeRlp);

        bytes[] memory proofList = new bytes[](1);
        proofList[0] = leafNodeRlp;
        rlpProofNodes = encodeList(proofList);
    }

    /**
     * @notice Builds a multi-account MPT trie supporting shared-prefix extension + 17-item branch + leaf nodes
     *         for two distinct accounts `(acctA, balA)` and `(acctB, balB)`.
     */
    function buildTwoAccountTrie(
        address acctA,
        uint256 balA,
        address acctB,
        uint256 balB
    )
        internal
        pure
        returns (bytes32 stateRoot, bytes memory proofA, bytes memory proofB)
    {
        bytes memory nibA = toNibbles(keccak256(abi.encodePacked(acctA)));
        bytes memory nibB = toNibbles(keccak256(abi.encodePacked(acctB)));

        uint256 shared = 0;
        while (shared < 64 && nibA[shared] == nibB[shared]) {
            shared++;
        }

        // Leaf A & Leaf B consume nibbles from `shared + 1 .. 64`
        bytes memory leafANode = _makeLeafNode(
            sliceNibbles(nibA, shared + 1, 64),
            encodeAccountLeafValue(1, balA)
        );
        bytes memory leafBNode = _makeLeafNode(
            sliceNibbles(nibB, shared + 1, 64),
            encodeAccountLeafValue(2, balB)
        );

        bytes[] memory branchItems = new bytes[](17);
        for (uint256 i = 0; i < 17; i++) {
            branchItems[i] = abi.encodePacked(uint8(0x80)); // empty RLP string
        }
        branchItems[uint8(nibA[shared])] = leafANode.length >= 32
            ? encodeBytes32(keccak256(leafANode))
            : leafANode;
        branchItems[uint8(nibB[shared])] = leafBNode.length >= 32
            ? encodeBytes32(keccak256(leafBNode))
            : leafBNode;

        bytes memory branchNode = encodeList(branchItems);

        if (shared == 0) {
            stateRoot = keccak256(branchNode);

            bytes[] memory nodesA = new bytes[](2);
            nodesA[0] = branchNode;
            nodesA[1] = leafANode;
            proofA = encodeList(nodesA);

            bytes[] memory nodesB = new bytes[](2);
            nodesB[0] = branchNode;
            nodesB[1] = leafBNode;
            proofB = encodeList(nodesB);
        } else {
            bytes[] memory extFields = new bytes[](2);
            extFields[0] = encodeBytes(encodeCompactPath(sliceNibbles(nibA, 0, shared), false));
            extFields[1] = encodeBytes32(keccak256(branchNode));
            bytes memory extNode = encodeList(extFields);

            stateRoot = keccak256(extNode);

            bytes[] memory nodesA = new bytes[](3);
            nodesA[0] = extNode;
            nodesA[1] = branchNode;
            nodesA[2] = leafANode;
            proofA = encodeList(nodesA);

            bytes[] memory nodesB = new bytes[](3);
            nodesB[0] = extNode;
            nodesB[1] = branchNode;
            nodesB[2] = leafBNode;
            proofB = encodeList(nodesB);
        }
    }

    function _makeLeafNode(
        bytes memory suffixNibbles,
        bytes memory accountVal
    ) private pure returns (bytes memory) {
        bytes[] memory fields = new bytes[](2);
        fields[0] = encodeBytes(encodeCompactPath(suffixNibbles, true));
        fields[1] = encodeBytes(accountVal);
        return encodeList(fields);
    }

    function _toMinimalBigEndian(uint256 val) private pure returns (bytes memory out) {
        uint256 temp = val;
        uint256 byteLen = 0;
        while (temp != 0) {
            byteLen++;
            temp >>= 8;
        }
        out = new bytes(byteLen);
        temp = val;
        for (uint256 i = byteLen; i > 0; i--) {
            // casting to 'uint8' is safe because masked by 0xff
            // forge-lint: disable-next-line(unsafe-typecast)
            out[i - 1] = bytes1(uint8(temp & 0xff));
            temp >>= 8;
        }
    }
}

/**
 * @title BeaconSszTestBuilder
 * @notice Builds authentic depth-40 SSZ `List[Validator, 2**40]` trees, `BeaconState` roots (Deneb & Electra),
 *         `ExecutionPayloadHeader` alignment branches (`index = 780`), and `BeaconBlockHeader` roots.
 */
library BeaconSszTestBuilder {
    struct ValidatorFixture {
        uint64 validatorIndex;
        bytes32 pubkeyRoot;
        bytes32 withdrawalCredentials;
        uint64 effectiveBalanceGwei;
        bool slashed;
        uint64 activationEligibilityEpoch;
        uint64 activationEpoch;
        uint64 exitEpoch;
        uint64 withdrawableEpoch;
    }

    function eth1WithdrawalCredentials(address withdrawalAddr) internal pure returns (bytes32) {
        return bytes32((uint256(0x01) << 248) | uint256(uint160(withdrawalAddr)));
    }

    function compoundingWithdrawalCredentials(
        address withdrawalAddr
    ) internal pure returns (bytes32) {
        return bytes32((uint256(0x02) << 248) | uint256(uint160(withdrawalAddr)));
    }

    function blsWithdrawalCredentials(bytes32 hash) internal pure returns (bytes32) {
        return bytes32(uint256(hash) & ((uint256(1) << 248) - 1)); // leading byte = 0x00
    }

    function computeZeroHashes() internal view returns (bytes32[41] memory zeroHashes) {
        zeroHashes[0] = bytes32(0);
        for (uint256 h = 1; h <= 40; h++) {
            zeroHashes[h] = SSZVerifier.sha256Pair(zeroHashes[h - 1], zeroHashes[h - 1]);
        }
    }

    /**
     * @notice Builds a complete, spec-authentic Beacon snapshot + validator proofs for up to 4 validators
     *         placed in a small low-index subtree (`validatorIndex < 4`) of the depth-40 `validators` list,
     *         or a single arbitrary `validatorIndex < 2**40`.
     */
    function buildSingleValidatorBeaconFixture(
        bytes32 pinnedExecutionBlockHash,
        uint64 beaconSlot,
        uint64 childBlockTimestamp,
        uint64 validatorCount,
        ValidatorFixture memory v,
        bool useElectraDepth
    )
        internal
        view
        returns (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory valProof
        )
    {
        bytes32[41] memory z = computeZeroHashes();

        bytes32 valRoot = SSZVerifier.computeValidatorRoot(
            v.pubkeyRoot,
            v.withdrawalCredentials,
            v.effectiveBalanceGwei,
            v.slashed,
            v.activationEligibilityEpoch,
            v.activationEpoch,
            v.exitEpoch,
            v.withdrawableEpoch
        );

        // 1. Build depth-40 validators data tree with `valRoot` at `v.validatorIndex` and `z[i]` siblings
        bytes32[] memory validatorBranch = new bytes32[](40);
        bytes32 cur = valRoot;
        for (uint256 i = 0; i < 40; i++) {
            validatorBranch[i] = z[i];
            if (((v.validatorIndex >> i) & 1) == 1) {
                cur = SSZVerifier.sha256Pair(z[i], cur);
            } else {
                cur = SSZVerifier.sha256Pair(cur, z[i]);
            }
        }
        bytes32 validatorsLengthChunk = SSZVerifier.toLittleEndian64Chunk(validatorCount);
        bytes32 validatorsListRoot = SSZVerifier.sha256Pair(cur, validatorsLengthChunk);

        // 2. Build ExecutionPayloadHeader (32 leaves, depth 5) with `pinnedExecutionBlockHash` at leaf 12
        bytes32[32] memory execPayloadLeaves;
        execPayloadLeaves[12] = pinnedExecutionBlockHash;
        execPayloadLeaves[6] = SSZVerifier.toLittleEndian64Chunk(21_499_999);
        (bytes32 execPayloadRoot, bytes32[] memory execInnerBranch) = _merkleize32(
            execPayloadLeaves,
            12
        );

        // 3. Build BeaconState (32 leaves for Deneb depth 5, or 64 leaves for Electra depth 6)
        //    Field 11 = validatorsListRoot, Field 24 = execPayloadRoot
        bytes32 beaconStateRoot;
        bytes32[] memory stateBranchForVal;
        bytes32[] memory stateBranchForExec;
        if (!useElectraDepth) {
            bytes32[32] memory stateLeaves;
            stateLeaves[11] = validatorsListRoot;
            stateLeaves[24] = execPayloadRoot;
            (beaconStateRoot, stateBranchForVal) = _merkleize32(stateLeaves, 11);
            (, stateBranchForExec) = _merkleize32(stateLeaves, 24);
        } else {
            bytes32[64] memory stateLeaves64;
            stateLeaves64[11] = validatorsListRoot;
            stateLeaves64[24] = execPayloadRoot;
            (beaconStateRoot, stateBranchForVal) = _merkleize64(stateLeaves64, 11);
            (, stateBranchForExec) = _merkleize64(stateLeaves64, 24);
        }

        // Concatenate execInnerBranch (5) + stateBranchForExec (5 or 6) -> 10 or 11 hashes for index 780
        bytes32[] memory executionHashBranch = new bytes32[](
            execInnerBranch.length + stateBranchForExec.length
        );
        for (uint256 i = 0; i < execInnerBranch.length; i++) {
            executionHashBranch[i] = execInnerBranch[i];
        }
        for (uint256 i = 0; i < stateBranchForExec.length; i++) {
            executionHashBranch[execInnerBranch.length + i] = stateBranchForExec[i];
        }

        // 4. Build BeaconBlockHeader (8 leaves, depth 3):
        //    leaf 0 = slot, leaf 1 = proposer_index, leaf 2 = parent_root, leaf 3 = beaconStateRoot, leaf 4 = body_root
        bytes32[8] memory headerLeaves;
        headerLeaves[0] = SSZVerifier.toLittleEndian64Chunk(beaconSlot);
        headerLeaves[1] = SSZVerifier.toLittleEndian64Chunk(7);
        headerLeaves[2] = keccak256("parent_beacon_root");
        headerLeaves[3] = beaconStateRoot;
        headerLeaves[4] = keccak256("beacon_body_root");

        bytes32[] memory slotBranch;
        bytes32[] memory stateRootBranch;
        (beaconBlockRoot, slotBranch) = _merkleize8(headerLeaves, 0);
        (, stateRootBranch) = _merkleize8(headerLeaves, 3);

        authProof = IDirectVoting.BeaconSnapshotAuthProof({
            childBlockTimestamp: childBlockTimestamp,
            beaconSlot: beaconSlot,
            slotBranch: slotBranch,
            beaconStateRoot: beaconStateRoot,
            stateRootBranch: stateRootBranch,
            executionHashBranch: executionHashBranch
        });

        valProof = IDirectVoting.ValidatorStakeProof({
            validatorIndex: v.validatorIndex,
            pubkeyRoot: v.pubkeyRoot,
            withdrawalCredentials: v.withdrawalCredentials,
            effectiveBalanceGwei: v.effectiveBalanceGwei,
            slashed: v.slashed,
            activationEligibilityEpoch: v.activationEligibilityEpoch,
            activationEpoch: v.activationEpoch,
            exitEpoch: v.exitEpoch,
            withdrawableEpoch: v.withdrawableEpoch,
            validatorBranch: validatorBranch,
            validatorsLengthChunk: validatorsLengthChunk,
            beaconStateBranch: stateBranchForVal
        });
    }

    /**
     * @notice Builds a 2-validator (`index 0` and `index 1`) Beacon fixture sharing the same `BeaconState`.
     */
    function buildTwoValidatorBeaconFixture(
        bytes32 pinnedExecutionBlockHash,
        uint64 beaconSlot,
        uint64 childBlockTimestamp,
        ValidatorFixture memory v0,
        ValidatorFixture memory v1
    )
        internal
        view
        returns (
            bytes32 beaconBlockRoot,
            IDirectVoting.BeaconSnapshotAuthProof memory authProof,
            IDirectVoting.ValidatorStakeProof memory proof0,
            IDirectVoting.ValidatorStakeProof memory proof1
        )
    {
        bytes32[41] memory z = computeZeroHashes();

        bytes32 r0 = SSZVerifier.computeValidatorRoot(
            v0.pubkeyRoot,
            v0.withdrawalCredentials,
            v0.effectiveBalanceGwei,
            v0.slashed,
            v0.activationEligibilityEpoch,
            v0.activationEpoch,
            v0.exitEpoch,
            v0.withdrawableEpoch
        );
        bytes32 r1 = SSZVerifier.computeValidatorRoot(
            v1.pubkeyRoot,
            v1.withdrawalCredentials,
            v1.effectiveBalanceGwei,
            v1.slashed,
            v1.activationEligibilityEpoch,
            v1.activationEpoch,
            v1.exitEpoch,
            v1.withdrawableEpoch
        );

        bytes32 pair01 = SSZVerifier.sha256Pair(r0, r1);
        bytes32 cur = pair01;
        for (uint256 i = 1; i < 40; i++) {
            cur = SSZVerifier.sha256Pair(cur, z[i]);
        }
        bytes32 validatorsLengthChunk = SSZVerifier.toLittleEndian64Chunk(2);
        bytes32 validatorsListRoot = SSZVerifier.sha256Pair(cur, validatorsLengthChunk);

        bytes32[] memory branch0 = new bytes32[](40);
        bytes32[] memory branch1 = new bytes32[](40);
        branch0[0] = r1;
        branch1[0] = r0;
        for (uint256 i = 1; i < 40; i++) {
            branch0[i] = z[i];
            branch1[i] = z[i];
        }

        bytes32[32] memory execPayloadLeaves;
        execPayloadLeaves[12] = pinnedExecutionBlockHash;
        (bytes32 execPayloadRoot, bytes32[] memory execInnerBranch) = _merkleize32(
            execPayloadLeaves,
            12
        );

        bytes32[32] memory stateLeaves;
        stateLeaves[11] = validatorsListRoot;
        stateLeaves[24] = execPayloadRoot;
        (bytes32 beaconStateRoot, bytes32[] memory stateBranchVal) = _merkleize32(stateLeaves, 11);
        (, bytes32[] memory stateBranchExec) = _merkleize32(stateLeaves, 24);

        bytes32[] memory executionHashBranch = new bytes32[](10);
        for (uint256 i = 0; i < 5; i++) {
            executionHashBranch[i] = execInnerBranch[i];
            executionHashBranch[5 + i] = stateBranchExec[i];
        }

        bytes32[8] memory headerLeaves;
        headerLeaves[0] = SSZVerifier.toLittleEndian64Chunk(beaconSlot);
        headerLeaves[3] = beaconStateRoot;
        (beaconBlockRoot, authProof.slotBranch) = _merkleize8(headerLeaves, 0);
        (, authProof.stateRootBranch) = _merkleize8(headerLeaves, 3);
        authProof.childBlockTimestamp = childBlockTimestamp;
        authProof.beaconSlot = beaconSlot;
        authProof.beaconStateRoot = beaconStateRoot;
        authProof.executionHashBranch = executionHashBranch;

        proof0 = IDirectVoting.ValidatorStakeProof({
            validatorIndex: 0,
            pubkeyRoot: v0.pubkeyRoot,
            withdrawalCredentials: v0.withdrawalCredentials,
            effectiveBalanceGwei: v0.effectiveBalanceGwei,
            slashed: v0.slashed,
            activationEligibilityEpoch: v0.activationEligibilityEpoch,
            activationEpoch: v0.activationEpoch,
            exitEpoch: v0.exitEpoch,
            withdrawableEpoch: v0.withdrawableEpoch,
            validatorBranch: branch0,
            validatorsLengthChunk: validatorsLengthChunk,
            beaconStateBranch: stateBranchVal
        });

        proof1 = IDirectVoting.ValidatorStakeProof({
            validatorIndex: 1,
            pubkeyRoot: v1.pubkeyRoot,
            withdrawalCredentials: v1.withdrawalCredentials,
            effectiveBalanceGwei: v1.effectiveBalanceGwei,
            slashed: v1.slashed,
            activationEligibilityEpoch: v1.activationEligibilityEpoch,
            activationEpoch: v1.activationEpoch,
            exitEpoch: v1.exitEpoch,
            withdrawableEpoch: v1.withdrawableEpoch,
            validatorBranch: branch1,
            validatorsLengthChunk: validatorsLengthChunk,
            beaconStateBranch: stateBranchVal
        });
    }

    function _merkleize8(
        bytes32[8] memory leaves,
        uint256 targetIdx
    ) private view returns (bytes32 root, bytes32[] memory branch) {
        branch = new bytes32[](3);
        bytes32[] memory layer = new bytes32[](8);
        for (uint256 i = 0; i < 8; i++) layer[i] = leaves[i];
        uint256 idx = targetIdx;
        for (uint256 d = 0; d < 3; d++) {
            branch[d] = layer[idx ^ 1];
            uint256 nextLen = layer.length / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 j = 0; j < nextLen; j++) {
                next[j] = SSZVerifier.sha256Pair(layer[j * 2], layer[j * 2 + 1]);
            }
            layer = next;
            idx >>= 1;
        }
        root = layer[0];
    }

    function _merkleize32(
        bytes32[32] memory leaves,
        uint256 targetIdx
    ) private view returns (bytes32 root, bytes32[] memory branch) {
        branch = new bytes32[](5);
        bytes32[] memory layer = new bytes32[](32);
        for (uint256 i = 0; i < 32; i++) layer[i] = leaves[i];
        uint256 idx = targetIdx;
        for (uint256 d = 0; d < 5; d++) {
            branch[d] = layer[idx ^ 1];
            uint256 nextLen = layer.length / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 j = 0; j < nextLen; j++) {
                next[j] = SSZVerifier.sha256Pair(layer[j * 2], layer[j * 2 + 1]);
            }
            layer = next;
            idx >>= 1;
        }
        root = layer[0];
    }

    function _merkleize64(
        bytes32[64] memory leaves,
        uint256 targetIdx
    ) private view returns (bytes32 root, bytes32[] memory branch) {
        branch = new bytes32[](6);
        bytes32[] memory layer = new bytes32[](64);
        for (uint256 i = 0; i < 64; i++) layer[i] = leaves[i];
        uint256 idx = targetIdx;
        for (uint256 d = 0; d < 6; d++) {
            branch[d] = layer[idx ^ 1];
            uint256 nextLen = layer.length / 2;
            bytes32[] memory next = new bytes32[](nextLen);
            for (uint256 j = 0; j < nextLen; j++) {
                next[j] = SSZVerifier.sha256Pair(layer[j * 2], layer[j * 2 + 1]);
            }
            layer = next;
            idx >>= 1;
        }
        root = layer[0];
    }
}
