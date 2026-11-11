(function () {
  "use strict";

  const DOC_ORDER = [
    { id: "overview", title: "Overview" },
    { id: "architecture", title: "System Architecture" },
    { id: "quickstart", title: "Quickstart & CLI" },
    { id: "topics", title: "Topics & Custom Options" },
    { id: "snapshots", title: "Snapshots & ETH Eligibility" },
    { id: "direct-voting", title: "Direct Snapshot Voting" },
    { id: "economics", title: "Sponsored Funds & Fee Split" },
    { id: "aggregator", title: "Run a Vote Aggregator" },
    { id: "prover", title: "Run a Batch Prover" },
    { id: "blob-format", title: "Batch & Blob Format" },
    { id: "public-inputs", title: "Proof Public Inputs" },
    { id: "security", title: "Security & Threat Model" },
  ];

  // ---------------------------------------------------------------------------
  // 0. Mermaid Dark-Mode Initialization (Renders on Visible Active Articles)
  // ---------------------------------------------------------------------------
  let mermaidInitialized = false;

  function ensureMermaidInit() {
    if (mermaidInitialized || !window.mermaid) return;
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      sequence: {
        actorMargin: 36,
        boxMargin: 10,
        messageMargin: 34,
        mirrorActors: false,
        useMaxWidth: true,
      },
      flowchart: {
        curve: "basis",
        htmlLabels: true,
        useMaxWidth: true,
      },
      themeVariables: {
        darkMode: true,
        background: "#151821",
        primaryColor: "#21314d",
        primaryTextColor: "#e6ecff",
        primaryBorderColor: "#aac7ff",
        secondaryColor: "#1b382e",
        tertiaryColor: "#19202e",
        clusterBkg: "#181e2b",
        clusterBorder: "#3b4c6b",
        edgeLabelBackground: "#141923",
        lineColor: "#8ea8d6",
        textColor: "#e2e6f0",
        actorBkg: "#1e2738",
        actorBorder: "#aac7ff",
        actorTextColor: "#ffffff",
        actorLineColor: "#6d7d9c",
        signalColor: "#d6e3ff",
        signalTextColor: "#eef3ff",
        labelBoxBkgColor: "#1d2636",
        labelBoxBorderColor: "#7dd8b6",
        labelTextColor: "#c7f5df",
        loopTextColor: "#c7f5df",
        noteBkgColor: "#1b382e",
        noteBorderColor: "#7dd8b6",
        noteTextColor: "#d6f7e8",
        activationBkgColor: "#284777",
        activationBorderColor: "#aac7ff",
        sequenceNumberColor: "#0e141f",
      },
    });
    mermaidInitialized = true;
  }

  function renderActiveMermaidDiagrams(activeArticle) {
    if (!activeArticle || !window.mermaid) return;
    ensureMermaidInit();
    const nodes = Array.prototype.slice
      .call(activeArticle.querySelectorAll("pre.mermaid"))
      .filter(function (el) {
        return !el.getAttribute("data-processed");
      });
    if (nodes.length > 0) {
      window.mermaid.run({ nodes: nodes }).catch(function () {
        // Keep readable raw Mermaid source intact if offline or blocked
      });
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Material Ripple Feedback
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
  // 2. Wrap <pre class="md-code"> with 1-Click Copy Button
  // ---------------------------------------------------------------------------
  document.querySelectorAll("pre.md-code").forEach(function (pre) {
    const wrap = document.createElement("div");
    wrap.className = "code-wrap";
    pre.parentNode.insertBefore(wrap, pre);
    wrap.appendChild(pre);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", function () {
      const text = pre.innerText || pre.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied!";
          setTimeout(function () {
            btn.textContent = "Copy";
          }, 1500);
        });
      }
    });
    wrap.appendChild(btn);
  });

  // ---------------------------------------------------------------------------
  // 3. Topic Selection & Hash Routing (Left Sidebar <-> Right Content Pane)
  // ---------------------------------------------------------------------------
  const sidebar = document.getElementById("docsSidebar");
  const menuBtn = document.getElementById("docsMenuBtn");
  const sidebarLinks = document.querySelectorAll("[data-doc-link]");
  const articles = document.querySelectorAll("[data-doc]");
  const pagination = document.getElementById("docPagination");

  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", function () {
      sidebar.classList.toggle("open");
    });
  }

  function renderPagination(currentIdx) {
    if (!pagination) return;
    const prev = currentIdx > 0 ? DOC_ORDER[currentIdx - 1] : null;
    const next = currentIdx < DOC_ORDER.length - 1 ? DOC_ORDER[currentIdx + 1] : null;

    const prevHtml = prev
      ? '<a href="#' + prev.id + '" class="page-nav-card page-nav-prev">' +
          '<span class="page-nav-dir">← Previous</span>' +
          '<span class="page-nav-title">' + prev.title + "</span>" +
        "</a>"
      : "<div></div>";

    const nextHtml = next
      ? '<a href="#' + next.id + '" class="page-nav-card page-nav-next">' +
          '<span class="page-nav-dir">Next →</span>' +
          '<span class="page-nav-title">' + next.title + "</span>" +
        "</a>"
      : "<div></div>";

    pagination.innerHTML = prevHtml + nextHtml;
  }

  function activateDoc(docId, scrollTop) {
    let idx = DOC_ORDER.findIndex(function (d) {
      return d.id === docId;
    });
    if (idx === -1) idx = 0;
    const targetId = DOC_ORDER[idx].id;

    sidebarLinks.forEach(function (link) {
      link.classList.toggle("active", link.getAttribute("data-doc-link") === targetId);
    });

    let activeArticle = null;
    articles.forEach(function (art) {
      const isMatch = art.getAttribute("data-doc") === targetId;
      art.classList.toggle("active", isMatch);
      if (isMatch) activeArticle = art;
    });

    renderActiveMermaidDiagrams(activeArticle);
    renderPagination(idx);

    if (sidebar) {
      sidebar.classList.remove("open");
    }

    if (scrollTop) {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function syncFromHash(scrollTop) {
    const raw = (window.location.hash || "").replace(/^#/, "").trim();
    activateDoc(raw || "overview", scrollTop);
  }

  window.addEventListener("hashchange", function () {
    syncFromHash(true);
  });

  syncFromHash(false);

  // ---------------------------------------------------------------------------
  // 4. Left Sidebar Live Topic Filter
  // ---------------------------------------------------------------------------
  const searchInput = document.getElementById("docsSearchInput");
  if (searchInput) {
    searchInput.addEventListener("input", function () {
      const q = searchInput.value.toLowerCase().trim();
      document.querySelectorAll(".sidebar-group").forEach(function (group) {
        let visibleInGroup = 0;
        group.querySelectorAll(".sidebar-link").forEach(function (link) {
          const match = !q || link.textContent.toLowerCase().indexOf(q) !== -1;
          link.style.display = match ? "" : "none";
          if (match) visibleInGroup++;
        });
        group.style.display = visibleInGroup > 0 ? "" : "none";
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 5. Copy Donation Address Button
  // ---------------------------------------------------------------------------
  document.querySelectorAll("[data-copy-address]").forEach(function (btn) {
    const originalText = btn.textContent;
    btn.addEventListener("click", function () {
      const addr = btn.getAttribute("data-copy-address") || "0x122900f6288b51998371ed90E2A424d63Ea9564E";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).then(function () {
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(function () {
            btn.textContent = originalText;
            btn.classList.remove("copied");
          }, 1800);
        });
      }
    });
  });
})();
