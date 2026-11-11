import {
  MAX_OPTION_BYTES,
  MAX_SUBJECT_BYTES,
  MAX_TOPIC_OPTIONS,
  MIN_TOPIC_OPTIONS,
  bytesToHex,
  computeTopicContentHash,
  utf8ByteLength,
  validateTopicDraft,
} from "./topicDomain.js";
import {
  DirectVotingError,
  ETH_TO_WEI,
  PositionType,
  authenticateBeaconSnapshot,
  authenticateExecutionHeader,
  buildFullTopicSnapshot,
  computeValidatorPositionKey,
  computeWalletPositionKey,
  formatEthFromWei,
  makeWithdrawalCredentials,
  verifyExecutionBalanceProof,
  verifyValidatorStakeProof,
} from "./votingDomain.js";

const CHAIN_ID = 1n;

const WALLETS = {
  alice: {
    key: "alice",
    name: "Alice",
    address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    nonce: 5n,
    balanceWei: 25n * ETH_TO_WEI,
    validators: [
      {
        validatorIndex: 42,
        credType: "0x01 Standard",
        prefix: 0x01,
        pubkeyRoot: "0x" + "11".repeat(32),
        effectiveBalanceGwei: 32_000_000_000n,
      },
      {
        validatorIndex: 77,
        credType: "0x02 Compounding",
        prefix: 0x02,
        pubkeyRoot: "0x" + "77".repeat(32),
        effectiveBalanceGwei: 64_000_000_000n,
      },
    ],
  },
  bob: {
    key: "bob",
    name: "Bob",
    address: "0x1563915e194D8CfBA1943570603F7606A3115508",
    nonce: 12n,
    balanceWei: 14_500_000_000_000_000_000n, // 14.50 ETH
    validators: [
      {
        validatorIndex: 108,
        credType: "0x01 Standard",
        prefix: 0x01,
        pubkeyRoot: "0x" + "22".repeat(32),
        effectiveBalanceGwei: 32_000_000_000n,
      },
    ],
  },
  carol: {
    key: "carol",
    name: "Carol",
    address: "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB",
    nonce: 3n,
    balanceWei: 40n * ETH_TO_WEI,
    validators: [
      {
        validatorIndex: 256,
        credType: "0x02 Compounding",
        prefix: 0x02,
        pubkeyRoot: "0x" + "33".repeat(32),
        effectiveBalanceGwei: 128_000_000_000n,
      },
    ],
  },
};

const nowInitialSec = Math.floor(Date.now() / 1000);

const state = {
  activeWalletKey: "alice",
  chainTimestamp: nowInitialSec,
  chainBlockNumber: 21_500_000,
  chainBeaconSlot: 10_240_000,
  pricePerVoteUsdc: 0.01,
  phaseFilter: "ALL",
  selectedTopicId: 1,
  selectedVoteOptionIndex: 0,
  selectedValidatorIndices: new Set([42, 77]),
  voteFeedback: null,
  draftOptions: [
    "Increase to 12 Blobs",
    "Increase to 9 Blobs",
    "Keep at 6 Blobs",
  ],
  topics: [],
  eventLog: [],
};

function buildSnapshotForBlock(snapshotBlock, snapshotTimestamp, beaconSlot, childBlockTimestamp) {
  const accounts = Object.values(WALLETS).map((w) => ({
    address: w.address,
    nonce: w.nonce,
    balanceWei: w.balanceWei,
  }));

  const validators = [];
  for (const w of Object.values(WALLETS)) {
    for (const v of w.validators) {
      validators.push({
        validatorIndex: BigInt(v.validatorIndex),
        pubkeyRoot: v.pubkeyRoot,
        withdrawalCredentials: makeWithdrawalCredentials(v.prefix, w.address),
        effectiveBalanceGwei: v.effectiveBalanceGwei,
        slashed: false,
        activationEligibilityEpoch: 100_000n,
        activationEpoch: 100_010n,
        exitEpoch: 0xffffffffffffffffn,
        withdrawableEpoch: 0xffffffffffffffffn,
      });
    }
  }

  return buildFullTopicSnapshot({
    snapshotBlock,
    snapshotTimestamp,
    beaconSlot,
    childBlockTimestamp,
    accounts,
    validators,
  });
}

function createTopicRecord({
  id,
  creatorName,
  creator,
  subject,
  options,
  createdAt,
  votingEndsAt,
  snapshotBlock,
  beaconSlot,
  totalSponsoredUsdc,
}) {
  const snapshotFixture = buildSnapshotForBlock(
    snapshotBlock,
    createdAt - 12,
    beaconSlot,
    createdAt
  );

  return {
    id,
    creatorName,
    creator,
    subject,
    options: [...options],
    createdAt,
    votingEndsAt,
    snapshotBlock,
    snapshotBlockHash: snapshotFixture.snapshotBlockHash,
    snapshotBeaconBlockRoot: snapshotFixture.snapshotBeaconBlockRoot,
    snapshotExecutionRoot: null, // Authenticated on first execution proof
    snapshotBeaconRoot: null, // Authenticated on first beacon proof
    snapshotEpoch: null,
    snapshotFixture,
    contentHash: computeTopicContentHash(subject, options, votingEndsAt),
    pricePerVoteUsdc: state.pricePerVoteUsdc,
    totalSponsoredUsdc,
    optionWeightsWei: options.map(() => 0n),
    optionPositionCounts: options.map(() => 0),
    totalWeightWei: 0n,
    totalCountedPositions: 0,
    directVoteCount: 0,
    positionReceipts: new Map(), // positionKey -> { positionType, voter, voterName, validatorIndex, optionIndex, weightWei }
  };
}

// ---------------------------------------------------------------------------
// Direct Voting State Machine (`Therdal.sol` + `IDirectVoting.sol`)
// ---------------------------------------------------------------------------

function executeDirectVoteOnTopic({
  topic,
  wallet,
  optionIndex,
  includeExecutionBalance,
  validatorIndices,
  blockNumber,
  emitLogs = true,
}) {
  if (getTopicPhase(topic) !== "Open") {
    throw new DirectVotingError(
      "InvalidTopicPhase",
      "InvalidTopicPhase(Closed, Open): Voting deadline has passed."
    );
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= topic.options.length) {
    throw new DirectVotingError(
      "InvalidOptionIndex",
      `InvalidOptionIndex(${optionIndex}, ${topic.options.length}): Select a valid option.`
    );
  }
  if (!includeExecutionBalance && validatorIndices.length === 0) {
    throw new DirectVotingError(
      "EmptyDirectVote",
      "EmptyDirectVote: Select at least an execution balance proof or one validator stake proof."
    );
  }

  // Pre-validate all keys & proofs before mutating topic state (atomic EVM revert semantics)
  let executionWeightWei = 0n;
  let walletKey = null;
  let newlyAuthExecRoot = null;

  if (includeExecutionBalance) {
    walletKey = computeWalletPositionKey(CHAIN_ID, wallet.address);
    if (topic.positionReceipts.has(walletKey)) {
      throw new DirectVotingError(
        "PositionAlreadyCounted",
        `PositionAlreadyCounted(topicId=${topic.id}, walletKey=${walletKey.slice(0, 18)}…): Execution balance already voted.`
      );
    }

    const execRootBytes = topic.snapshotExecutionRoot
      ? topic.snapshotFixture.accountProofsByAddress && authenticateExecutionHeader(
          topic.snapshotBlock,
          topic.snapshotFixture.snapshotBlockHashBytes,
          topic.snapshotFixture.rlpExecutionHeader
        )
      : authenticateExecutionHeader(
          topic.snapshotBlock,
          topic.snapshotFixture.snapshotBlockHashBytes,
          topic.snapshotFixture.rlpExecutionHeader
        );

    if (!topic.snapshotExecutionRoot) {
      newlyAuthExecRoot = bytesToHex(execRootBytes);
    }

    const acctProof = topic.snapshotFixture.accountProofsByAddress.get(wallet.address.toLowerCase());
    if (!acctProof) {
      throw new DirectVotingError("AccountNotFoundInTrie", "Wallet not present in snapshot trie.");
    }
    executionWeightWei = verifyExecutionBalanceProof(
      execRootBytes,
      wallet.address,
      acctProof.rlpAccountProofNodes
    );
  }

  let beaconWeightWei = 0n;
  let newlyAuthBeacon = null;
  const validatedValidators = [];

  if (validatorIndices.length > 0) {
    const authRes = authenticateBeaconSnapshot(
      topic.snapshotFixture.snapshotBlockHashBytes,
      topic.snapshotFixture.snapshotBeaconBlockRootBytes,
      topic.snapshotFixture.beaconAuth
    );
    if (!topic.snapshotBeaconRoot) {
      newlyAuthBeacon = authRes;
    }

    const seenInBatch = new Set();
    for (const vIdx of validatorIndices) {
      const valKey = computeValidatorPositionKey(CHAIN_ID, vIdx);
      if (topic.positionReceipts.has(valKey) || seenInBatch.has(valKey)) {
        throw new DirectVotingError(
          "PositionAlreadyCounted",
          `PositionAlreadyCounted(topicId=${topic.id}, validator=#${vIdx}, key=${valKey.slice(0, 18)}…): Validator already voted.`
        );
      }
      seenInBatch.add(valKey);

      const proof = topic.snapshotFixture.validatorProofsByIndex.get(Number(vIdx));
      if (!proof) {
        throw new DirectVotingError(
          "InvalidValidatorProof",
          `No SSZ proof available for validator #${vIdx}.`
        );
      }
      const wWei = verifyValidatorStakeProof(
        authRes.snapshotBeaconRoot,
        authRes.snapshotEpoch,
        wallet.address,
        proof
      );
      validatedValidators.push({ validatorIndex: Number(vIdx), positionKey: valKey, weightWei: wWei });
      beaconWeightWei += wWei;
    }
  }

  // Commit state changes (Checks-Effects-Interactions)
  if (newlyAuthExecRoot) {
    topic.snapshotExecutionRoot = newlyAuthExecRoot;
    if (emitLogs) {
      state.eventLog.unshift(
        `[Block #${blockNumber}] ExecutionSnapshotAuthenticated(topicId=${topic.id}, snapshotBlock=${topic.snapshotBlock}, stateRoot=${newlyAuthExecRoot.slice(0, 18)}…)`
      );
    }
  }

  if (newlyAuthBeacon) {
    topic.snapshotBeaconRoot = newlyAuthBeacon.snapshotBeaconRootHex;
    topic.snapshotEpoch = newlyAuthBeacon.snapshotEpoch;
    if (emitLogs) {
      state.eventLog.unshift(
        `[Block #${blockNumber}] BeaconSnapshotAuthenticated(topicId=${topic.id}, stateRoot=${newlyAuthBeacon.snapshotBeaconRootHex.slice(0, 18)}…, epoch=${newlyAuthBeacon.snapshotEpoch})`
      );
    }
  }

  let positionsCounted = 0;
  if (includeExecutionBalance && walletKey) {
    topic.positionReceipts.set(walletKey, {
      positionKey: walletKey,
      positionType: PositionType.ExecutionWallet,
      voter: wallet.address,
      voterName: wallet.name,
      validatorIndex: 0,
      optionIndex,
      weightWei: executionWeightWei,
    });
    topic.optionWeightsWei[optionIndex] += executionWeightWei;
    topic.optionPositionCounts[optionIndex] += 1;
    positionsCounted += 1;

    if (emitLogs) {
      state.eventLog.unshift(
        `[Block #${blockNumber}] PositionCounted(topicId=${topic.id}, type=ExecutionWallet, voter=${shortAddr(wallet.address)}, option=${optionIndex}, weight=${formatEthFromWei(executionWeightWei)} ETH)`
      );
    }
  }

  for (const item of validatedValidators) {
    topic.positionReceipts.set(item.positionKey, {
      positionKey: item.positionKey,
      positionType: PositionType.BeaconValidator,
      voter: wallet.address,
      voterName: wallet.name,
      validatorIndex: item.validatorIndex,
      optionIndex,
      weightWei: item.weightWei,
    });
    topic.optionWeightsWei[optionIndex] += item.weightWei;
    topic.optionPositionCounts[optionIndex] += 1;
    positionsCounted += 1;

    if (emitLogs) {
      state.eventLog.unshift(
        `[Block #${blockNumber}] PositionCounted(topicId=${topic.id}, type=BeaconValidator, validator=#${item.validatorIndex}, voter=${shortAddr(wallet.address)}, option=${optionIndex}, weight=${formatEthFromWei(item.weightWei)} ETH)`
      );
    }
  }

  const totalCastWei = executionWeightWei + beaconWeightWei;
  topic.totalWeightWei += totalCastWei;
  topic.totalCountedPositions += positionsCounted;
  topic.directVoteCount += 1;

  if (emitLogs) {
    state.eventLog.unshift(
      `[Block #${blockNumber}] DirectVoteCast(topicId=${topic.id}, voter=${shortAddr(wallet.address)}, option=[${optionIndex}] "${topic.options[optionIndex]}", total=${formatEthFromWei(totalCastWei)} ETH, positions=${positionsCounted}, fee=$0.00)`
    );
  }

  return { totalCastWei, executionWeightWei, beaconWeightWei, positionsCounted };
}

function seedInitialTopics() {
  const t1Ends = state.chainTimestamp + 7 * 86400;
  const t1Opts = ["12 Blobs", "9 Blobs", "Keep at 6 Blobs"];
  const t1Subj = "Should Ethereum increase the blob target from 6 to 12?";
  const t1Snap = state.chainBlockNumber - 10;

  const t2Ends = state.chainTimestamp + 14 * 86400;
  const t2Opts = ["60M Gas Limit", "45M Gas Limit", "36M Gas Limit", "Keep 30M Gas"];
  const t2Subj = "What L1 execution block gas limit should validators target next?";
  const t2Snap = state.chainBlockNumber - 2;

  const topic1 = createTopicRecord({
    id: 1,
    creatorName: "Alice",
    creator: WALLETS.alice.address,
    subject: t1Subj,
    options: t1Opts,
    createdAt: state.chainTimestamp - 120,
    votingEndsAt: t1Ends,
    snapshotBlock: t1Snap,
    beaconSlot: state.chainBeaconSlot - 10,
    totalSponsoredUsdc: 0,
  });

  const topic2 = createTopicRecord({
    id: 2,
    creatorName: "Bob",
    creator: WALLETS.bob.address,
    subject: t2Subj,
    options: t2Opts,
    createdAt: state.chainTimestamp - 24,
    votingEndsAt: t2Ends,
    snapshotBlock: t2Snap,
    beaconSlot: state.chainBeaconSlot - 2,
    totalSponsoredUsdc: 100,
  });

  state.topics = [topic1, topic2];
  state.eventLog = [
    `[Block #${t2Snap + 1}] TopicCreated(topicId=2, creator=${shortAddr(WALLETS.bob.address)}, options=4, votingEndsAt=${t2Ends}, initialSponsorship=$100.00 USDC)`,
    `[Block #${t1Snap + 1}] TopicCreated(topicId=1, creator=${shortAddr(WALLETS.alice.address)}, options=3, votingEndsAt=${t1Ends}, initialSponsorship=$0.00 USDC)`,
  ];

  // Seed two authentic direct votes on Topic #1 from Bob (Execution MPT) & Carol (Beacon SSZ)
  // so Alice's 25 ETH wallet + #42 (32 ETH) + #77 (64 ETH) validators remain unvoted for live demo!
  executeDirectVoteOnTopic({
    topic: topic1,
    wallet: WALLETS.bob,
    optionIndex: 0,
    includeExecutionBalance: true,
    validatorIndices: [],
    blockNumber: t1Snap + 3,
    emitLogs: true,
  });
  executeDirectVoteOnTopic({
    topic: topic1,
    wallet: WALLETS.carol,
    optionIndex: 1,
    includeExecutionBalance: false,
    validatorIndices: [256],
    blockNumber: t1Snap + 5,
    emitLogs: true,
  });
}

function getTopicPhase(topic) {
  return state.chainTimestamp <= topic.votingEndsAt ? "Open" : "Closed";
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function escapeHtml(raw) {
  return String(raw)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toDatetimeLocalValue(unixSec) {
  const d = new Date(unixSec * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseVotingEndsUnix() {
  const input = document.getElementById("votingEndsInput");
  if (!input.value) return NaN;
  const ms = new Date(input.value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
}

function formatRemainingTime(votingEndsAt) {
  const diff = votingEndsAt - state.chainTimestamp;
  if (diff < 0) {
    const agoHours = Math.max(1, Math.floor(Math.abs(diff) / 3600));
    return `Ended ${agoHours}h ago`;
  }
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.max(1, Math.floor((diff % 3600) / 60));
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

function showFeedback(type, message) {
  const banner = document.getElementById("createFormFeedback");
  banner.className = `feedback-banner ${type === "error" ? "feedback-error" : "feedback-success"}`;
  banner.textContent = message;
  banner.classList.remove("hidden");
}

function hideFeedback() {
  document.getElementById("createFormFeedback").classList.add("hidden");
}

function syncDefaultValidatorsForActivePersona() {
  const wallet = WALLETS[state.activeWalletKey];
  state.selectedValidatorIndices = new Set(wallet.validators.map((v) => v.validatorIndex));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderChainHeader() {
  const badge = document.getElementById("chainClockBadge");
  const iso = new Date(state.chainTimestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  badge.textContent = `Block #${state.chainBlockNumber.toLocaleString()} · ${iso}`;
}

function renderActiveHoldingsCard() {
  const el = document.getElementById("activeHoldingsCard");
  const wallet = WALLETS[state.activeWalletKey];
  const walletKey = computeWalletPositionKey(CHAIN_ID, wallet.address);
  const stakedWei = wallet.validators.reduce(
    (acc, v) => acc + v.effectiveBalanceGwei * 1_000_000_000n,
    0n
  );

  const valsHtml = wallet.validators
    .map((v) => {
      const vKey = computeValidatorPositionKey(CHAIN_ID, v.validatorIndex);
      const eth = formatEthFromWei(v.effectiveBalanceGwei * 1_000_000_000n);
      return `
        <div class="holding-row">
          <div>
            <strong>Validator #${v.validatorIndex}</strong>
            <span class="cred-pill">${escapeHtml(v.credType)}</span>
            <div class="mono-inline">key: ${vKey.slice(0, 18)}…</div>
          </div>
          <span class="eth-amount">${eth} ETH</span>
        </div>
      `;
    })
    .join("");

  el.innerHTML = `
    <div class="card-header" style="margin-bottom:0.45rem;">
      <h2>${escapeHtml(wallet.name)}'s Snapshot Holdings</h2>
      <span class="badge badge-blue">${formatEthFromWei(wallet.balanceWei + stakedWei)} ETH Total</span>
    </div>
    <p class="muted-text" style="margin-bottom:0.65rem;">
      Active Voter: <code>${wallet.address}</code>
    </p>
    <div class="holdings-stack">
      <div class="holding-row">
        <div>
          <strong>Execution Layer Balance</strong>
          <span class="cred-pill">EIP-1186 MPT</span>
          <div class="mono-inline">key: ${walletKey.slice(0, 18)}…</div>
        </div>
        <span class="eth-amount">${formatEthFromWei(wallet.balanceWei)} ETH</span>
      </div>
      ${valsHtml}
    </div>
  `;
}

function renderDraftOptionsInputs() {
  const container = document.getElementById("optionsInputsList");
  const addBtn = document.getElementById("addOptionBtn");
  const countBadge = document.getElementById("optionCountBadge");

  countBadge.textContent = String(state.draftOptions.length);
  addBtn.disabled = state.draftOptions.length >= MAX_TOPIC_OPTIONS;

  container.innerHTML = "";
  state.draftOptions.forEach((optValue, idx) => {
    const row = document.createElement("div");
    row.className = "option-input-row";

    const pill = document.createElement("span");
    pill.className = "option-idx-pill";
    pill.textContent = String(idx);

    const input = document.createElement("input");
    input.type = "text";
    input.value = optValue;
    input.maxLength = MAX_OPTION_BYTES;
    input.placeholder = `Option ${idx + 1} (free-text choice)`;
    input.addEventListener("input", () => {
      state.draftOptions[idx] = input.value;
      updateLiveDraftPreviews();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "remove-opt-btn";
    removeBtn.title = "Remove option";
    removeBtn.textContent = "✕";
    removeBtn.disabled = state.draftOptions.length <= MIN_TOPIC_OPTIONS;
    removeBtn.addEventListener("click", () => {
      if (state.draftOptions.length > MIN_TOPIC_OPTIONS) {
        state.draftOptions.splice(idx, 1);
        renderDraftOptionsInputs();
        updateLiveDraftPreviews();
      }
    });

    row.append(pill, input, removeBtn);
    container.appendChild(row);
  });
}

function updateLiveDraftPreviews() {
  const subj = document.getElementById("topicSubjectInput").value;
  const subjBytes = utf8ByteLength(subj);
  document.getElementById("subjectByteCounter").textContent = `${subjBytes} / ${MAX_SUBJECT_BYTES} bytes`;

  const endsUnix = parseVotingEndsUnix();
  document.getElementById("votingEndsUnixPreview").textContent = Number.isFinite(endsUnix)
    ? `unix: ${endsUnix}`
    : "unix: —";

  const sponsorVal = Number(document.getElementById("initialSponsorshipInput").value || 0);
  const submitBtn = document.getElementById("createSubmitBtn");
  submitBtn.textContent =
    sponsorVal > 0
      ? `Create Topic + Sponsor $${sponsorVal.toFixed(2)} USDC`
      : "Create Topic (Free · $0)";

  const hashEl = document.getElementById("liveContentHashPreview");
  const check = validateTopicDraft({
    subject: subj,
    options: state.draftOptions,
    votingEndsAt: endsUnix,
    nowTimestamp: state.chainTimestamp,
    initialSponsorshipUsdc: sponsorVal,
  });

  if (check.ok) {
    hashEl.textContent = computeTopicContentHash(subj, state.draftOptions, endsUnix);
  } else {
    hashEl.textContent = `Awaiting valid inputs (${check.error.split(":")[0]})`;
  }
}

function renderTopicsList() {
  const listEl = document.getElementById("topicsList");
  document.getElementById("totalTopicsCount").textContent = String(state.topics.length);

  const filtered = state.topics
    .slice()
    .reverse()
    .filter((t) => state.phaseFilter === "ALL" || getTopicPhase(t) === state.phaseFilter);

  if (filtered.length === 0) {
    listEl.innerHTML = `<p class="muted-text" style="margin:0;">No topics match filter "${escapeHtml(state.phaseFilter)}".</p>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((t) => {
      const phase = getTopicPhase(t);
      const isSelected = t.id === state.selectedTopicId;
      return `
        <div class="res-item ${isSelected ? "active" : ""}" data-topic-id="${t.id}">
          <div class="res-item-top">
            <span>Topic #${t.id} · ${t.totalCountedPositions} pos · ${formatEthFromWei(t.totalWeightWei)} ETH</span>
            <span class="badge ${phase === "Open" ? "badge-open" : "badge-closed"}">${phase}</span>
          </div>
          <div class="res-item-title">${escapeHtml(t.subject)}</div>
          <div class="res-item-meta">
            <span>${escapeHtml(formatRemainingTime(t.votingEndsAt))}</span>
            <span>Pool: $${t.totalSponsoredUsdc.toFixed(2)} USDC</span>
          </div>
        </div>
      `;
    })
    .join("");

  listEl.querySelectorAll("[data-topic-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const nextId = Number(card.getAttribute("data-topic-id"));
      if (state.selectedTopicId !== nextId) {
        state.selectedTopicId = nextId;
        state.selectedVoteOptionIndex = 0;
        state.voteFeedback = null;
      }
      renderTopicsList();
      renderSelectedTopicDetail();
    });
  });
}

function renderSelectedTopicDetail() {
  const detailEl = document.getElementById("topicDetailCard");
  const topic = state.topics.find((t) => t.id === state.selectedTopicId) || state.topics[0];
  if (!topic) {
    detailEl.innerHTML = `<p class="muted-text">Select or create a topic to inspect tallies and cast direct votes.</p>`;
    return;
  }

  if (state.selectedVoteOptionIndex >= topic.options.length) {
    state.selectedVoteOptionIndex = 0;
  }

  const wallet = WALLETS[state.activeWalletKey];
  const phase = getTopicPhase(topic);
  const endsIso = new Date(topic.votingEndsAt * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  // 1. Live ETH-weighted Option Tallies (selectable for voting)
  const optionsHtml = topic.options
    .map((opt, idx) => {
      const wWei = topic.optionWeightsWei[idx];
      const posCount = topic.optionPositionCounts[idx];
      const pct =
        topic.totalWeightWei > 0n
          ? Number((wWei * 10000n) / topic.totalWeightWei) / 100
          : 0;
      const isSelectedChoice = state.selectedVoteOptionIndex === idx;

      return `
        <div class="tally-option-card ${isSelectedChoice ? "selected-choice" : ""}" data-select-opt="${idx}">
          <div class="tally-option-top">
            <div class="tally-option-left">
              <span class="option-idx-pill">${idx}</span>
              <span class="registered-option-label">${escapeHtml(opt)}</span>
            </div>
            <div class="tally-option-stats">
              <strong>${formatEthFromWei(wWei)} ETH</strong>
              <span class="muted-inline">(${pct.toFixed(1)}% · ${posCount} pos)</span>
            </div>
          </div>
          <div class="tally-bar-track">
            <div class="tally-bar-fill" style="width: ${Math.min(100, pct)}%;"></div>
          </div>
        </div>
      `;
    })
    .join("");

  // 2. Active Wallet Eligibility & Receipt Status on this Topic
  const walletKey = computeWalletPositionKey(CHAIN_ID, wallet.address);
  const walletReceipt = topic.positionReceipts.get(walletKey);
  const acctProof = topic.snapshotFixture.accountProofsByAddress.get(wallet.address.toLowerCase());

  const validatorRowsHtml = wallet.validators
    .map((v) => {
      const vKey = computeValidatorPositionKey(CHAIN_ID, v.validatorIndex);
      const receipt = topic.positionReceipts.get(vKey);
      const checked = state.selectedValidatorIndices.has(v.validatorIndex);
      const weightEth = formatEthFromWei(v.effectiveBalanceGwei * 1_000_000_000n);

      return `
        <label class="proof-position-item ${receipt ? "already-counted" : ""}">
          <div class="proof-pos-left">
            <input
              type="checkbox"
              class="val-proof-checkbox"
              data-val-index="${v.validatorIndex}"
              ${checked ? "checked" : ""}
              ${phase !== "Open" ? "disabled" : ""}
            />
            <div>
              <div>
                <strong>Beacon Validator #${v.validatorIndex}</strong>
                <span class="cred-pill">${escapeHtml(v.credType)}</span>
                <span class="cred-pill">Depth-40 SSZ</span>
              </div>
              <div class="mono-inline">validatorKey: ${vKey.slice(0, 22)}…</div>
            </div>
          </div>
          <div class="proof-pos-right">
            <span class="eth-amount">${weightEth} ETH</span>
            ${
              receipt
                ? `<span class="badge badge-closed">Voted → [${receipt.optionIndex}]</span>`
                : `<span class="badge badge-open">Unvoted</span>`
            }
          </div>
        </label>
      `;
    })
    .join("");

  const receiptsList = Array.from(topic.positionReceipts.values());
  const receiptsHtml =
    receiptsList.length === 0
      ? `<p class="muted-text" style="margin:0;">No direct votes cast on this topic yet.</p>`
      : receiptsList
          .map(
            (r) => `
          <div class="receipt-row">
            <span class="mono-inline">${
              r.positionType === PositionType.ExecutionWallet
                ? `THERDAL_WALLET (${r.voterName})`
                : `THERDAL_VALIDATOR #${r.validatorIndex} (${r.voterName})`
            }</span>
            <span class="mono-inline">${r.positionKey.slice(0, 18)}…</span>
            <span>→ Option [${r.optionIndex}] · <strong>${formatEthFromWei(r.weightWei)} ETH</strong></span>
          </div>
        `
          )
          .join("");

  const voteFeedbackHtml = state.voteFeedback
    ? `<div class="feedback-banner ${
        state.voteFeedback.type === "error" ? "feedback-error" : "feedback-success"
      }" style="margin-top:0.75rem;">${escapeHtml(state.voteFeedback.message)}</div>`
    : "";

  detailEl.innerHTML = `
    <div class="card-header">
      <div>
        <span class="mono-inline">Topic #${topic.id} · Registered by ${escapeHtml(topic.creatorName)} (${shortAddr(topic.creator)})</span>
        <h2 style="margin-top:0.25rem; font-size:1.15rem;">${escapeHtml(topic.subject)}</h2>
      </div>
      <span class="badge ${phase === "Open" ? "badge-open" : "badge-closed"}">${phase} · ${escapeHtml(formatRemainingTime(topic.votingEndsAt))}</span>
    </div>

    <div class="section-row-header">
      <h3>Live ETH-Weighted Tallies (Click an option to select vote target)</h3>
      <span class="mono-pill">Total: ${formatEthFromWei(topic.totalWeightWei)} ETH · ${topic.totalCountedPositions} positions · ${topic.directVoteCount} txs</span>
    </div>
    <div class="options-display-grid">
      ${optionsHtml}
    </div>

    <!-- Stage 2 Direct On-Chain Voting Panel -->
    <div class="direct-vote-panel">
      <div class="card-header" style="margin-bottom:0.5rem;">
        <div>
          <h3 style="margin:0; font-size:0.98rem;">Cast Direct On-Chain Vote as ${escapeHtml(wallet.name)} (<code>$0</code> Protocol Fee)</h3>
          <p class="muted-text" style="margin:0.2rem 0 0;">
            Selected Choice: <strong>[${state.selectedVoteOptionIndex}] ${escapeHtml(topic.options[state.selectedVoteOptionIndex])}</strong> · Zero <code>SponsorEscrow</code> consumed.
          </p>
        </div>
        <span class="badge badge-blue">IDirectVoting</span>
      </div>

      <div class="proof-positions-list">
        <div class="proof-position-item ${walletReceipt ? "already-counted" : ""}">
          <div class="proof-pos-left">
            <div>
              <div>
                <strong>Execution Wallet Balance (${shortAddr(wallet.address)})</strong>
                <span class="cred-pill">RLP Header + EIP-1186 MPT (${acctProof ? acctProof.nodeCount : 1} nodes)</span>
              </div>
              <div class="mono-inline">walletKey: ${walletKey.slice(0, 22)}…</div>
            </div>
          </div>
          <div class="proof-pos-right">
            <span class="eth-amount">${formatEthFromWei(wallet.balanceWei)} ETH</span>
            ${
              walletReceipt
                ? `<span class="badge badge-closed">Voted → [${walletReceipt.optionIndex}]</span>`
                : `<span class="badge badge-open">Unvoted</span>`
            }
          </div>
        </div>

        ${validatorRowsHtml}
      </div>

      <div class="vote-actions-row">
        <button
          type="button"
          id="btnVoteExecution"
          class="btn btn-outline btn-sm"
          ${phase !== "Open" ? "disabled" : ""}
        >
          Prove Execution ETH (${formatEthFromWei(wallet.balanceWei)} ETH)
        </button>
        <button
          type="button"
          id="btnVoteBeacon"
          class="btn btn-outline btn-sm"
          ${phase !== "Open" ? "disabled" : ""}
        >
          Prove Selected Beacon Stake (SSZ)
        </button>
        <button
          type="button"
          id="btnVoteCombined"
          class="btn btn-primary btn-sm"
          ${phase !== "Open" ? "disabled" : ""}
        >
          Vote Direct: Wallet + Selected Validators ($0 Fee)
        </button>
      </div>

      ${voteFeedbackHtml}
    </div>

    <!-- Cryptographic Snapshot & Receipt Inspector -->
    <details class="proof-inspector">
      <summary>Inspect Snapshot Roots, RLP/MPT/SSZ Proofs &amp; Position Receipts (${receiptsList.length})</summary>
      <div class="meta-grid" style="margin-top:0.75rem;">
        <div class="meta-box">
          <span class="k">Pinned Parent Block (<code>snapshotBlock</code>)</span>
          <span class="v">#${topic.snapshotBlock.toLocaleString()}</span>
        </div>
        <div class="meta-box">
          <span class="k">Pinned <code>snapshotBlockHash</code></span>
          <span class="v">${topic.snapshotBlockHash.slice(0, 22)}…</span>
        </div>
        <div class="meta-box">
          <span class="k">EIP-4788 <code>snapshotBeaconBlockRoot</code></span>
          <span class="v">${topic.snapshotBeaconBlockRoot.slice(0, 22)}…</span>
        </div>
        <div class="meta-box">
          <span class="k">Authenticated <code>snapshotExecutionRoot</code></span>
          <span class="v">${
            topic.snapshotExecutionRoot
              ? `${topic.snapshotExecutionRoot.slice(0, 22)}… ✓`
              : "Unauthenticated (verified on 1st MPT vote)"
          }</span>
        </div>
        <div class="meta-box">
          <span class="k">Authenticated <code>snapshotBeaconRoot</code></span>
          <span class="v">${
            topic.snapshotBeaconRoot
              ? `${topic.snapshotBeaconRoot.slice(0, 22)}… (Epoch ${topic.snapshotEpoch}) ✓`
              : "Unauthenticated (verified on 1st SSZ vote)"
          }</span>
        </div>
        <div class="meta-box">
          <span class="k">Voting Ends (<code>votingEndsAt</code>)</span>
          <span class="v">${endsIso}</span>
        </div>
        <div class="meta-box" style="grid-column: 1 / -1;">
          <span class="k">Canonical Cross-Layer <code>contentHash</code> (<code>THERDAL_TOPIC_V1</code>)</span>
          <span class="v">${topic.contentHash}</span>
        </div>
      </div>

      <div class="receipts-box">
        <span class="k">Counted Position Receipts (Double-Vote Nullifier Set):</span>
        ${receiptsHtml}
      </div>
    </details>

    <div class="sponsor-bar">
      <span class="muted-text" style="margin:0;">
        ${
          phase === "Open"
            ? `Optional Sponsorship Pool: $${topic.totalSponsoredUsdc.toFixed(2)} USDC (Direct on-chain votes never deduct from SponsorEscrow).`
            : "Voting has ended (Closed). Direct votes and new sponsorships revert with InvalidTopicPhase(Closed, Open)."
        }
      </span>
      <form id="sponsorTopicForm" class="sponsor-inline-form">
        <input type="number" id="topUpAmountInput" min="1" step="1" value="25" ${phase !== "Open" ? "disabled" : ""} />
        <button type="submit" class="btn btn-outline btn-sm" ${phase !== "Open" ? "disabled" : ""}>+ Sponsor USDC</button>
      </form>
    </div>
  `;

  // Wire option target click
  detailEl.querySelectorAll("[data-select-opt]").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedVoteOptionIndex = Number(el.getAttribute("data-select-opt"));
      state.voteFeedback = null;
      renderSelectedTopicDetail();
    });
  });

  // Wire validator checkboxes
  detailEl.querySelectorAll(".val-proof-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const vIdx = Number(e.target.getAttribute("data-val-index"));
      if (e.target.checked) {
        state.selectedValidatorIndices.add(vIdx);
      } else {
        state.selectedValidatorIndices.delete(vIdx);
      }
    });
  });

  const handleVoteClick = (includeExecutionBalance, includeBeaconValidators) => {
    try {
      const valIndices = includeBeaconValidators ? Array.from(state.selectedValidatorIndices) : [];
      state.chainBlockNumber += 1;
      state.chainBeaconSlot += 1;
      state.chainTimestamp += 12;

      const res = executeDirectVoteOnTopic({
        topic,
        wallet,
        optionIndex: state.selectedVoteOptionIndex,
        includeExecutionBalance,
        validatorIndices: valIndices,
        blockNumber: state.chainBlockNumber,
        emitLogs: true,
      });

      state.voteFeedback = {
        type: "success",
        message: `Verified & Counted ${formatEthFromWei(res.totalCastWei)} ETH (${res.positionsCounted} position${
          res.positionsCounted === 1 ? "" : "s"
        }) for [${state.selectedVoteOptionIndex}] "${topic.options[state.selectedVoteOptionIndex]}" ($0 fee).`,
      };
      renderAll();
    } catch (err) {
      const msg = err instanceof DirectVotingError ? `${err.code}: ${err.message}` : String(err);
      state.voteFeedback = { type: "error", message: msg };
      renderSelectedTopicDetail();
    }
  };

  document.getElementById("btnVoteExecution").addEventListener("click", () => {
    handleVoteClick(true, false);
  });

  document.getElementById("btnVoteBeacon").addEventListener("click", () => {
    handleVoteClick(false, true);
  });

  document.getElementById("btnVoteCombined").addEventListener("click", () => {
    handleVoteClick(true, true);
  });

  const sponsorForm = document.getElementById("sponsorTopicForm");
  sponsorForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (getTopicPhase(topic) !== "Open") return;
    const amt = Number(document.getElementById("topUpAmountInput").value || 0);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const actor = WALLETS[state.activeWalletKey];
    state.chainBlockNumber += 1;
    state.chainBeaconSlot += 1;
    state.chainTimestamp += 12;
    topic.totalSponsoredUsdc += amt;

    state.eventLog.unshift(
      `[Block #${state.chainBlockNumber}] TopicSponsored(topicId=${topic.id}, sponsor=${shortAddr(actor.address)}, amount=$${amt.toFixed(2)} USDC, totalSponsored=$${topic.totalSponsoredUsdc.toFixed(2)} USDC)`
    );
    renderAll();
  });
}

function renderEventLog() {
  const logEl = document.getElementById("protocolEventLog");
  logEl.innerHTML = state.eventLog
    .map((entry) => `<div class="log-entry">${escapeHtml(entry)}</div>`)
    .join("");
}

function renderAll() {
  renderChainHeader();
  renderActiveHoldingsCard();
  renderTopicsList();
  renderSelectedTopicDetail();
  renderEventLog();
  updateLiveDraftPreviews();
}

// ---------------------------------------------------------------------------
// Event Wiring
// ---------------------------------------------------------------------------

function setPresetHours(hours) {
  const targetUnix = state.chainTimestamp + hours * 3600;
  document.getElementById("votingEndsInput").value = toDatetimeLocalValue(targetUnix);
  document.querySelectorAll("#durationPresets .chip-btn").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.getAttribute("data-hours")) === hours);
  });
  updateLiveDraftPreviews();
}

function init() {
  seedInitialTopics();
  syncDefaultValidatorsForActivePersona();

  document.getElementById("activePersonaSelect").addEventListener("change", (e) => {
    state.activeWalletKey = e.target.value;
    state.voteFeedback = null;
    syncDefaultValidatorsForActivePersona();
    renderAll();
  });

  document.getElementById("topicSubjectInput").addEventListener("input", () => {
    hideFeedback();
    updateLiveDraftPreviews();
  });

  document.getElementById("votingEndsInput").addEventListener("input", () => {
    document.querySelectorAll("#durationPresets .chip-btn").forEach((b) => b.classList.remove("active"));
    hideFeedback();
    updateLiveDraftPreviews();
  });

  document.getElementById("initialSponsorshipInput").addEventListener("input", () => {
    hideFeedback();
    updateLiveDraftPreviews();
  });

  document.getElementById("addOptionBtn").addEventListener("click", () => {
    if (state.draftOptions.length < MAX_TOPIC_OPTIONS) {
      state.draftOptions.push("");
      renderDraftOptionsInputs();
      updateLiveDraftPreviews();
    }
  });

  document.querySelectorAll("#durationPresets .chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setPresetHours(Number(btn.getAttribute("data-hours")));
    });
  });

  document.querySelectorAll("#phaseFilterTabs .chip-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.phaseFilter = btn.getAttribute("data-filter");
      document.querySelectorAll("#phaseFilterTabs .chip-btn").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderTopicsList();
    });
  });

  document.getElementById("warp1hBtn").addEventListener("click", () => {
    state.chainTimestamp += 3600;
    state.chainBlockNumber += 300;
    state.chainBeaconSlot += 300;
    renderAll();
  });

  document.getElementById("warp24hBtn").addEventListener("click", () => {
    state.chainTimestamp += 86400;
    state.chainBlockNumber += 7200;
    state.chainBeaconSlot += 7200;
    renderAll();
  });

  document.getElementById("warpPastDeadlineBtn").addEventListener("click", () => {
    const selected = state.topics.find((t) => t.id === state.selectedTopicId);
    if (selected && state.chainTimestamp <= selected.votingEndsAt) {
      const delta = selected.votingEndsAt - state.chainTimestamp + 60;
      const blocks = Math.max(1, Math.floor(delta / 12));
      state.chainTimestamp += delta;
      state.chainBlockNumber += blocks;
      state.chainBeaconSlot += blocks;
      state.eventLog.unshift(
        `[Block #${state.chainBlockNumber}] Chain warped past Topic #${selected.id} votingEndsAt (${selected.votingEndsAt}) -> phase is now Closed`
      );
      renderAll();
    }
  });

  document.getElementById("createTopicForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const subject = document.getElementById("topicSubjectInput").value;
    const votingEndsAt = parseVotingEndsUnix();
    const initialSponsorshipUsdc = Number(document.getElementById("initialSponsorshipInput").value || 0);

    const validation = validateTopicDraft({
      subject,
      options: state.draftOptions,
      votingEndsAt,
      nowTimestamp: state.chainTimestamp,
      initialSponsorshipUsdc,
    });

    if (!validation.ok) {
      showFeedback("error", validation.error);
      return;
    }

    const creator = WALLETS[state.activeWalletKey];
    state.chainBlockNumber += 1;
    state.chainBeaconSlot += 1;
    state.chainTimestamp += 12;

    const snapshotBlock = state.chainBlockNumber - 1;
    const nextId = state.topics.length + 1;

    const newTopic = createTopicRecord({
      id: nextId,
      creatorName: creator.name,
      creator: creator.address,
      subject,
      options: state.draftOptions,
      createdAt: state.chainTimestamp,
      votingEndsAt,
      snapshotBlock,
      beaconSlot: state.chainBeaconSlot - 1,
      totalSponsoredUsdc: initialSponsorshipUsdc,
    });

    state.topics.push(newTopic);
    state.selectedTopicId = nextId;
    state.selectedVoteOptionIndex = 0;
    state.voteFeedback = null;
    state.phaseFilter = "ALL";
    document.querySelectorAll("#phaseFilterTabs .chip-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-filter") === "ALL");
    });

    state.eventLog.unshift(
      `[Block #${state.chainBlockNumber}] TopicCreated(topicId=${nextId}, creator=${shortAddr(creator.address)}, snapshotBlock=${snapshotBlock}, beaconRoot=${newTopic.snapshotBeaconBlockRoot.slice(0, 14)}…, initialSponsorship=$${initialSponsorshipUsdc.toFixed(2)} USDC)`
    );

    document.getElementById("topicSubjectInput").value = "";
    document.getElementById("initialSponsorshipInput").value = "0";
    state.draftOptions = ["Support Proposal", "Oppose Proposal"];
    renderDraftOptionsInputs();
    setPresetHours(168);
    showFeedback("success", `Topic #${nextId} registered on-chain ($0 protocol creation fee).`);
    renderAll();
  });

  renderDraftOptionsInputs();
  setPresetHours(168);
  renderAll();
}

init();
