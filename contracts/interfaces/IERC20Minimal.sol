// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IERC20Minimal
 * @notice Minimal ERC-20 interface with decimals for USD stablecoin settlement & escrow.
 */
interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/**
 * @title SafeERC20Helper
 * @notice Safe ERC-20 transfer wrappers supporting both standard boolean-returning tokens (USDC)
 *         and non-returning tokens (USDT), plus non-reverting `trySafeTransfer` for pull-fallback safety.
 */
library SafeERC20Helper {
    error ERC20TransferFailed(address token, address to, uint256 amount);
    error ERC20TransferFromFailed(address token, address from, address to, uint256 amount);

    function safeTransfer(
        address token,
        address to,
        uint256 amount
    ) internal {
        if (!trySafeTransfer(token, to, amount)) {
            revert ERC20TransferFailed(token, to, amount);
        }
    }

    function trySafeTransfer(
        address token,
        address to,
        uint256 amount
    ) internal returns (bool) {
        if (amount == 0) return true;
        if (token.code.length == 0) return false;
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount)
        );
        return ok && (data.length == 0 || abi.decode(data, (bool)));
    }

    function safeTransferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        if (token.code.length == 0) {
            revert ERC20TransferFromFailed(token, from, to, amount);
        }
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ERC20TransferFromFailed(token, from, to, amount);
        }
    }
}
