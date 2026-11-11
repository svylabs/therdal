# Therdal Documentation Portal — Left Topic Navigation & Right Content Pane

## Feature Summary

Transform `website/docs.html` into a **real two-pane Material Design 3 Documentation Portal** with a sticky left topic sidebar and a rich right-hand documentation reader:

1. **Left Panel (Categorized Topic Navigation + Instant Filter)**:
   - **Getting Started**: *Overview*, *Quickstart & CLI*
   - **Core Concepts**: *Topics & Custom Options*, *Snapshots & ETH Eligibility*, *Sponsored Funds & Fee Split*
   - **Operator Guides (Earn)**: *Run a Vote Aggregator*, *Run a Batch Prover*
   - **Protocol Specification**: *Batch & Blob Format*, *Proof Public Inputs*, *Security & Threat Model*
   - Includes a live topic filter input and mobile drawer toggle.

2. **Right Panel (Full Technical & Operator Content)**:
   - Displays the selected documentation topic cleanly with breadcrumbs, structured headings, specification tables, Material callouts, 1-click copyable code blocks, and **Previous / Next** topic navigation cards.
   - Supports URL hash deep-linking (`#overview`, `#quickstart`, `#topics`, `#snapshots`, `#economics`, `#aggregator`, `#prover`, `#blob-format`, `#public-inputs`, `#security`) so homepage links like `./docs.html#aggregator` and `./docs.html#prover` open directly to the exact guide.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                         website/docs.html (Docs v10)                           │
├───────────────────────────┬────────────────────────────────────────────────────┤
│  LEFT TOPIC SIDEBAR       │  RIGHT DOCUMENTATION CONTENT PANE                  │
│  [ Filter topics...     ] │  OPERATOR GUIDES · EARN                            │
│                           │  # Run a Vote Aggregator                           │
│  GETTING STARTED          │  Lead summary, architecture steps, CLI commands,   │
│  • Overview               │  Solidity & Rust integration snippets, tables,     │
│  • Quickstart & CLI       │  and callouts.                                     │
│                           │                                                    │
│  CORE CONCEPTS            │  ┌────────────────────┐  ┌────────────────────┐    │
│  • Topics & Options       │  │ ← Previous Topic   │  │ Next Topic →       │    │
│  • Snapshots & ETH Stake  │  └────────────────────┘  └────────────────────┘    │
│  • Sponsored Economics    │                                                    │
│                           │                                                    │
│  OPERATOR GUIDES (EARN)   │                                                    │
│  ● Run a Vote Aggregator  │                                                    │
│  • Run a Batch Prover     │                                                    │
│                           │                                                    │
│  PROTOCOL SPECIFICATION   │                                                    │
│  • Batch & Blob Format    │                                                    │
│  • Proof Public Inputs    │                                                    │
│  • Security & Threats     │                                                    │
└───────────────────────────┴────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rewrite `website/docs.html` as a real two-pane documentation portal with categorized left-sidebar topics and complete technical & operator articles on the right (`material-v10` cache bust, also bump `website/index.html` asset version) | Complete |
| 2 | Update `website/src/material-v10.css` (and sync fallback CSS files) with sticky left sidebar styling, prose/table/callout/code formatting, copy buttons, Prev/Next cards, and responsive mobile drawer | Complete |
| 3 | Create `website/src/docs-v10.js` for hash-routed topic switching, sidebar topic search filter, code-copy buttons, and Prev/Next navigation, then verify both `#overview` and `#aggregator` views via headless Chrome screenshots | Complete |
