import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_OPTION_BYTES,
  MAX_SUBJECT_BYTES,
  TopicValidationError,
  computeTopicContentHash,
  formatUsdcMicros,
  validateCreateTopicInput,
} from "../src/index.ts";

test("cross-layer canonical contentHash matches Solidity and Rust vector", () => {
  const hash = computeTopicContentHash(
    "Should Ethereum increase the blob target from 6 to 12?",
    ["12 Blobs", "9 Blobs", "Keep at 6 Blobs"],
    1_800_000_000n
  );
  assert.equal(
    hash,
    "0x9c2f31b24a86bb08a454e2566c47308d9fef016662c6e369a5323230572aa02d"
  );
});

test("validates free and sponsored multi-option topic creation", () => {
  assert.doesNotThrow(() =>
    validateCreateTopicInput(
      {
        subject: "What L1 gas limit should validators target?",
        options: ["60M Gas", "45M Gas", "36M Gas", "No Change"],
        votingEndsAt: 1_760_600_000,
        initialSponsorship: 0n,
      },
      1_760_000_000
    )
  );
  assert.equal(formatUsdcMicros(100_000_000n), "$100.00 USDC");
});

test("rejects invalid subject, option counts, duplicates, and expired deadlines", () => {
  const now = 1_760_000_000n;
  const baseOpts = ["Support", "Oppose"];

  assert.throws(
    () => validateCreateTopicInput({ subject: "   \n\t ", options: baseOpts, votingEndsAt: now + 60n }, now),
    (err: unknown) => err instanceof TopicValidationError && err.code === "EmptySubject"
  );

  assert.throws(
    () =>
      validateCreateTopicInput(
        { subject: "A".repeat(MAX_SUBJECT_BYTES + 1), options: baseOpts, votingEndsAt: now + 60n },
        now
      ),
    (err: unknown) => err instanceof TopicValidationError && err.code === "SubjectTooLong"
  );

  assert.throws(
    () => validateCreateTopicInput({ subject: "Valid?", options: ["Only"], votingEndsAt: now + 60n }, now),
    (err: unknown) => err instanceof TopicValidationError && err.code === "InvalidOptionCount"
  );

  assert.throws(
    () =>
      validateCreateTopicInput(
        { subject: "Valid?", options: ["12 Blobs", "  12 Blobs\n"], votingEndsAt: now + 60n },
        now
      ),
    (err: unknown) => err instanceof TopicValidationError && err.code === "DuplicateOption"
  );

  assert.throws(
    () =>
      validateCreateTopicInput(
        { subject: "Valid?", options: ["A", "B".repeat(MAX_OPTION_BYTES + 1)], votingEndsAt: now + 60n },
        now
      ),
    (err: unknown) => err instanceof TopicValidationError && err.code === "OptionTooLong"
  );

  assert.throws(
    () => validateCreateTopicInput({ subject: "Valid?", options: baseOpts, votingEndsAt: now }, now),
    (err: unknown) => err instanceof TopicValidationError && err.code === "InvalidVotingEndTime"
  );
});
