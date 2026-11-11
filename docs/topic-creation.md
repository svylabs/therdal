# Therdal Protocol — Stage 1: Topic Creation Specification

## 1. Overview

Stage 1 implements permissionless on-chain **Topic Creation** (`contracts/Therdal.sol`, `contracts/libraries/TopicValidation.sol`, `topics/`, `cli/`, `sdk/`, and `frontend/`).

Creating a topic registers three core user-defined fields on Ethereum:
1. **Subject (`string subject`)**: The referendum question or signaling prompt (`1..=512` UTF-8 bytes, non-whitespace-only).
2. **Options (`string[] options`)**: Between `2` and `16` unique free-text option labels (`1..=256` UTF-8 bytes each, non-whitespace-only, unique after ASCII whitespace trimming).
3. **Voting Ends (`uint64 votingEndsAt`)**: Future Unix timestamp (`votingEndsAt > block.timestamp`) when voting closes.

Topic creation is **always free** (`$0` protocol fee and `$0` required deposit). Creators may optionally supply `initialSponsorship` in USDC (or an allowlisted USD stablecoin via `createTopicWithConfig`), routing **100%** into `SponsorEscrow`.

---

## 2. Smart Contract Interface (`ITopicRegistry.sol`)

```solidity
function createTopic(
    string calldata subject,
    string[] calldata options,
    uint64 votingEndsAt,
    uint256 initialSponsorship
) external returns (uint256 topicId);

function createTopicWithConfig(CreateTopicParams calldata params)
    external
    returns (uint256 topicId);

function sponsorTopic(uint256 topicId, uint256 amount) external;
```

### Validation & Boundary Rules (`TopicValidation.sol`)

| Parameter | Constraint | Custom Solidity Error |
| --- | --- | --- |
| `subject` | Non-empty & contains non-ASCII-whitespace (`!= 0x20, 0x09, 0x0a, 0x0d`) | `EmptySubject()` |
| `subject` | `bytes(subject).length <= 512` | `SubjectTooLong(byteLength, 512)` |
| `options` | `2 <= options.length <= 16` | `InvalidOptionCount(count, 2, 16)` |
| `options[i]` | Non-empty & contains non-ASCII-whitespace | `EmptyOption(i)` |
| `options[i]` | `bytes(options[i]).length <= 256` | `OptionTooLong(i, byteLength, 256)` |
| `options[i]` | Unique trimmed content (`keccak256(trimmed(options[i]))`) | `DuplicateOption(firstIndex, i)` |
| `votingEndsAt` | `votingEndsAt > block.timestamp` | `InvalidVotingEndTime(votingEndsAt, block.timestamp)` |
| `block.number` | `block.number >= 1` | `InvalidSnapshotBlock(0)` |

---

## 3. Automatic Snapshot Pinning & Lifecycle Phases

- **Parent Block Snapshot**: `createTopic` automatically records `snapshotBlock = uint64(block.number - 1)` and `snapshotBlockHash = blockhash(block.number - 1)` at creation so moving or buying ETH afterward cannot alter historical eligibility.
- **Frozen Pricing**: `TherdalController.quoteTopicTerms(paymentToken)` resolves the allowlisted USD stablecoin (defaulting to 6-decimal USDC) and freezes `pricePerVote` on the `TopicRecord`.
- **Stage 1 Lifecycle (`getPhase(topicId)`)**:
  - `None` (`0`): Unregistered `topicId`.
  - `Open` (`1`): `block.timestamp <= votingEndsAt` (sponsorship top-ups via `sponsorTopic` permitted).
  - `Closed` (`2`): `block.timestamp > votingEndsAt`.

---

## 4. Cross-Layer Deterministic `contentHash` (`THERDAL_TOPIC_V1`)

Every layer (`TopicValidation.sol`, `therdal-topics`, `@therdal/sdk`, and `frontend/src/topicDomain.js`) computes an identical 32-byte commitment over a fixed 96-byte outer preimage:

```text
subjectHash  = keccak256(utf8(subject))
optionHashes = concat_{i=0..N-1}(keccak256(utf8(options[i])))
optionsHash  = keccak256(optionHashes)
contentHash  = keccak256("THERDAL_TOPIC_V1" || subjectHash || uint64_be(N) || optionsHash || uint64_be(votingEndsAt))
```

### Shared Deterministic Test Vector
- `subject`: `"Should Ethereum increase the blob target from 6 to 12?"`
- `options`: `["12 Blobs", "9 Blobs", "Keep at 6 Blobs"]`
- `votingEndsAt`: `1800000000`
- Expected `contentHash`: `0x9c2f31b24a86bb08a454e2566c47308d9fef016662c6e369a5323230572aa02d`

---

## 5. Stage 1 CLI Usage (`therdal-cli`)

```bash
# Register a topic (free, $0 sponsorship)
cargo run --offline --bin therdal-cli -- create-topic \
  --subject "Should Ethereum increase the blob target from 6 to 12?" \
  --option "12 Blobs" \
  --option "9 Blobs" \
  --option "Keep at 6 Blobs" \
  --voting-ends-at 1900000000

# Inspect or list topics
cargo run --offline --bin therdal-cli -- list-topics
cargo run --offline --bin therdal-cli -- get-topic --topic-id 1 --json

# Compute canonical cross-layer contentHash offline
cargo run --offline --bin therdal-cli -- hash-topic \
  --subject "Should Ethereum increase the blob target from 6 to 12?" \
  --option "12 Blobs" \
  --option "9 Blobs" \
  --option "Keep at 6 Blobs" \
  --voting-ends-at 1800000000
```
