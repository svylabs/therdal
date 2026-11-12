// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockERC4337SmartAccount
 * @notice Minimal ERC-4337 / ERC-1271 compatible Smart Account for local devnet & Foundry testing:
 *         - Holds native ETH (`receive()`) and non-zero contract storage (`owner`, `nonce`), ensuring
 *           its Ethereum MPT account leaf exercises non-empty `codeHash` and `storageRoot` paths.
 *         - Supports direct owner `execute` / `executeBatch` calls (Safe / Timelock style).
 *         - Supports bundler-relayed `executeWithSignature` calls using EIP-712 typed digest + ECDSA
 *           signature verification so a gas-paying bundler/relayer EOA can submit Therdal votes where
 *           `msg.sender` at `Therdal.sol` is this Smart Account.
 *         - Implements ERC-1271 `isValidSignature(bytes32,bytes)` (`0x1626ba7e`) for offline signed
 *           ballot verification.
 */
contract MockERC4337SmartAccount {
    bytes4 public constant ERC1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID = 0xffffffff;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );

    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256(
            "ExecuteOperation(address target,uint256 value,bytes32 dataHash,uint256 nonce,uint64 deadline)"
        );

    address public owner;
    uint256 public nonce;

    event Executed(address indexed target, uint256 value, bytes data, uint256 indexed usedNonce);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);

    error ZeroOwner();
    error ZeroTarget();
    error UnauthorizedCaller(address caller);
    error ArrayLengthMismatch();
    error ExpiredSignature(uint64 deadline, uint256 currentTimestamp);
    error InvalidSignatureLength(uint256 length);
    error InvalidOwnerSignature(address recovered, address expectedOwner);
    error CallFailed(bytes returnData);

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) {
            revert UnauthorizedCaller(msg.sender);
        }
    }

    constructor(address _owner) payable {
        if (_owner == address(0)) {
            revert ZeroOwner();
        }
        owner = _owner;
        emit OwnerUpdated(address(0), _owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroOwner();
        }
        address prev = owner;
        owner = newOwner;
        emit OwnerUpdated(prev, newOwner);
    }

    /**
     * @notice Direct owner execution entry point (`msg.sender` at `target` is `address(this)`).
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data
    ) external payable onlyOwner returns (bytes memory result) {
        uint256 usedNonce = nonce++;
        result = _call(target, value, data);
        emit Executed(target, value, data, usedNonce);
    }

    /**
     * @notice Atomic batch execution entry point (e.g. `approve` + `sponsorTopic`, or multi-topic voting).
     */
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata datas
    ) external payable onlyOwner returns (bytes[] memory results) {
        uint256 len = targets.length;
        if (len != values.length || len != datas.length) {
            revert ArrayLengthMismatch();
        }
        uint256 usedNonce = nonce++;
        results = new bytes[](len);
        for (uint256 i = 0; i < len; i++) {
            results[i] = _call(targets[i], values[i], datas[i]);
            emit Executed(targets[i], values[i], datas[i], usedNonce);
        }
    }

    /**
     * @notice ERC-4337 bundler/relayer style execution authorized by an offline owner EIP-712 signature.
     *         Any relayer EOA can pay L1 gas while `msg.sender` observed by `Therdal.sol` is `address(this)`.
     */
    function executeWithSignature(
        address target,
        uint256 value,
        bytes calldata data,
        uint64 deadline,
        bytes calldata signature
    ) external payable returns (bytes memory result) {
        if (block.timestamp > deadline) {
            revert ExpiredSignature(deadline, block.timestamp);
        }

        uint256 currentNonce = nonce;
        bytes32 digest = getExecuteDigest(target, value, data, currentNonce, deadline);
        address recovered = _recoverSigner(digest, signature);
        if (recovered != owner) {
            revert InvalidOwnerSignature(recovered, owner);
        }

        // Effects before external interaction (CEI)
        nonce = currentNonce + 1;

        result = _call(target, value, data);
        emit Executed(target, value, data, currentNonce);
    }

    /**
     * @notice Computes the EIP-712 digest signed by `owner` for `executeWithSignature`.
     */
    function getExecuteDigest(
        address target,
        uint256 value,
        bytes calldata data,
        uint256 opNonce,
        uint64 deadline
    ) public view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256("TherdalMockSmartAccount"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(EXECUTE_TYPEHASH, target, value, keccak256(data), opNonce, deadline)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    /**
     * @notice ERC-1271 smart-account signature verification (`0x1626ba7e` on valid `owner` signature).
     */
    function isValidSignature(
        bytes32 hash,
        bytes calldata signature
    ) external view returns (bytes4) {
        if (signature.length != 65) {
            return ERC1271_INVALID;
        }
        address recovered = _recoverSigner(hash, signature);
        return recovered == owner ? ERC1271_MAGIC_VALUE : ERC1271_INVALID;
    }

    function _call(
        address target,
        uint256 value,
        bytes calldata data
    ) internal returns (bytes memory ret) {
        if (target == address(0)) {
            revert ZeroTarget();
        }
        bool ok;
        (ok, ret) = target.call{value: value}(data);
        if (!ok) {
            revert CallFailed(ret);
        }
    }

    function _recoverSigner(
        bytes32 digest,
        bytes calldata signature
    ) internal pure returns (address) {
        if (signature.length != 65) {
            revert InvalidSignatureLength(signature.length);
        }
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            return address(0);
        }
        // Reject malleable high-s signatures (EIP-2)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }

    receive() external payable {}
}
