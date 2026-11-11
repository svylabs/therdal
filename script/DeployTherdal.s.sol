// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../contracts/TherdalController.sol";
import "../contracts/StarkVerifierAdapter.sol";
import "../contracts/Therdal.sol";

/**
 * @title DeployTherdal
 * @notice Deployment script for Therdal Protocol v0.2 contracts.
 */
contract DeployTherdal {
    bytes32 public constant DEFAULT_PROGRAM_VKEY = keccak256("THERDAL_BATCH_PROGRAM_V2");

    function run(address initialOperator, address usdcToken)
        external
        returns (
            TherdalController controller,
            StarkVerifierAdapter verifierAdapter,
            Therdal therdal
        )
    {
        controller = new TherdalController(initialOperator, usdcToken, 6);
        verifierAdapter = new StarkVerifierAdapter(DEFAULT_PROGRAM_VKEY, address(0));
        therdal = new Therdal(address(controller), address(verifierAdapter), address(0));
    }
}
