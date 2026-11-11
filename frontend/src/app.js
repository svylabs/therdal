import {
  MAX_OPTION_BYTES,
  MAX_SUBJECT_BYTES,
  MAX_TOPIC_OPTIONS,
  MIN_TOPIC_OPTIONS,
  computeParentBlockHash,
  computeTopicContentHash,
  utf8ByteLength,
  validateTopicDraft,
} from "./topicDomain.js";

const WALLETS = {
  alice: { name: "Alice", address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A" },
  bob: { name: "Bob", address: "0x1563915e194D8CfBA1943570603F7606A3115508" },
  carol: { name: "Carol", address: "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB" },
};

const nowInitialSec = Math.floor(Date.now() / 1000);

const state = {
  activeWalletKey: "alice",
  chainTimestamp: nowInitialSec,
  chainBlockNumber: 21_500_000,
  pricePerVoteUsdc: 0.01,
  phaseFilter: "ALL",
  selectedTopicId: 1,
  draftOptions: [
    "Increase to 12 Blobs",
    "Increase to 9 Blobs",
    "Keep at 6 Blobs",
  ],
  topics: [],
  eventLog: [],
};

function seedInitialTopics() {
  const t1Ends = state.chainTimestamp + 7 * 86400;
  const t1Opts = ["12 Blobs", "9 Blobs", "Keep at 6 Blobs"];
  const t1Subj = "Should Ethereum increase the blob target from 6 to 12?";
  const t1Snap = state.chainBlockNumber - 10;

  const t2Ends = state.chainTimestamp + 14 * 86400;
  const t2Opts = ["60M Gas Limit", "45M Gas Limit", "36M Gas Limit", "Keep 30M Gas"];
  const t2Subj = "What L1 execution block gas limit should validators target next?";
  const t2Snap = state.chainBlockNumber - 2;

  state.topics = [
    {
      id: 1,
      creatorName: "Alice",
      creator: WALLETS.alice.address,
      subject: t1Subj,
      options: t1Opts,
      createdAt: state.chainTimestamp - 120,
      votingEndsAt: t1Ends,
      snapshotBlock: t1Snap,
      snapshotBlockHash: computeParentBlockHash(t1Snap),
      contentHash: computeTopicContentHash(t1Subj, t1Opts, t1Ends),
      pricePerVoteUsdc: 0.01,
      totalSponsoredUsdc: 0,
    },
    {
      id: 2,
      creatorName: "Bob",
      creator: WALLETS.bob.address,
      subject: t2Subj,
      options: t2Opts,
      createdAt: state.chainTimestamp - 24,
      votingEndsAt: t2Ends,
      snapshotBlock: t2Snap,
      snapshotBlockHash: computeParentBlockHash(t2Snap),
      contentHash: computeTopicContentHash(t2Subj, t2Opts, t2Ends),
      pricePerVoteUsdc: 0.01,
      totalSponsoredUsdc: 100,
    },
  ];

  state.eventLog = [
    `[Block #${t2Snap + 1}] TopicCreated(topicId=2, creator=${shortAddr(WALLETS.bob.address)}, options=4, votingEndsAt=${t2Ends}, initialSponsorship=$100.00 USDC)`,
    `[Block #${t1Snap + 1}] TopicCreated(topicId=1, creator=${shortAddr(WALLETS.alice.address)}, options=3, votingEndsAt=${t1Ends}, initialSponsorship=$0.00 USDC)`,
  ];
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderChainHeader() {
  const badge = document.getElementById("chainClockBadge");
  const iso = new Date(state.chainTimestamp * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  badge.textContent = `Block #${state.chainBlockNumber.toLocaleString()} · ${iso}`;
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
            <span>Topic #${t.id} · ${t.options.length} options</span>
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
      state.selectedTopicId = Number(card.getAttribute("data-topic-id"));
      renderTopicsList();
      renderSelectedTopicDetail();
    });
  });
}

function renderSelectedTopicDetail() {
  const detailEl = document.getElementById("topicDetailCard");
  const topic = state.topics.find((t) => t.id === state.selectedTopicId) || state.topics[0];
  if (!topic) {
    detailEl.innerHTML = `<p class="muted-text">Select or create a topic to inspect its on-chain registration.</p>`;
    return;
  }

  const phase = getTopicPhase(topic);
  const endsIso = new Date(topic.votingEndsAt * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const optionsHtml = topic.options
    .map(
      (opt, idx) => `
      <div class="registered-option-card">
        <span class="option-idx-pill">${idx}</span>
        <span class="registered-option-label">${escapeHtml(opt)}</span>
      </div>
    `
    )
    .join("");

  detailEl.innerHTML = `
    <div class="card-header">
      <div>
        <span class="mono-inline">Topic #${topic.id} · Registered by ${escapeHtml(topic.creatorName)} (${shortAddr(topic.creator)})</span>
        <h2 style="margin-top:0.25rem; font-size:1.15rem;">${escapeHtml(topic.subject)}</h2>
      </div>
      <span class="badge ${phase === "Open" ? "badge-open" : "badge-closed"}">${phase} · ${escapeHtml(formatRemainingTime(topic.votingEndsAt))}</span>
    </div>

    <h3>Registered Voting Options (${topic.options.length})</h3>
    <div class="options-display-grid">
      ${optionsHtml}
    </div>

    <div class="meta-grid">
      <div class="meta-box">
        <span class="k">Voting Ends (<code>votingEndsAt</code>)</span>
        <span class="v">${endsIso} (${topic.votingEndsAt})</span>
      </div>
      <div class="meta-box">
        <span class="k">Pinned Parent Block (<code>block.number - 1</code>)</span>
        <span class="v">#${topic.snapshotBlock.toLocaleString()}</span>
      </div>
      <div class="meta-box">
        <span class="k">Pinned Snapshot Block Hash</span>
        <span class="v">${topic.snapshotBlockHash.slice(0, 22)}…</span>
      </div>
      <div class="meta-box">
        <span class="k">Sponsored Pool (100% to Escrow · $0 Fee)</span>
        <span class="v">$${topic.totalSponsoredUsdc.toFixed(2)} USDC (~$${topic.pricePerVoteUsdc.toFixed(2)}/vote est.)</span>
      </div>
      <div class="meta-box" style="grid-column: 1 / -1;">
        <span class="k">Canonical Cross-Layer <code>contentHash</code> (<code>THERDAL_TOPIC_V1</code>)</span>
        <span class="v">${topic.contentHash}</span>
      </div>
    </div>

    <div class="sponsor-bar">
      <span class="muted-text" style="margin:0;">
        ${
          phase === "Open"
            ? "Optional Sponsorship: Anyone can deposit USDC into this topic's pool while voting is Open."
            : "Voting has ended (Closed). New sponsorships are rejected on-chain via InvalidTopicPhase(Closed, Open)."
        }
      </span>
      <form id="sponsorTopicForm" class="sponsor-inline-form">
        <input type="number" id="topUpAmountInput" min="1" step="1" value="25" ${phase !== "Open" ? "disabled" : ""} />
        <button type="submit" class="btn btn-outline btn-sm" ${phase !== "Open" ? "disabled" : ""}>+ Sponsor USDC</button>
      </form>
    </div>
  `;

  const sponsorForm = document.getElementById("sponsorTopicForm");
  sponsorForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (getTopicPhase(topic) !== "Open") return;
    const amt = Number(document.getElementById("topUpAmountInput").value || 0);
    if (!Number.isFinite(amt) || amt <= 0) return;

    const actor = WALLETS[state.activeWalletKey];
    state.chainBlockNumber += 1;
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

  document.getElementById("activePersonaSelect").addEventListener("change", (e) => {
    state.activeWalletKey = e.target.value;
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
    renderAll();
  });

  document.getElementById("warp24hBtn").addEventListener("click", () => {
    state.chainTimestamp += 86400;
    state.chainBlockNumber += 7200;
    renderAll();
  });

  document.getElementById("warpPastDeadlineBtn").addEventListener("click", () => {
    const selected = state.topics.find((t) => t.id === state.selectedTopicId);
    if (selected && state.chainTimestamp <= selected.votingEndsAt) {
      const delta = selected.votingEndsAt - state.chainTimestamp + 60;
      state.chainTimestamp += delta;
      state.chainBlockNumber += Math.max(1, Math.floor(delta / 12));
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
    state.chainTimestamp += 12;

    const snapshotBlock = state.chainBlockNumber - 1;
    const snapshotBlockHash = computeParentBlockHash(snapshotBlock);
    const contentHash = computeTopicContentHash(subject, state.draftOptions, votingEndsAt);
    const nextId = state.topics.length + 1;

    const newTopic = {
      id: nextId,
      creatorName: creator.name,
      creator: creator.address,
      subject,
      options: [...state.draftOptions],
      createdAt: state.chainTimestamp,
      votingEndsAt,
      snapshotBlock,
      snapshotBlockHash,
      contentHash,
      pricePerVoteUsdc: state.pricePerVoteUsdc,
      totalSponsoredUsdc: initialSponsorshipUsdc,
    };

    state.topics.push(newTopic);
    state.selectedTopicId = nextId;
    state.phaseFilter = "ALL";
    document.querySelectorAll("#phaseFilterTabs .chip-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-filter") === "ALL");
    });

    state.eventLog.unshift(
      `[Block #${state.chainBlockNumber}] TopicCreated(topicId=${nextId}, creator=${shortAddr(creator.address)}, options=${newTopic.options.length}, votingEndsAt=${votingEndsAt}, initialSponsorship=$${initialSponsorshipUsdc.toFixed(2)} USDC)`
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
