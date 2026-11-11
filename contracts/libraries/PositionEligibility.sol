// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IDirectVoting} from "../interfaces/IDirectVoting.sol";
import {MerklePatriciaProofVerifier} from "./MerklePatriciaProofVerifier.sol";
import {SSZVerifier} from "./SSZVerifier.sol";

/**
 * @title PositionEligibility
 * @notice Pure/view cryptographic verification and canonical position key derivation for
 *         Execution Layer wallet ETH (`THERDAL_WALLET`) and Beacon Chain validator stakes
 *         (`THERDAL_VALIDATOR`) at snapshot time.
 */
library PositionEligibility {
    /// @notice Domain separation prefix for Execution Layer wallet positions (`66`-byte preimage)
    bytes internal constant WALLET_DOMAIN_TAG = "THERDAL_WALLET";

    /// @notice Domain separation prefix for Beacon Chain validator positions (`57`-byte preimage)
    bytes internal constant VALIDATOR_DOMAIN_TAG = "THERDAL_VALIDATOR";

    /// @notice Standard ETH1 withdrawal credential prefix (`0x01`)
    uint8 internal constant WITHDRAWAL_PREFIX_ETH1 = 0x01;

    /// @notice EIP-7251 Pectra compounding validator withdrawal credential prefix (`0x02`)
    uint8 internal constant WITHDRAWAL_PREFIX_COMPOUNDING = 0x02;

    /// @notice Conversion factor from Gwei (`1e9` wei) to Wei
    uint256 internal constant GWEI_TO_WEI = 1e9;

    /**
     * @notice Computes the canonical cross-layer position key for an Execution Layer wallet:
     *         `keccak256(abi.encodePacked("THERDAL_WALLET", uint256(chainId), address(account)))`
     */
    function computeWalletPositionKey(
        uint256 chainId,
        address account
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(WALLET_DOMAIN_TAG, chainId, account));
    }

    /**
     * @notice Computes the canonical cross-layer position key for a Beacon Chain validator:
     *         `keccak256(abi.encodePacked("THERDAL_VALIDATOR", uint256(chainId), uint64(validatorIndex)))`
     */
    function computeValidatorPositionKey(
        uint256 chainId,
        uint64 validatorIndex
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(VALIDATOR_DOMAIN_TAG, chainId, validatorIndex));
    }

    /**
     * @notice Verifies an EIP-1186 MPT account proof for `voter` against `snapshotExecutionRoot`,
     *         returning the account's snapshot ETH balance in wei (reverting on `0` balance).
     */
    function verifyExecutionBalanceProof(
        bytes32 snapshotExecutionRoot,
        address voter,
        bytes calldata rlpAccountProofNodes
    ) internal pure returns (uint256 balanceWei) {
        bytes32 accountKeyHash = keccak256(abi.encodePacked(voter));
        bytes memory accountRlp = MerklePatriciaProofVerifier.verifyAccountProof(
            snapshotExecutionRoot,
            accountKeyHash,
            rlpAccountProofNodes
        );
        (, balanceWei, , ) = MerklePatriciaProofVerifier.decodeAccount(accountRlp);
        if (balanceWei == 0) {
            revert IDirectVoting.ZeroVotingWeight();
        }
    }

    /**
     * @notice Verifies a Beacon Chain `Validator` SSZ inclusion proof and eligibility rules for `voter`
     *         at `(snapshotBeaconRoot, snapshotEpoch)`, returning `effectiveBalanceGwei * 1e9` wei.
     */
    function verifyValidatorStakeProof(
        bytes32 snapshotBeaconRoot,
        uint64 snapshotEpoch,
        address voter,
        IDirectVoting.ValidatorStakeProof calldata proof
    ) internal view returns (uint256 stakeWei) {
        if (proof.validatorIndex >= SSZVerifier.VALIDATOR_REGISTRY_LIMIT) {
            revert IDirectVoting.ValidatorIndexOutOfRange(proof.validatorIndex);
        }
        if (proof.slashed) {
            revert IDirectVoting.ValidatorSlashed(proof.validatorIndex);
        }
        if (proof.activationEpoch > snapshotEpoch || snapshotEpoch >= proof.exitEpoch) {
            revert IDirectVoting.ValidatorNotActiveAtSnapshot(
                proof.validatorIndex,
                proof.activationEpoch,
                proof.exitEpoch,
                snapshotEpoch
            );
        }

        uint8 prefix = uint8(proof.withdrawalCredentials[0]);
        if (prefix != WITHDRAWAL_PREFIX_ETH1 && prefix != WITHDRAWAL_PREFIX_COMPOUNDING) {
            revert IDirectVoting.UnsupportedWithdrawalPrefix(proof.validatorIndex, prefix);
        }

        address credentialAddr = address(uint160(uint256(proof.withdrawalCredentials)));
        if (credentialAddr != voter) {
            revert IDirectVoting.UnauthorizedWithdrawalAddress(
                proof.validatorIndex,
                voter,
                credentialAddr
            );
        }

        if (proof.effectiveBalanceGwei == 0) {
            revert IDirectVoting.ZeroVotingWeight();
        }

        bytes32 validatorRoot = SSZVerifier.computeValidatorRoot(
            proof.pubkeyRoot,
            proof.withdrawalCredentials,
            proof.effectiveBalanceGwei,
            proof.slashed,
            proof.activationEligibilityEpoch,
            proof.activationEpoch,
            proof.exitEpoch,
            proof.withdrawableEpoch
        );

        bool validInclusion = SSZVerifier.verifyValidatorInBeaconState(
            snapshotBeaconRoot,
            proof.validatorIndex,
            validatorRoot,
            proof.validatorBranch,
            proof.validatorsLengthChunk,
            proof.beaconStateBranch
        );
        if (!validInclusion) {
            revert IDirectVoting.InvalidValidatorProof(proof.validatorIndex);
        }

        stakeWei = uint256(proof.effectiveBalanceGwei) * GWEI_TO_WEI;
    }
}
