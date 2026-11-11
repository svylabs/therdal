(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Material Design Ripple Feedback
  // ---------------------------------------------------------------------------
  document.querySelectorAll(".md-ripple").forEach(function (el) {
    el.addEventListener("pointerdown", function (e) {
      const rect = el.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const wave = document.createElement("span");
      wave.className = "md-ripple-wave";
      wave.style.width = size + "px";
      wave.style.height = size + "px";
      wave.style.left = e.clientX - rect.left - size / 2 + "px";
      wave.style.top = e.clientY - rect.top - size / 2 + "px";
      el.appendChild(wave);
      setTimeout(function () {
        wave.remove();
      }, 540);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Hero Live Signal Switcher (Custom Creator-Defined Options per Topic)
  // ---------------------------------------------------------------------------
  const TOPICS = [
    {
      question: "What target blob count should the next upgrade adopt?",
      walletsEth: "588K ETH",
      validatorsEth: "1.34M ETH",
      options: [
        { label: "12 Blobs per Block", pct: 58, eth: "1.12M ETH", fill: "fill-primary", cls: "choice-lead" },
        { label: "9 Blobs per Block", pct: 29, eth: "558K ETH", fill: "fill-tertiary", cls: "" },
        { label: "Keep at 6 Blobs", pct: 13, eth: "250K ETH", fill: "fill-neutral", cls: "choice-muted" },
      ],
    },
    {
      question: "Which L1 block gas limit target do you support?",
      walletsEth: "640K ETH",
      validatorsEth: "1.46M ETH",
      options: [
        { label: "60M Gas Limit", pct: 51, eth: "1.07M ETH", fill: "fill-primary", cls: "choice-lead" },
        { label: "45M Gas Limit", pct: 28, eth: "588K ETH", fill: "fill-tertiary", cls: "" },
        { label: "36M Gas Limit", pct: 14, eth: "294K ETH", fill: "fill-purple", cls: "" },
        { label: "No Change", pct: 7, eth: "147K ETH", fill: "fill-neutral", cls: "choice-muted" },
      ],
    },
    {
      question: "Preferred staking issuance policy above 33M staked ETH?",
      walletsEth: "740K ETH",
      validatorsEth: "1.28M ETH",
      options: [
        { label: "Tempered Issuance Curve", pct: 54, eth: "1.09M ETH", fill: "fill-primary", cls: "choice-lead" },
        { label: "Keep Current Curve", pct: 31, eth: "626K ETH", fill: "fill-tertiary", cls: "" },
        { label: "Soft Cap at 33M ETH", pct: 15, eth: "304K ETH", fill: "fill-neutral", cls: "choice-muted" },
      ],
    },
  ];

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function setWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = pct + "%";
  }

  function renderTopicOptions(topic) {
    const stack = document.getElementById("heroOptionsStack");
    if (!stack) return;
    stack.innerHTML = topic.options
      .map(function (opt) {
        const cls = opt.cls ? "tally-choice " + opt.cls : "tally-choice";
        return (
          '<div class="tally-row">' +
            '<div class="tally-label">' +
              '<span class="' + cls + '">' + opt.label + "</span>" +
              '<span class="tally-meta"><strong>' + opt.pct + '%</strong> · <span>' + opt.eth + "</span></span>" +
            "</div>" +
            '<div class="md-progress">' +
              '<div class="md-progress-fill ' + opt.fill + '" style="width: ' + opt.pct + '%"></div>' +
            "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  const topicChips = document.querySelectorAll("[data-topic]");
  topicChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      const idx = Number(chip.getAttribute("data-topic") || 0);
      const t = TOPICS[idx] || TOPICS[0];

      topicChips.forEach(function (c) {
        c.classList.toggle("active", c === chip);
      });

      setText("heroTopicQuestion", t.question);
      setText("heroWalletsEth", t.walletsEth);
      setText("heroValidatorsEth", t.validatorsEth);
      renderTopicOptions(t);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Top 4-Step Overview Active Highlighting
  // ---------------------------------------------------------------------------
  const stepLinks = document.querySelectorAll("[data-step-link]");
  stepLinks.forEach(function (link) {
    link.addEventListener("click", function () {
      stepLinks.forEach(function (l) {
        l.classList.toggle("active", l === link);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Earn Revenue Split Simulator
  // ---------------------------------------------------------------------------
  const slider = document.getElementById("simVotesSlider");

  function fmtUsd(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function updateSim() {
    if (!slider) return;
    const votes = Number(slider.value);
    const poolCents = 10000; // Example $100.00 sponsored pool ($0 creation fee)

    const settledCents = votes; // Estimated ~$0.01 per valid vote
    const refundCents = poolCents - settledCents;

    const proverCents = settledCents * 0.5;
    const aggCents = settledCents * 0.25;
    const protoCents = settledCents * 0.25;

    setText("simVotesLabel", votes.toLocaleString() + " / ~10,000 votes");
    setText("simProverAmt", fmtUsd(proverCents));
    setText("simAggAmt", fmtUsd(aggCents));
    setText("simProtoAmt", fmtUsd(protoCents));
    setText("simRefundAmt", fmtUsd(refundCents));

    setWidth("simProverBar", ((proverCents / poolCents) * 100).toFixed(1));
    setWidth("simAggBar", ((aggCents / poolCents) * 100).toFixed(1));
    setWidth("simProtoBar", ((protoCents / poolCents) * 100).toFixed(1));
    setWidth("simRefundBar", ((refundCents / poolCents) * 100).toFixed(1));
  }

  if (slider) {
    slider.addEventListener("input", updateSim);
    updateSim();
  }
})();
