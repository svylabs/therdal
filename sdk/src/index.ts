/**
 * Therdal Protocol — Stage 1 (Topic Creation) TypeScript SDK
 * - Free topic creation ($0 fee, $0 mandatory deposit) with optional 100%-to-pool USDC sponsorship
 * - Pure input validation matching `TopicValidation.sol` and `therdal-topics` byte-for-byte
 * - Deterministic cross-layer `contentHash` (`THERDAL_TOPIC_V1`)
 */

import { bytesToHex, keccak256Bytes } from "./keccak256.ts";
import { THERDAL_STAGE2_VOTING_ABI } from "./voting.ts";

export { bytesToHex, keccak256Bytes };
export * from "./sha256.ts";
export * from "./rlp.ts";
export * from "./voting.ts";

export const MIN_TOPIC_OPTIONS = 2;
export const MAX_TOPIC_OPTIONS = 16;
export const MAX_SUBJECT_BYTES = 512;
export const MAX_OPTION_BYTES = 256;
export const TOPIC_DOMAIN_TAG = "THERDAL_TOPIC_V1";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const TopicPhase = {
  None: 0,
  Open: 1,
  Closed: 2,
} as const;
export type TopicPhaseValue = (typeof TopicPhase)[keyof typeof TopicPhase];

export interface CreateTopicInput {
  subject: string;
  options: string[];
  votingEndsAt: bigint | number;
  paymentToken?: string;
  initialSponsorship?: bigint;
}

export interface TopicView {
  id: bigint;
  creator: string;
  subject: string;
  options: string[];
  createdAt: bigint;
  votingEndsAt: bigint;
  snapshotBlock: bigint;
  snapshotBlockHash: `0x${string}`;
  contentHash: `0x${string}`;
  paymentToken: string;
  pricePerVote: bigint;
  totalSponsored: bigint;
  remainingEscrow: bigint;
  phase: TopicPhaseValue;
}

export type TopicValidationErrorCode =
  | "EmptySubject"
  | "SubjectTooLong"
  | "InvalidOptionCount"
  | "EmptyOption"
  | "OptionTooLong"
  | "DuplicateOption"
  | "InvalidVotingEndTime"
  | "NegativeSponsorship";

export class TopicValidationError extends Error {
  readonly code: TopicValidationErrorCode;

  constructor(code: TopicValidationErrorCode, message: string) {
    super(message);
    this.name = "TopicValidationError";
    this.code = code;
  }
}

const utf8Encoder = new TextEncoder();

function isAsciiWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

function trimAsciiBytes(raw: Uint8Array): Uint8Array {
  let start = 0;
  let end = raw.length;
  while (start < end && isAsciiWhitespace(raw[start])) {
    start++;
  }
  while (end > start && isAsciiWhitespace(raw[end - 1])) {
    end--;
  }
  return raw.subarray(start, end);
}

function encodeUint64Be(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let rem = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(rem & 0xffn);
    rem >>= 8n;
  }
  return out;
}

export function validateSubject(subject: string): void {
  const raw = utf8Encoder.encode(subject);
  if (raw.length === 0) {
    throw new TopicValidationError("EmptySubject", "Subject must not be empty.");
  }
  if (raw.length > MAX_SUBJECT_BYTES) {
    throw new TopicValidationError(
      "SubjectTooLong",
      `Subject length (${raw.length} bytes) exceeds maximum (${MAX_SUBJECT_BYTES} bytes).`
    );
  }
  if (trimAsciiBytes(raw).length === 0) {
    throw new TopicValidationError("EmptySubject", "Subject must not be whitespace-only.");
  }
}

export function validateOptions(options: readonly string[]): void {
  if (options.length < MIN_TOPIC_OPTIONS || options.length > MAX_TOPIC_OPTIONS) {
    throw new TopicValidationError(
      "InvalidOptionCount",
      `Option count (${options.length}) must be between ${MIN_TOPIC_OPTIONS} and ${MAX_TOPIC_OPTIONS}.`
    );
  }

  const seenTrimmedHashes = new Map<string, number>();

  for (let i = 0; i < options.length; i++) {
    const raw = utf8Encoder.encode(options[i]);
    if (raw.length === 0) {
      throw new TopicValidationError("EmptyOption", `Option at index ${i} must not be empty.`);
    }
    if (raw.length > MAX_OPTION_BYTES) {
      throw new TopicValidationError(
        "OptionTooLong",
        `Option at index ${i} length (${raw.length} bytes) exceeds maximum (${MAX_OPTION_BYTES} bytes).`
      );
    }

    const trimmed = trimAsciiBytes(raw);
    if (trimmed.length === 0) {
      throw new TopicValidationError(
        "EmptyOption",
        `Option at index ${i} must not be whitespace-only.`
      );
    }

    const trimmedHex = bytesToHex(keccak256Bytes(trimmed));
    const prevIdx = seenTrimmedHashes.get(trimmedHex);
    if (prevIdx !== undefined) {
      throw new TopicValidationError(
        "DuplicateOption",
        `Duplicate option at index ${i} matches option at index ${prevIdx}.`
      );
    }
    seenTrimmedHashes.set(trimmedHex, i);
  }
}

export function validateCreateTopicInput(
  input: CreateTopicInput,
  currentTimestampSec: bigint | number
): void {
  validateSubject(input.subject);
  validateOptions(input.options);

  const endsAt = BigInt(input.votingEndsAt);
  const now = BigInt(currentTimestampSec);
  if (endsAt <= now) {
    throw new TopicValidationError(
      "InvalidVotingEndTime",
      `votingEndsAt (${endsAt}) must be strictly greater than current timestamp (${now}).`
    );
  }

  if (input.initialSponsorship !== undefined && input.initialSponsorship < 0n) {
    throw new TopicValidationError(
      "NegativeSponsorship",
      "initialSponsorship cannot be negative."
    );
  }
}

/**
 * Computes the canonical 32-byte cross-layer `contentHash` matching `TopicValidation.sol` and `therdal-topics`:
 * `keccak256("THERDAL_TOPIC_V1" || keccak256(subject) || uint64(options.length) || keccak256(optionHashes) || uint64(votingEndsAt))`
 */
export function computeTopicContentHash(
  subject: string,
  options: readonly string[],
  votingEndsAt: bigint | number
): `0x${string}` {
  const domainBytes = utf8Encoder.encode(TOPIC_DOMAIN_TAG); // 16 bytes
  const subjectHash = keccak256Bytes(utf8Encoder.encode(subject)); // 32 bytes

  const packedOptHashes = new Uint8Array(options.length * 32);
  for (let i = 0; i < options.length; i++) {
    packedOptHashes.set(keccak256Bytes(utf8Encoder.encode(options[i])), i * 32);
  }
  const optionsHash = keccak256Bytes(packedOptHashes); // 32 bytes

  const preimage = new Uint8Array(96);
  preimage.set(domainBytes, 0);
  preimage.set(subjectHash, 16);
  preimage.set(encodeUint64Be(BigInt(options.length)), 48);
  preimage.set(optionsHash, 56);
  preimage.set(encodeUint64Be(BigInt(votingEndsAt)), 88);

  return bytesToHex(keccak256Bytes(preimage));
}

export function formatUsdcMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = ((micros % 1_000_000n) / 10_000n).toString().padStart(2, "0");
  return `$${whole}.${frac} USDC`;
}

export const THERDAL_STAGE1_ABI = [
  "function createTopic(string subject, string[] options, uint64 votingEndsAt, uint256 initialSponsorship) external returns (uint256 topicId)",
  "function createTopicWithConfig((string subject, string[] options, uint64 votingEndsAt, address paymentToken, uint256 initialSponsorship) params) external returns (uint256 topicId)",
  "function sponsorTopic(uint256 topicId, uint256 amount) external",
  "function topicCount() external view returns (uint256)",
  "function getTopic(uint256 topicId) external view returns ((uint256 id, address creator, string subject, string[] options, uint64 createdAt, uint64 votingEndsAt, uint64 snapshotBlock, bytes32 snapshotBlockHash, bytes32 contentHash, address paymentToken, uint256 pricePerVote, uint256 totalSponsored, uint256 remainingEscrow, uint8 phase))",
  "function getTopicOptions(uint256 topicId) external view returns (string[])",
  "function getTopics(uint256 offset, uint256 limit) external view returns ((uint256 id, address creator, string subject, string[] options, uint64 createdAt, uint64 votingEndsAt, uint64 snapshotBlock, bytes32 snapshotBlockHash, bytes32 contentHash, address paymentToken, uint256 pricePerVote, uint256 totalSponsored, uint256 remainingEscrow, uint8 phase)[])",
  "function getPhase(uint256 topicId) external view returns (uint8)",
  "event TopicCreated(uint256 indexed topicId, address indexed creator, address indexed paymentToken, string subject, string[] options, uint64 createdAt, uint64 votingEndsAt, uint64 snapshotBlock, bytes32 snapshotBlockHash, bytes32 contentHash, uint256 frozenPricePerVote, uint256 initialSponsorship)",
  "event TopicSponsored(uint256 indexed topicId, address indexed sponsor, address indexed paymentToken, uint256 amount, uint256 totalSponsored, uint256 remainingEscrow)",
] as const;

export const THERDAL_ABI = [...THERDAL_STAGE1_ABI, ...THERDAL_STAGE2_VOTING_ABI] as const;

export const THERDAL_CONTROLLER_ABI = [
  "function operator() external view returns (address)",
  "function developerRecipient() external view returns (address)",
  "function defaultPaymentToken() external view returns (address)",
  "function pricePerVoteUsdMicros() external view returns (uint256)",
  "function quoteTopicTerms(address requestedToken) external view returns (address paymentToken, uint256 pricePerVote)",
  "function transferOperator(address newOperator) external",
  "function setPricePerVoteUsdMicros(uint256 newPriceUsdMicros) external",
  "function configureStablecoin(address token, uint8 tokenDecimals, bool allowed) external",
  "function withdrawToken(address token, address to, uint256 amount) external",
] as const;
