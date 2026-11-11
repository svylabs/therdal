// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../contracts/BatchRegistry.sol";
import "../../contracts/SponsorEscrow.sol";

/**
 * @title MockStablecoin
 * @notice Configurable-decimals ERC-20 mock (e.g. 6-decimal USDC or 18-decimal DAI) with optional blacklist simulation.
 */
contract MockStablecoin {
    string public name;
    string public symbol;
    uint8 public immutable decimals;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blacklisted;

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setBlacklisted(address account, bool isBlacklisted) external {
        blacklisted[account] = isBlacklisted;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(!blacklisted[msg.sender] && !blacklisted[to], "BLACKLISTED");
        require(balanceOf[msg.sender] >= amount, "INSUFFICIENT_BALANCE");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        require(!blacklisted[from] && !blacklisted[to], "BLACKLISTED");
        require(balanceOf[from] >= amount, "INSUFFICIENT_BALANCE");
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "INSUFFICIENT_ALLOWANCE");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title MockSystemContract
 * @notice Simulates EIP-2935 historical block hashes or EIP-4788 beacon block roots at system addresses.
 */
contract MockSystemContract {
    mapping(uint256 => bytes32) public values;

    function set(uint256 key, bytes32 val) external {
        values[key] = val;
    }

    fallback(bytes calldata input) external returns (bytes memory) {
        if (input.length == 32) {
            uint256 key = abi.decode(input, (uint256));
            bytes32 val = values[key];
            if (val != bytes32(0)) {
                return abi.encode(val);
            }
        }
        revert("Value not found");
    }
}

/**
 * @title MockBlobHashReader
 * @notice Simulates EIP-4844 transaction `blobhash(i)` values in Foundry tests.
 */
contract MockBlobHashReader is IBlobHashReader {
    bytes32[] private _blobHashes;

    function setBlobHashes(bytes32[] calldata hashes) external {
        delete _blobHashes;
        for (uint256 i = 0; i < hashes.length; i++) {
            _blobHashes.push(hashes[i]);
        }
    }

    function getBlobHash(uint256 index) external view override returns (bytes32) {
        if (index < _blobHashes.length) {
            return _blobHashes[index];
        }
        return bytes32(0);
    }
}

/**
 * @title RLPEncoderHelper
 * @notice Helper library for constructing valid RLP-encoded Ethereum block headers, accounts, and MPT nodes in tests.
 */
library RLPEncoderHelper {
    function encodeBytes(bytes memory data) internal pure returns (bytes memory) {
        if (data.length == 1 && uint8(data[0]) < 0x80) {
            return data;
        }
        return abi.encodePacked(_encodeLength(data.length, 0x80), data);
    }

    function encodeBytes32(bytes32 val) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes1(0xa0), val);
    }

    function encodeUint(uint256 val) internal pure returns (bytes memory) {
        if (val == 0) {
            return abi.encodePacked(bytes1(0x80));
        }
        uint256 temp = val;
        uint256 byteLen = 0;
        while (temp != 0) {
            byteLen++;
            temp >>= 8;
        }
        bytes memory data = new bytes(byteLen);
        temp = val;
        for (uint256 i = byteLen; i > 0; i--) {
            data[i - 1] = bytes1(uint8(temp & 0xff));
            temp >>= 8;
        }
        return encodeBytes(data);
    }

    function encodeList(bytes[] memory items) internal pure returns (bytes memory) {
        uint256 totalLen = 0;
        for (uint256 i = 0; i < items.length; i++) {
            totalLen += items[i].length;
        }
        bytes memory payload = new bytes(totalLen);
        uint256 offset = 0;
        for (uint256 i = 0; i < items.length; i++) {
            bytes memory item = items[i];
            for (uint256 j = 0; j < item.length; j++) {
                payload[offset++] = item[j];
            }
        }
        return abi.encodePacked(_encodeLength(totalLen, 0xc0), payload);
    }

    function encodeEthereumAccount(
        uint256 nonce,
        uint256 balance,
        bytes32 storageRoot,
        bytes32 codeHash
    ) internal pure returns (bytes memory) {
        bytes[] memory fields = new bytes[](4);
        fields[0] = encodeUint(nonce);
        fields[1] = encodeUint(balance);
        fields[2] = encodeBytes32(storageRoot);
        fields[3] = encodeBytes32(codeHash);
        return encodeList(fields);
    }

    function encodeExecutionHeader(
        bytes32 stateRoot,
        uint64 blockNumber,
        uint64 timestamp
    ) internal pure returns (bytes memory) {
        bytes[] memory fields = new bytes[](15);
        fields[0] = encodeBytes32(keccak256("parentHash"));
        fields[1] = encodeBytes32(keccak256("ommersHash"));
        fields[2] = encodeBytes(abi.encodePacked(address(0x1111111111111111111111111111111111111111)));
        fields[3] = encodeBytes32(stateRoot);
        fields[4] = encodeBytes32(keccak256("transactionsRoot"));
        fields[5] = encodeBytes32(keccak256("receiptsRoot"));
        fields[6] = encodeBytes(new bytes(256));
        fields[7] = encodeUint(0);
        fields[8] = encodeUint(blockNumber);
        fields[9] = encodeUint(30_000_000);
        fields[10] = encodeUint(15_000_000);
        fields[11] = encodeUint(timestamp);
        fields[12] = encodeBytes(hex"1234");
        fields[13] = encodeBytes32(keccak256("mixHash"));
        fields[14] = encodeBytes(hex"0000000000000000");
        return encodeList(fields);
    }

    function buildTwoAccountMPT(
        address voterA,
        bytes memory rlpAccountA,
        address voterB,
        bytes memory rlpAccountB
    )
        internal
        pure
        returns (
            bytes32 stateRoot,
            bytes memory proofA,
            bytes memory proofB
        )
    {
        bytes32 keyA = keccak256(abi.encodePacked(voterA));
        bytes32 keyB = keccak256(abi.encodePacked(voterB));

        uint8 firstNibbleA = uint8(keyA[0]) >> 4;
        uint8 firstNibbleB = uint8(keyB[0]) >> 4;
        require(firstNibbleA != firstNibbleB, "First nibbles must differ");

        bytes memory compactPathA = new bytes(32);
        compactPathA[0] = bytes1(0x30 | (uint8(keyA[0]) & 0x0f));
        for (uint256 i = 1; i < 32; i++) {
            compactPathA[i] = keyA[i];
        }

        bytes memory compactPathB = new bytes(32);
        compactPathB[0] = bytes1(0x30 | (uint8(keyB[0]) & 0x0f));
        for (uint256 i = 1; i < 32; i++) {
            compactPathB[i] = keyB[i];
        }

        bytes[] memory leafFieldsA = new bytes[](2);
        leafFieldsA[0] = encodeBytes(compactPathA);
        leafFieldsA[1] = encodeBytes(rlpAccountA);
        bytes memory leafNodeA = encodeList(leafFieldsA);
        bytes32 leafHashA = keccak256(leafNodeA);

        bytes[] memory leafFieldsB = new bytes[](2);
        leafFieldsB[0] = encodeBytes(compactPathB);
        leafFieldsB[1] = encodeBytes(rlpAccountB);
        bytes memory leafNodeB = encodeList(leafFieldsB);
        bytes32 leafHashB = keccak256(leafNodeB);

        bytes[] memory branchFields = new bytes[](17);
        for (uint256 i = 0; i < 17; i++) {
            if (i == firstNibbleA) {
                branchFields[i] = encodeBytes32(leafHashA);
            } else if (i == firstNibbleB) {
                branchFields[i] = encodeBytes32(leafHashB);
            } else {
                branchFields[i] = abi.encodePacked(bytes1(0x80));
            }
        }
        bytes memory branchNode = encodeList(branchFields);
        stateRoot = keccak256(branchNode);

        bytes[] memory proofListA = new bytes[](2);
        proofListA[0] = branchNode;
        proofListA[1] = leafNodeA;
        proofA = encodeList(proofListA);

        bytes[] memory proofListB = new bytes[](2);
        proofListB[0] = branchNode;
        proofListB[1] = leafNodeB;
        proofB = encodeList(proofListB);
    }

    function _encodeLength(uint256 len, uint8 offset) private pure returns (bytes memory) {
        if (len < 56) {
            return abi.encodePacked(bytes1(uint8(offset + len)));
        }
        uint256 temp = len;
        uint256 byteLen = 0;
        while (temp != 0) {
            byteLen++;
            temp >>= 8;
        }
        bytes memory result = new bytes(1 + byteLen);
        result[0] = bytes1(uint8(offset + 55 + byteLen));
        temp = len;
        for (uint256 i = byteLen; i > 0; i--) {
            result[i] = bytes1(uint8(temp & 0xff));
            temp >>= 8;
        }
        return result;
    }
}
