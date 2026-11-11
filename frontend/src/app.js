// Therdal Protocol v0.2 — Interactive Frontend Explorer (USDC 25/25/50 Fee Split & Non-Sequential Settlement)

const PERSONAS = {
  alice: {
    name: "Alice",
    address: "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A",
    walletBalanceEth: 120,
    validators: [{ index: 101, balanceEth: 32, credentialPrefix: "0x01" }],
  },
  bob: {
    name: "Bob",
    address: "0x1563915e194D8CfBA1943570603F7606A3115508",
    walletBalanceEth: 85,
    validators: [{ index: 202, balanceEth: 64, credentialPrefix: "0x02" }],
  },
  carol: {
    name: "Carol",
    address: "0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB",
    walletBalanceEth: 40,
    validators: [],
  },
  submitterA: {
    name: "Submitter A",
    address: "0xA1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1",
    walletBalanceEth: 5,
    validators: [],
  },
  submitterB: {
    name: "Submitter B",
    address: "0xB2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2B2",
    walletBalanceEth: 5,
    validators: [],
  },
  prover: {
    name: "STARK Prover",
    address: "0x000000000000000000000000000000000000CAFE",
    walletBalanceEth: 5,
    validators: [],
  },
};

function pseudoKeccakHex(seed) {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part = (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  return "0x" + part.repeat(4);
}

const state = {
  activePersonaKey: "alice",
  selectedResolutionId: 2,
  controllerOperator: "0xD00D...1Signer",
  pricePerVoteUsdc: 0.01,
  ledgerUsdc: {
    developerController: 20.0075, // 2 resolutions * $10 creation + 25% of settled votes
    submitterA: 0.0025,
    submitterB: 0.0050,
    prover: 0.0150,
  },
  resolutions: [
    {
      id: 1,
      questionURI: "REP-001: Should Ethereum increase the EIP-4844 target blob count from 6 to 12?",
      phase: "ClosedForRefunds",
      snapshotBlockNumber: 21000000,
      snapshotEpoch: 320000,
      snapshotAuthenticated: true,
      pricePerVoteUsdc: 0.01,
      totalEscrowContributedUsdc: 150.0,
      remainingEscrowUsdc: 149.97,
      frozenUnusedEscrowUsdc: 149.97,
      refundsEnabled: true,
      contributors: [
        { name: "Creator ($90 of $100 deposit)", amountUsdc: 90.0, claimed: false },
        { name: "External Sponsor ($60 deposit)", amountUsdc: 60.0, claimed: false },
      ],
      positionRoot: "0x4746b1ddcef8015591272635f354ff18e522a4e50b0d841c3e504de71f7a7977",
      talliesEth: [152, 149, 40],
      countedPositions: 5,
      acceptedVotes: 3,
      settledBatchCount: 2,
      pendingVotes: [],
      batches: [
        {
          batchId: 0,
          submitterName: "Spam Submitter",
          malformed: true,
          settled: false,
          commitmentRoot: "0xdeadbeef00000000000000000000000000000000000000000000000000000000",
          votes: [],
          newlyCountedPositions: 0,
          newlyAcceptedVotes: 0,
        },
        {
          batchId: 1,
          submitterName: "Submitter A",
          malformed: false,
          settled: true,
          commitmentRoot: "0x2a235a9e0d991be64e8051ec0c9641c76357dd84181914b155f874c2b7919daf",
          votes: [{ signerName: "Carol", choice: 2, claims: [{ type: "Wallet", id: PERSONAS.carol.address, weightEth: 40 }] }],
          newlyCountedPositions: 1,
          newlyAcceptedVotes: 1,
        },
        {
          batchId: 2,
          submitterName: "Submitter B",
          malformed: false,
          settled: true,
          commitmentRoot: "0x852dff919bd61daab259f77b5352d85dfe9926432dd52717077c760743c09bfd",
          votes: [
            {
              signerName: "Alice",
              choice: 0,
              claims: [
                { type: "Wallet", id: PERSONAS.alice.address, weightEth: 120 },
                { type: "Validator", id: "Validator #101 (0x01)", weightEth: 32 },
              ],
            },
            {
              signerName: "Bob",
              choice: 1,
              claims: [
                { type: "Wallet", id: PERSONAS.bob.address, weightEth: 85 },
                { type: "Validator", id: "Validator #202 (0x02)", weightEth: 64 },
              ],
            },
          ],
          newlyCountedPositions: 4,
          newlyAcceptedVotes: 2,
        },
      ],
      smtPositions: [
        { keyType: "THERDAL_WALLET", id: PERSONAS.alice.address, weightEth: 120, choice: "YES", batchId: 2 },
        { keyType: "THERDAL_VALIDATOR", id: "Validator #101 (0x01)", weightEth: 32, choice: "YES", batchId: 2 },
        { keyType: "THERDAL_WALLET", id: PERSONAS.bob.address, weightEth: 85, choice: "NO", batchId: 2 },
        { keyType: "THERDAL_VALIDATOR", id: "Validator #202 (0x02)", weightEth: 64, choice: "NO", batchId: 2 },
        { keyType: "THERDAL_WALLET", id: PERSONAS.carol.address, weightEth: 40, choice: "ABSTAIN", batchId: 1 },
      ],
    },
    {
      id: 2,
      questionURI: "REP-002: Should Ethereum prioritize native account abstraction & FOCIL in Glamsterdam?",
      phase: "Open",
      snapshotBlockNumber: 21000100,
      snapshotEpoch: 320005,
      snapshotAuthenticated: false,
      pricePerVoteUsdc: 0.01,
      totalEscrowContributedUsdc: 90.0,
      remainingEscrowUsdc: 90.0,
      frozenUnusedEscrowUsdc: 0,
      refundsEnabled: false,
      contributors: [{ name: "Creator ($90 of $100 deposit)", amountUsdc: 90.0, claimed: false }],
      positionRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
      talliesEth: [0, 0, 0],
      countedPositions: 0,
      acceptedVotes: 0,
      settledBatchCount: 0,
      pendingVotes: [],
      batches: [],
      smtPositions: [],
    },
  ],
  logs: [
    "[Resolution #1] Batch #2 settled BEFORE Batch #1 (non-sequential); malformed Batch #0 bypassed ($0 paid)",
    "[Resolution #2] Created with $100 USDC deposit ($10 to TherdalController + $90 escrow = 9,000 vote capacity)",
  ],
};

function logEvent(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  state.logs.unshift(`[${ts}] ${msg}`);
  renderAll();
}

function getSelectedResolution() {
  return state.resolutions.find((r) => r.id === state.selectedResolutionId);
}

function renderResolutionList() {
  const el = document.getElementById("resolutionList");
  el.innerHTML = state.resolutions
    .map((r) => {
      const badgeClass =
        r.phase === "Open" ? "badge-open" : r.phase === "Settling" ? "badge-settling" : "badge-finalized";
      const totalEth = r.talliesEth[0] + r.talliesEth[1] + r.talliesEth[2];
      return `
        <div class="res-item ${r.id === state.selectedResolutionId ? "active" : ""}" data-id="${r.id}">
          <div class="res-item-top">
            <span>Resolution #${r.id}</span>
            <span class="badge ${badgeClass}">${r.phase}</span>
          </div>
          <div class="res-item-title">${r.questionURI}</div>
          <div class="res-item-meta">
            <span>${totalEth.toFixed(1)} ETH (${r.acceptedVotes} votes / ${r.countedPositions} pos)</span>
            <span>Escrow: $${r.remainingEscrowUsdc.toFixed(2)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  el.querySelectorAll(".res-item").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedResolutionId = Number(node.dataset.id);
      renderAll();
    });
  });
}

function renderLedger() {
  document.getElementById("controllerStatusBadge").textContent =
    `Controller: TherdalSmartAccount (Operator: ${state.controllerOperator})`;
  const el = document.getElementById("actorRewardsBoard");
  el.innerHTML = `
    <div class="list-row">
      <span><strong>TherdalController (Developer 25% + $10 Creation)</strong></span>
      <span class="mono-pill">$${state.ledgerUsdc.developerController.toFixed(4)} USDC</span>
    </div>
    <div class="list-row">
      <span><strong>Submitter A (25% Share)</strong></span>
      <span class="mono-pill">$${state.ledgerUsdc.submitterA.toFixed(4)} USDC</span>
    </div>
    <div class="list-row">
      <span><strong>Submitter B (25% Share)</strong></span>
      <span class="mono-pill">$${state.ledgerUsdc.submitterB.toFixed(4)} USDC</span>
    </div>
    <div class="list-row">
      <span><strong>STARK Prover (50% Share)</strong></span>
      <span class="mono-pill">$${state.ledgerUsdc.prover.toFixed(4)} USDC</span>
    </div>
  `;
}

function renderResolutionDetail() {
  const r = getSelectedResolution();
  const el = document.getElementById("resolutionDetailCard");
  const total = r.talliesEth[0] + r.talliesEth[1] + r.talliesEth[2];
  const pct = (val) => (total > 0 ? ((val / total) * 100).toFixed(1) : "0.0");
  const badgeClass =
    r.phase === "Open" ? "badge-open" : r.phase === "Settling" ? "badge-settling" : "badge-finalized";
  const voteCapacityLeft = Math.floor(r.remainingEscrowUsdc / r.pricePerVoteUsdc);

  el.innerHTML = `
    <div class="card-header">
      <h2>${r.questionURI}</h2>
      <span class="badge ${badgeClass}">${r.phase}</span>
    </div>

    <div class="tally-bars">
      <div class="tally-row">
        <div class="tally-label"><span>YES (0)</span><span>${r.talliesEth[0].toFixed(2)} ETH (${pct(r.talliesEth[0])}%)</span></div>
        <div class="progress-track"><div class="progress-fill fill-yes" style="width: ${pct(r.talliesEth[0])}%"></div></div>
      </div>
      <div class="tally-row">
        <div class="tally-label"><span>NO (1)</span><span>${r.talliesEth[1].toFixed(2)} ETH (${pct(r.talliesEth[1])}%)</span></div>
        <div class="progress-track"><div class="progress-fill fill-no" style="width: ${pct(r.talliesEth[1])}%"></div></div>
      </div>
      <div class="tally-row">
        <div class="tally-label"><span>ABSTAIN (2)</span><span>${r.talliesEth[2].toFixed(2)} ETH (${pct(r.talliesEth[2])}%)</span></div>
        <div class="progress-track"><div class="progress-fill fill-abstain" style="width: ${pct(r.talliesEth[2])}%"></div></div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-box">
        <span class="k">Frozen Price / Accepted Vote</span>
        <span class="v">$${r.pricePerVoteUsdc.toFixed(2)} USDC ($10 / 1k)</span>
      </div>
      <div class="meta-box">
        <span class="k">Remaining Escrow / Total C</span>
        <span class="v">$${r.remainingEscrowUsdc.toFixed(4)} / $${r.totalEscrowContributedUsdc.toFixed(2)}</span>
      </div>
      <div class="meta-box">
        <span class="k">Remaining Funded Capacity</span>
        <span class="v">${voteCapacityLeft.toLocaleString()} Votes</span>
      </div>
      <div class="meta-box">
        <span class="k">Accepted Votes vs Positions</span>
        <span class="v">${r.acceptedVotes} Votes / ${r.countedPositions} Positions</span>
      </div>
      <div class="meta-box">
        <span class="k">Snapshot Auth (#${r.snapshotBlockNumber})</span>
        <span class="v">${r.snapshotAuthenticated ? "Verified On-Chain" : "Pending Auth"}</span>
      </div>
      <div class="meta-box">
        <span class="k">Batches Settled (Out-of-Order)</span>
        <span class="v">${r.settledBatchCount} / ${r.batches.length} Registered</span>
      </div>
    </div>
  `;
}

function renderVoterAndBatches() {
  const persona = PERSONAS[state.activePersonaKey];
  const preview = document.getElementById("voterPositionsPreview");
  preview.innerHTML = [
    `<div class="list-row"><span><strong>THERDAL_WALLET</strong> (${persona.address.slice(0, 10)}...)</span><span>${persona.walletBalanceEth} ETH</span></div>`,
    ...persona.validators.map(
      (v) =>
        `<div class="list-row"><span><strong>THERDAL_VALIDATOR</strong> #${v.index} (${v.credentialPrefix})</span><span>${v.balanceEth} ETH</span></div>`
    ),
  ].join("");

  const r = getSelectedResolution();
  document.getElementById("pendingVoteCount").textContent = String(r.pendingVotes.length);
  const pendingEl = document.getElementById("pendingVotesList");
  pendingEl.innerHTML =
    r.pendingVotes.length === 0
      ? `<div class="list-row"><span class="muted-text">Buffer empty. Sign EIP-712 votes above.</span></div>`
      : r.pendingVotes
          .map(
            (v, i) =>
              `<div class="list-row"><span>#${i + 1} <strong>${v.signerName}</strong> → Choice ${v.choice} (${v.claims.length} pos)</span><span class="mono-pill">1 vote</span></div>`
          )
          .join("");

  const batchEl = document.getElementById("batchRegistryList");
  if (r.batches.length === 0) {
    batchEl.innerHTML = `<div class="list-row"><span class="muted-text">No EIP-4844 batches registered yet.</span></div>`;
  } else {
    batchEl.innerHTML = r.batches
      .map((b) => {
        if (b.malformed) {
          return `
            <div class="list-row">
              <div>
                <strong>Batch #${b.batchId}</strong> by ${b.submitterName} <span class="badge badge-settling">Malformed / Spam</span><br/>
                <small>Unprovable data — bypassed by non-sequential provers ($0 earned)</small>
              </div>
              <span class="mono-pill">$0.00</span>
            </div>
          `;
        }
        return `
          <div class="list-row">
            <div>
              <strong>Batch #${b.batchId}</strong> by ${b.submitterName} (${b.votes.length} signed votes)<br/>
              <small>${
                b.settled
                  ? `Settled: +${b.newlyAcceptedVotes} accepted votes (+${b.newlyCountedPositions} positions)`
                  : `Unsettled — can be proven in any order!`
              }</small>
            </div>
            ${
              b.settled
                ? `<span class="badge badge-open">Settled</span>`
                : `<button class="btn btn-primary btn-sm settle-batch-btn" data-batch="${b.batchId}">Prove &amp; Settle #${b.batchId}</button>`
            }
          </div>
        `;
      })
      .join("");

    batchEl.querySelectorAll(".settle-batch-btn").forEach((btn) => {
      btn.addEventListener("click", () => settleSpecificBatch(Number(btn.dataset.batch)));
    });
  }

  // Pro-rata refunds board
  const refundEl = document.getElementById("refundBoard");
  if (!r.refundsEnabled) {
    refundEl.innerHTML = `<div class="list-row"><span class="muted-text">Refunds unlock once settlement closes (<code>U</code> frozen).</span></div>`;
  } else {
    refundEl.innerHTML = r.contributors
      .map((c, idx) => {
        const share = (r.frozenUnusedEscrowUsdc * c.amountUsdc) / r.totalEscrowContributedUsdc;
        return `
          <div class="list-row">
            <span><strong>${c.name}</strong><br/><small>Basis c_i = $${c.amountUsdc.toFixed(2)} / C = $${r.totalEscrowContributedUsdc.toFixed(2)}</small></span>
            ${
              c.claimed
                ? `<span class="badge badge-open">Claimed $${share.toFixed(4)}</span>`
                : `<button class="btn btn-outline btn-sm claim-refund-btn" data-idx="${idx}">Claim $${share.toFixed(4)} USDC</button>`
            }
          </div>
        `;
      })
      .join("");

    refundEl.querySelectorAll(".claim-refund-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = r.contributors[Number(btn.dataset.idx)];
        const share = (r.frozenUnusedEscrowUsdc * c.amountUsdc) / r.totalEscrowContributedUsdc;
        c.claimed = true;
        r.remainingEscrowUsdc = Math.max(0, r.remainingEscrowUsdc - share);
        logEvent(`[RefundClaimed] ${c.name} withdrew pro-rata refund of $${share.toFixed(4)} USDC`);
      });
    });
  }

  document.getElementById("smtRootBadge").textContent = `positionRoot: ${r.positionRoot.slice(0, 18)}...`;
  const smtEl = document.getElementById("smtPositionsList");
  smtEl.innerHTML =
    r.smtPositions.length === 0
      ? `<div class="list-row"><span class="muted-text">Empty SMT (bytes32(0)).</span></div>`
      : r.smtPositions
          .map(
            (p) =>
              `<div class="list-row"><span><strong>${p.keyType}</strong> · ${p.id.slice(0, 18)} (Batch #${p.batchId})</span><span><strong>${p.weightEth} ETH</strong> (${p.choice})</span></div>`
          )
          .join("");

  document.getElementById("protocolEventLog").innerHTML = state.logs
    .map((l) => `<div class="log-entry">${l}</div>`)
    .join("");
}

function settleSpecificBatch(batchId) {
  const r = getSelectedResolution();
  if (r.phase !== "Settling") {
    logEvent(`[Error] settleBatch requires Settling phase (current: ${r.phase})`);
    return;
  }
  if (!r.snapshotAuthenticated) {
    logEvent(`[Error] settleBatch reverted: SnapshotNotAuthenticated(${r.id})`);
    return;
  }
  const batch = r.batches.find((b) => b.batchId === batchId);
  if (!batch || batch.settled || batch.malformed) return;

  // Simulate dry-run count first to enforce Section 9.4 InsufficientEscrowBalance check
  let previewAcceptedVotes = 0;
  const tempKeys = new Set(r.smtPositions.map((p) => `${p.keyType}:${p.id}`));
  for (const v of batch.votes) {
    let added = false;
    for (const c of v.claims) {
      const k = `${c.type === "Wallet" ? "THERDAL_WALLET" : "THERDAL_VALIDATOR"}:${c.id}`;
      if (!tempKeys.has(k)) {
        tempKeys.add(k);
        added = true;
      }
    }
    if (added) previewAcceptedVotes += 1;
  }

  const totalFeeUsdc = previewAcceptedVotes * r.pricePerVoteUsdc;
  if (totalFeeUsdc > r.remainingEscrowUsdc) {
    logEvent(
      `[Revert] InsufficientEscrowBalance: required $${totalFeeUsdc.toFixed(4)} USDC > available $${r.remainingEscrowUsdc.toFixed(4)} USDC`
    );
    return;
  }

  let newlyCountedPositions = 0;
  let newlyAcceptedVotes = 0;
  for (const v of batch.votes) {
    const choiceLabel = v.choice === 0 ? "YES" : v.choice === 1 ? "NO" : "ABSTAIN";
    let contributedNewPos = false;
    for (const c of v.claims) {
      const keyType = c.type === "Wallet" ? "THERDAL_WALLET" : "THERDAL_VALIDATOR";
      if (!r.smtPositions.some((p) => p.keyType === keyType && p.id === c.id)) {
        r.smtPositions.push({ keyType, id: c.id, weightEth: c.weightEth, choice: choiceLabel, batchId });
        r.talliesEth[v.choice] += c.weightEth;
        r.countedPositions += 1;
        newlyCountedPositions += 1;
        contributedNewPos = true;
      }
    }
    if (contributedNewPos) newlyAcceptedVotes += 1;
  }

  const devShare = totalFeeUsdc * 0.25;
  const subShare = totalFeeUsdc * 0.25;
  const provShare = totalFeeUsdc * 0.50;

  r.remainingEscrowUsdc -= totalFeeUsdc;
  r.acceptedVotes += newlyAcceptedVotes;
  r.settledBatchCount += 1;
  r.positionRoot = pseudoKeccakHex(`smt-${r.id}-${batchId}-${r.countedPositions}`);

  batch.settled = true;
  batch.newlyCountedPositions = newlyCountedPositions;
  batch.newlyAcceptedVotes = newlyAcceptedVotes;

  state.ledgerUsdc.developerController += devShare;
  if (batch.submitterName === "Submitter B") {
    state.ledgerUsdc.submitterB += subShare;
  } else {
    state.ledgerUsdc.submitterA += subShare;
  }
  state.ledgerUsdc.prover += provShare;

  logEvent(
    `[BatchSettled] Batch #${batchId} settled out-of-order (+${newlyAcceptedVotes} votes, +${newlyCountedPositions} pos). Split $${totalFeeUsdc.toFixed(4)} USDC -> Dev $${devShare.toFixed(4)} / ${batch.submitterName} $${subShare.toFixed(4)} / Prover $${provShare.toFixed(4)}`
  );
}

function renderAll() {
  renderResolutionList();
  renderLedger();
  renderResolutionDetail();
  renderVoterAndBatches();
}

// Event Handlers
document.getElementById("activePersonaSelect").addEventListener("change", (e) => {
  state.activePersonaKey = e.target.value;
  renderAll();
});

document.getElementById("toggleCreateBtn").addEventListener("click", () => {
  document.getElementById("createResolutionCard").classList.toggle("hidden");
});

document.getElementById("handoffDaoBtn").addEventListener("click", () => {
  state.controllerOperator = "0xDA00...TimelockDAO";
  logEvent(`[TherdalController] Operator control transferred from initial signer to DAO Timelock (0xDA00...TimelockDAO)`);
});

document.getElementById("createResolutionForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = document.getElementById("resQuestionInput").value.trim();
  const snapBlock = Number(document.getElementById("resSnapshotBlockInput").value);
  const snapEpoch = Number(document.getElementById("resSnapshotEpochInput").value);
  const extra = Number(document.getElementById("resExtraSponsorInput").value);

  const newId = state.resolutions.length + 1;
  const creatorEscrow = 90 + extra;
  state.ledgerUsdc.developerController += 10.0; // $10 nonrefundable creation fee

  state.resolutions.push({
    id: newId,
    questionURI: q,
    phase: "Open",
    snapshotBlockNumber: snapBlock,
    snapshotEpoch: snapEpoch,
    snapshotAuthenticated: false,
    pricePerVoteUsdc: state.pricePerVoteUsdc,
    totalEscrowContributedUsdc: creatorEscrow,
    remainingEscrowUsdc: creatorEscrow,
    frozenUnusedEscrowUsdc: 0,
    refundsEnabled: false,
    contributors: [{ name: `Creator ($${creatorEscrow} escrow)`, amountUsdc: creatorEscrow, claimed: false }],
    positionRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    talliesEth: [0, 0, 0],
    countedPositions: 0,
    acceptedVotes: 0,
    settledBatchCount: 0,
    pendingVotes: [],
    batches: [],
    smtPositions: [],
  });
  state.selectedResolutionId = newId;
  document.getElementById("createResolutionCard").classList.add("hidden");
  document.getElementById("resQuestionInput").value = "";
  logEvent(`[ResolutionCreated] #${newId} paid $100 USDC ($10 Dev Fee -> TherdalController, $${creatorEscrow} -> Escrow)`);
});

document.getElementById("signVoteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const r = getSelectedResolution();
  if (r.phase !== "Open") {
    logEvent(`[Error] Publication window closed for Resolution #${r.id}`);
    return;
  }
  const persona = PERSONAS[state.activePersonaKey];
  const choice = Number(document.querySelector('input[name="voteChoice"]:checked').value);
  const claims = [
    { type: "Wallet", id: persona.address, weightEth: persona.walletBalanceEth },
    ...persona.validators.map((v) => ({
      type: "Validator",
      id: `Validator #${v.index} (${v.credentialPrefix})`,
      weightEth: v.balanceEth,
    })),
  ];
  r.pendingVotes.push({ signerName: persona.name, choice, claims });
  logEvent(`[Vote Signed] ${persona.name} signed EIP-712 Vote (${claims.length} ETH positions = 1 vote fee unit)`);
});

document.getElementById("publishBatchBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  if (r.phase !== "Open" || r.pendingVotes.length === 0) {
    logEvent(`[Error] Must be in Open phase with >=1 buffered vote to publish batch`);
    return;
  }
  const submitterName = state.activePersonaKey === "submitterB" ? "Submitter B" : "Submitter A";
  const batchId = r.batches.length;
  r.batches.push({
    batchId,
    submitterName,
    malformed: false,
    settled: false,
    commitmentRoot: pseudoKeccakHex(`commit-${r.id}-${batchId}`),
    votes: [...r.pendingVotes],
    newlyCountedPositions: 0,
    newlyAcceptedVotes: 0,
  });
  r.pendingVotes = [];
  logEvent(`[BatchPublished] Batch #${batchId} permissionlessly registered by ${submitterName} ($0 upfront)`);
});

document.getElementById("publishSpamBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  if (r.phase !== "Open") {
    logEvent(`[Error] Must be in Open phase to publish`);
    return;
  }
  const batchId = r.batches.length;
  r.batches.push({
    batchId,
    submitterName: "Spam Submitter",
    malformed: true,
    settled: false,
    commitmentRoot: pseudoKeccakHex(`spam-${r.id}-${batchId}`),
    votes: [],
    newlyCountedPositions: 0,
    newlyAcceptedVotes: 0,
  });
  logEvent(`[BatchPublished] Malformed Batch #${batchId} posted — will NOT block other batches in non-sequential settlement!`);
});

document.getElementById("addSponsorBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  if (r.refundsEnabled) {
    logEvent(`[Error] Resolution #${r.id} settlement is already closed`);
    return;
  }
  r.totalEscrowContributedUsdc += 60.0;
  r.remainingEscrowUsdc += 60.0;
  r.contributors.push({ name: "External Sponsor ($60 deposit)", amountUsdc: 60.0, claimed: false });
  logEvent(`[ResolutionSponsored] Added $60.00 USDC (100% to escrow, $0 fee). Total C = $${r.totalEscrowContributedUsdc.toFixed(2)} USDC`);
});

document.getElementById("authSnapshotBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  r.snapshotAuthenticated = true;
  logEvent(`[SnapshotAuthenticated] Verified EIP-2935 block #${r.snapshotBlockNumber} & EIP-4788 epoch ${r.snapshotEpoch}`);
});

document.getElementById("closeVotingBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  if (r.phase === "Open") {
    r.phase = "Settling";
    logEvent(`[Phase] Resolution #${r.id} entered Settling phase — provers may settle any valid batch out-of-order`);
  }
});

document.getElementById("closeSettlementBtn").addEventListener("click", () => {
  const r = getSelectedResolution();
  if (r.refundsEnabled) return;
  r.phase = "ClosedForRefunds";
  r.refundsEnabled = true;
  r.frozenUnusedEscrowUsdc = r.remainingEscrowUsdc;
  logEvent(
    `[SettlementClosedAndRefundsEnabled] Resolution #${r.id} grace period closed. Frozen unused escrow U = $${r.frozenUnusedEscrowUsdc.toFixed(4)} USDC`
  );
});

renderAll();

if (window.location.hash === "#create") {
  const createCard = document.getElementById("createResolutionCard");
  const qInput = document.getElementById("resQuestionInput");
  if (createCard) {
    createCard.classList.remove("hidden");
    createCard.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (qInput) qInput.focus();
}
