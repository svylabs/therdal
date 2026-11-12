// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITopicRegistry} from "../../contracts/interfaces/ITopicRegistry.sol";

/**
 * @title Vm
 * @notice Minimal Foundry cheatcode interface used across Stage 1 tests.
 */
interface Vm {
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newBlockNumber) external;
    function prank(address msgSender) external;
    function deal(address who, uint256 newBalance) external;
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function setBlockhash(uint256 blockNumber, bytes32 blockHash) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function chainId(uint256 newChainId) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 revertSelector) external;
}

/**
 * @title MockStablecoin
 * @notice Configurable-decimals ERC-20 mock (e.g. 6-decimal USDC or 18-decimal DAI) using custom errors.
 */
contract MockStablecoin {
    string public name;
    string public symbol;
    uint8 public immutable DECIMALS;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error InsufficientBalance(address account, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowed, uint256 needed);

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) {
        name = _name;
        symbol = _symbol;
        DECIMALS = _decimals;
    }

    function decimals() external view returns (uint8) {
        return DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) {
            revert InsufficientBalance(msg.sender, balanceOf[msg.sender], amount);
        }
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        if (balanceOf[from] < amount) {
            revert InsufficientBalance(from, balanceOf[from], amount);
        }
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) {
            revert InsufficientAllowance(msg.sender, allowed, amount);
        }
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title MockNonReturningERC20
 * @notice Simulates legacy USDT-style ERC-20 tokens whose `transfer`/`transferFrom` return empty calldata.
 */
contract MockNonReturningERC20 {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error InsufficientBalance();
    error InsufficientAllowance();

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transfer(address to, uint256 amount) external {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        if (allowance[from][msg.sender] < amount) revert InsufficientAllowance();
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/**
 * @title MockReentrantERC20
 * @notice Malicious ERC-20 attempting to re-enter `Therdal.sponsorTopic` or `Therdal.createTopic` during `transferFrom`.
 */
contract MockReentrantERC20 {
    uint8 public constant decimals = 6;
    ITopicRegistry public immutable TARGET;
    bool public attackOnTransfer;

    constructor(address _target) {
        TARGET = ITopicRegistry(_target);
    }

    function setAttack(bool enabled) external {
        attackOnTransfer = enabled;
    }

    function transferFrom(
        address,
        address,
        uint256 amount
    ) external returns (bool) {
        if (attackOnTransfer) {
            TARGET.sponsorTopic(1, amount);
        }
        return true;
    }
}
