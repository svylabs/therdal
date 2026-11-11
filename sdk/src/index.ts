/**
 * Therdal Protocol v0.2 TypeScript SDK
 * - Permissionless EIP-4844 blob publication & non-sequential STARK batch settlement
 * - Smart-account controller (`TherdalController`) & USDC/multi-stablecoin pricing
 * - Mandatory $100 creation deposit ($10 nonrefundable dev fee + $90 escrow)
 * - 25% Developer / 25% Submitter / 50% Prover fee split on `newlyAcceptedVoteCount`
 * - Pro-rata pull refunds: `floor(U * c_i / C)`
 */

export type Choice = 0 | 1 | 2; // 0 = Yes, 1 = No, 2 = Abstain

export enum PositionType {
  Wallet = 0,
  Validator = 1,
}

export interface PositionClaim {
  positionType: PositionType;
  id: string;
}

export interface VoteEnvelope {
  resolutionId: bigint;
  chainId: bigint;
  choice: Choice;
  signer: string;
  nonceOrVoteId: string;
  deadline: bigint;
  positionClaims: PositionClaim[];
  signature?: string;
}

export interface ResolutionConfigInput {
  questionURI: string;
  snapshotBlockNumber: bigint;
  snapshotBeaconTimestamp: bigint;
  snapshotEpoch: bigint;
  votingStartsAt: bigint;
  votingEndsAt: bigint;
  settlementDeadline: bigint;
  rulesetVersion: number;
  paymentToken: string; // address(0) defaults to USDC via TherdalController
  extraSponsorAmount: bigint;
}

export const THERDAL_EIP712_DOMAIN = (chainId: number | bigint) => ({
  name: "Therdal",
  version: "1",
  chainId: BigInt(chainId),
});

export const THERDAL_EIP712_VOTE_TYPES = {
  Vote: [
    { name: "resolutionId", type: "uint256" },
    { name: "chainId", type: "uint256" },
    { name: "choice", type: "uint8" },
    { name: "signer", type: "address" },
    { name: "nonceOrVoteId", type: "bytes32" },
    { name: "deadline", type: "uint64" },
    { name: "positionClaimsHash", type: "bytes32" },
  ],
} as const;

export function createWalletClaim(address: string): PositionClaim {
  const clean = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return {
    positionType: PositionType.Wallet,
    id: `0x${clean}`,
  };
}

export function createValidatorClaim(validatorIndex: number | bigint): PositionClaim {
  const hex = BigInt(validatorIndex).toString(16).padStart(64, "0");
  return {
    positionType: PositionType.Validator,
    id: `0x${hex}`,
  };
}

export function canonicalizePositionClaims(claims: PositionClaim[]): PositionClaim[] {
  const sorted = [...claims].sort((a, b) => {
    if (a.positionType !== b.positionType) {
      return a.positionType - b.positionType;
    }
    return a.id.toLowerCase().localeCompare(b.id.toLowerCase());
  });

  for (let i = 1; i < sorted.length; i++) {
    if (
      sorted[i].positionType === sorted[i - 1].positionType &&
      sorted[i].id.toLowerCase() === sorted[i - 1].id.toLowerCase()
    ) {
      throw new Error(`Duplicate position claim: ${sorted[i].positionType}:${sorted[i].id}`);
    }
  }
  return sorted;
}

/**
 * Computes the v0.2 25% Developer / 25% Submitter / 50% Prover fee split for `newlyAcceptedVoteCount`.
 * Throws if `totalFee > remainingEscrow` (Section 9.4 solvency invariant).
 */
export function calculateV02SettlementSplit(
  newlyAcceptedVoteCount: bigint,
  pricePerVoteUnits: bigint,
  remainingEscrowUnits: bigint
): {
  totalFee: bigint;
  developerShare: bigint;
  submitterShare: bigint;
  proverShare: bigint;
  remainingAfter: bigint;
} {
  const totalFee = newlyAcceptedVoteCount * pricePerVoteUnits;
  if (totalFee > remainingEscrowUnits) {
    throw new Error(`InsufficientEscrowBalance: required ${totalFee}, available ${remainingEscrowUnits}`);
  }
  const developerShare = totalFee / 4n;
  const submitterShare = totalFee / 4n;
  const proverShare = totalFee - developerShare - submitterShare;
  return {
    totalFee,
    developerShare,
    submitterShare,
    proverShare,
    remainingAfter: remainingEscrowUnits - totalFee,
  };
}

/**
 * Computes pro-rata pull refund `floor(U * c_i / C)` (Section 9.3).
 */
export function calculateProRataRefund(
  frozenUnusedEscrow: bigint,
  contributorEscrow: bigint,
  totalEscrowContributed: bigint
): bigint {
  if (frozenUnusedEscrow <= 0n || contributorEscrow <= 0n || totalEscrowContributed <= 0n) {
    return 0n;
  }
  return (frozenUnusedEscrow * contributorEscrow) / totalEscrowContributed;
}

export const THERDAL_V02_ABI = [
  "function createResolution((string questionURI, uint64 snapshotBlockNumber, uint64 snapshotBeaconTimestamp, uint64 snapshotEpoch, uint64 votingStartsAt, uint64 votingEndsAt, uint64 settlementDeadline, uint32 rulesetVersion, address paymentToken, uint256 extraSponsorAmount) config) external returns (uint256 resolutionId)",
  "function authenticateSnapshot(uint256 resolutionId, (bytes rlpExecutionHeader, bytes32 beaconBlockRoot, bytes32 beaconStateRoot, bytes32[] stateRootBranch, bytes32[] executionHashBranch, uint256 executionHashLeafIndex) proof) external",
  "function publishBatch(uint256 resolutionId, uint8 blobCount) external returns (uint256 batchId)",
  "function settleBatch(uint256 resolutionId, uint256 batchId, bytes32 newPositionRoot, uint256[3] newTallies, uint256 newCountedPositions, uint256 newlyAcceptedVoteCount, bytes proof) external",
  "function finalizeResolution(uint256 resolutionId) external",
  "function sponsor(uint256 resolutionId, uint256 amount) external",
  "function closeSettlementAndEnableRefunds(uint256 resolutionId) external",
  "function claimRefund(uint256 resolutionId) external returns (uint256 refundAmount)",
] as const;

export const THERDAL_CONTROLLER_ABI = [
  "function operator() external view returns (address)",
  "function developerRecipient() external view returns (address)",
  "function defaultPaymentToken() external view returns (address)",
  "function pricePerVoteUsdMicros() external view returns (uint256)",
  "function transferOperator(address newOperator) external",
  "function setPricePerVoteUsdMicros(uint256 newPriceUsdMicros) external",
  "function configureStablecoin(address token, uint8 tokenDecimals, bool allowed) external",
  "function withdrawToken(address token, address to, uint256 amount) external",
] as const;
