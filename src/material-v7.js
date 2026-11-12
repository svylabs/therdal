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

    const proverCents = settledCents * 0.65;
    const aggCents = settledCents * 0.35;

    setText("simVotesLabel", votes.toLocaleString() + " / ~10,000 votes");
    setText("simProverAmt", fmtUsd(proverCents));
    setText("simAggAmt", fmtUsd(aggCents));
    setText("simRefundAmt", fmtUsd(refundCents));

    setWidth("simProverBar", ((proverCents / poolCents) * 100).toFixed(1));
    setWidth("simAggBar", ((aggCents / poolCents) * 100).toFixed(1));
    setWidth("simRefundBar", ((refundCents / poolCents) * 100).toFixed(1));
  }

  if (slider) {
    slider.addEventListener("input", updateSim);
    updateSim();
  }

  // ---------------------------------------------------------------------------
  // 5. Donation Address Copy & Interactive ETH / USDC Donation Modal
  // ---------------------------------------------------------------------------
  const DONATE_ADDRESS = "0x122900f6288b51998371ed90E2A424d63Ea9564E";
  const MAINNET_CHAIN_ID = "0x1";
  const MAINNET_USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

  const PRESETS_BY_ASSET = {
    ETH: [
      { label: "0.01 ETH", value: "0.01" },
      { label: "0.05 ETH", value: "0.05" },
      { label: "0.1 ETH", value: "0.1" },
      { label: "0.5 ETH", value: "0.5" },
    ],
    USDC: [
      { label: "10 USDC", value: "10" },
      { label: "25 USDC", value: "25" },
      { label: "50 USDC", value: "50" },
      { label: "100 USDC", value: "100" },
    ],
  };

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("Copy command failed"));
      } catch (err) {
        reject(err);
      }
    });
  }

  document.querySelectorAll("[data-copy-address]").forEach(function (btn) {
    const originalLabel = btn.textContent;
    btn.addEventListener("click", function () {
      const addr = btn.getAttribute("data-copy-address") || DONATE_ADDRESS;
      copyTextToClipboard(addr)
        .then(function () {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = originalLabel;
            btn.classList.remove("copied");
          }, 1800);
        })
        .catch(function () {
          btn.textContent = addr;
        });
    });
  });

  function parseUnitsExact(raw, decimals) {
    const cleaned = String(raw || "").trim();
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const parts = cleaned.split(".");
    const whole = parts[0];
    const frac = parts[1] || "";
    if (frac.length > decimals) return null;
    const paddedFrac = frac + "0".repeat(decimals - frac.length);
    const combined = (whole + paddedFrac).replace(/^0+/, "") || "0";
    const units = BigInt(combined);
    return units > 0n ? units : null;
  }

  function encodeErc20Transfer(recipient, amountUnits) {
    const cleanAddr = recipient.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
    const hexAmount = amountUnits.toString(16).padStart(64, "0");
    return "0xa9059cbb" + cleanAddr + hexAmount;
  }

  const modalBackdrop = document.getElementById("donateModalBackdrop");
  const closeModalBtn = document.getElementById("closeDonateModalBtn");
  const assetTabs = document.querySelectorAll("[data-donate-asset]");
  const presetsWrap = document.getElementById("donatePresets");
  const amountInput = document.getElementById("donateAmountInput");
  const walletUriLink = document.getElementById("donateWalletUriLink");
  const sendWalletBtn = document.getElementById("sendWalletDonationBtn");
  const statusMsg = document.getElementById("donateStatusMsg");

  let activeAsset = "ETH";

  function setDonateStatus(message, tone) {
    if (!statusMsg) return;
    statusMsg.textContent = message || "";
    statusMsg.className = "donate-status" + (tone ? " " + tone : "");
  }

  function refreshWalletUri() {
    if (!walletUriLink || !amountInput) return;
    const decimals = activeAsset === "ETH" ? 18 : 6;
    const units = parseUnitsExact(amountInput.value, decimals);
    if (!units) {
      walletUriLink.href = "ethereum:" + DONATE_ADDRESS + "@1";
      return;
    }
    if (activeAsset === "ETH") {
      walletUriLink.href = "ethereum:" + DONATE_ADDRESS + "@1?value=" + units.toString(10);
    } else {
      walletUriLink.href =
        "ethereum:" +
        MAINNET_USDC_ADDRESS +
        "@1/transfer?address=" +
        DONATE_ADDRESS +
        "&uint256=" +
        units.toString(10);
    }
  }

  function renderPresets() {
    if (!presetsWrap || !amountInput) return;
    const list = PRESETS_BY_ASSET[activeAsset] || PRESETS_BY_ASSET.ETH;
    presetsWrap.innerHTML = list
      .map(function (item) {
        const isActive = amountInput.value.trim() === item.value ? " active" : "";
        return (
          '<button type="button" class="donate-preset-chip' +
          isActive +
          '" data-donate-amount="' +
          item.value +
          '">' +
          item.label +
          "</button>"
        );
      })
      .join("");

    presetsWrap.querySelectorAll("[data-donate-amount]").forEach(function (chip) {
      chip.addEventListener("click", function () {
        amountInput.value = chip.getAttribute("data-donate-amount") || "";
        presetsWrap.querySelectorAll("[data-donate-amount]").forEach(function (c) {
          c.classList.toggle("active", c === chip);
        });
        setDonateStatus("", "");
        refreshWalletUri();
      });
    });
  }

  function selectDonateAsset(asset) {
    activeAsset = asset === "USDC" ? "USDC" : "ETH";
    assetTabs.forEach(function (tab) {
      const match = tab.getAttribute("data-donate-asset") === activeAsset;
      tab.classList.toggle("active", match);
      tab.setAttribute("aria-selected", match ? "true" : "false");
    });
    setText("donateAssetSymbol", activeAsset);
    setText("donateInputUnit", activeAsset);
    if (amountInput) {
      amountInput.value = activeAsset === "ETH" ? "0.01" : "25";
    }
    setDonateStatus("", "");
    renderPresets();
    refreshWalletUri();
  }

  function openDonateModal(asset) {
    if (!modalBackdrop) return;
    selectDonateAsset(asset || "ETH");
    modalBackdrop.hidden = false;
  }

  function closeDonateModal() {
    if (!modalBackdrop) return;
    modalBackdrop.hidden = true;
  }

  document.querySelectorAll("[data-open-donate]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openDonateModal(btn.getAttribute("data-open-donate") || "ETH");
    });
  });

  assetTabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      selectDonateAsset(tab.getAttribute("data-donate-asset") || "ETH");
    });
  });

  if (amountInput) {
    amountInput.addEventListener("input", function () {
      if (presetsWrap) {
        presetsWrap.querySelectorAll("[data-donate-amount]").forEach(function (c) {
          c.classList.toggle("active", c.getAttribute("data-donate-amount") === amountInput.value.trim());
        });
      }
      refreshWalletUri();
    });
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener("click", closeDonateModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", function (e) {
      if (e.target === modalBackdrop) closeDonateModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modalBackdrop && !modalBackdrop.hidden) {
      closeDonateModal();
    }
  });

  if (sendWalletBtn) {
    sendWalletBtn.addEventListener("click", async function () {
      if (!amountInput) return;
      const decimals = activeAsset === "ETH" ? 18 : 6;
      const units = parseUnitsExact(amountInput.value, decimals);
      if (!units) {
        setDonateStatus("Please enter a valid positive " + activeAsset + " amount.", "status-err");
        return;
      }

      if (!window.ethereum || typeof window.ethereum.request !== "function") {
        setDonateStatus(
          "No browser wallet detected. Copy 0x122900f6288b51998371ed90E2A424d63Ea9564E or click 'Open in Wallet App'.",
          "status-err"
        );
        return;
      }

      try {
        setDonateStatus("Connecting to your Ethereum wallet...", "");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const sender = accounts && accounts[0];
        if (!sender) {
          setDonateStatus("No wallet account authorized.", "status-err");
          return;
        }

        const currentChain = await window.ethereum.request({ method: "eth_chainId" });
        if (String(currentChain).toLowerCase() !== MAINNET_CHAIN_ID) {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: MAINNET_CHAIN_ID }],
          });
        }

        const txParams =
          activeAsset === "ETH"
            ? {
                from: sender,
                to: DONATE_ADDRESS,
                value: "0x" + units.toString(16),
              }
            : {
                from: sender,
                to: MAINNET_USDC_ADDRESS,
                value: "0x0",
                data: encodeErc20Transfer(DONATE_ADDRESS, units),
              };

        setDonateStatus("Please confirm the " + activeAsset + " donation in your wallet...", "");
        const txHash = await window.ethereum.request({
          method: "eth_sendTransaction",
          params: [txParams],
        });
        setDonateStatus("Thank you! Transaction submitted: " + txHash, "status-ok");
      } catch (err) {
        const msg = (err && err.message) ? err.message : "Transaction cancelled or failed.";
        setDonateStatus(msg, "status-err");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Non-Navigating "Launch App — Coming Soon" Feedback
  // ---------------------------------------------------------------------------
  let soonToastTimer = null;

  function showComingSoonToast() {
    let toast = document.getElementById("comingSoonToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "comingSoonToast";
      toast.className = "coming-soon-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.textContent = "Therdal App — Coming Soon";
      document.body.appendChild(toast);
    }
    requestAnimationFrame(function () {
      toast.classList.add("visible");
    });
    if (soonToastTimer) clearTimeout(soonToastTimer);
    soonToastTimer = setTimeout(function () {
      toast.classList.remove("visible");
    }, 2200);
  }

  document.querySelectorAll("[data-coming-soon]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("soon-pulse");
      setTimeout(function () {
        el.classList.remove("soon-pulse");
      }, 260);
      showComingSoonToast();
    });
  });
})();
