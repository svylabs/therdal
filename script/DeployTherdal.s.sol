// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TherdalController} from "../contracts/TherdalController.sol";
import {Therdal} from "../contracts/Therdal.sol";

/**
 * @title DeployTherdal
 * @notice Stage 1 deployment script for `TherdalController` and `Therdal` Topic Registry.
 */
contract DeployTherdal {
    function run(address initialOperator, address usdcToken)
        external
        returns (TherdalController controller, Therdal therdal)
    {
        controller = new TherdalController(initialOperator, usdcToken, 6);
        therdal = new Therdal(address(controller));
    }
}
