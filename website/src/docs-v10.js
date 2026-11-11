(function () {
  "use strict";

  const DOC_ORDER = [
    { id: "overview", title: "Overview" },
    { id: "quickstart", title: "Quickstart & CLI" },
    { id: "topics", title: "Topics & Custom Options" },
    { id: "snapshots", title: "Snapshots & ETH Eligibility" },
    { id: "economics", title: "Sponsored Funds & Fee Split" },
    { id: "aggregator", title: "Run a Vote Aggregator" },
    { id: "prover", title: "Run a Batch Prover" },
    { id: "blob-format", title: "Batch & Blob Format" },
    { id: "public-inputs", title: "Proof Public Inputs" },
    { id: "security", title: "Security & Threat Model" },
  ];

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

    articles.forEach(function (art) {
      art.classList.toggle("active", art.getAttribute("data-doc") === targetId);
    });

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
})();
