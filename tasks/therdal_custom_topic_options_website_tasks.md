# Therdal Website — Creator-Defined Options & User-Friendly Step Descriptions

## Feature Summary

Update `website/` so that:
1. **Topics Define Custom Voting Options at Creation**:
   - Replace hardcoded `Yes / No / Abstain` across the Hero Signal Card, Protocol steps, and Contribute cards with custom creator-defined choices (including topics with 3 or 4 custom options).
2. **Clear, User-Friendly Protocol Step Descriptions & Visuals**:
   - Rewrite all 4 Protocol steps (both descriptions and SVG labels) in plain, human-friendly English—eliminating internal jargon (`EIP-712`, `EIP-4844`, `KZG`, `0x01/0x02`, `Sparse Merkle Tree`, `non-sequential`) while clearly explaining *what happens* and *why it benefits ETH holders*.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                  website/index.html (Material Design 3 v8)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Hero Card:   Dynamic #heroOptionsContainer renders N custom topic options   │
│  Step 1 Row:  SVG + copy show Question + Custom Options + Pinned Snapshot    │
│  Step 2 Row:  SVG + copy show selecting from Topic-Defined Options           │
│  Contribute:  Create Topic (defines options) + Vote (picks defined option)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `website/index.html` with dynamic multi-option Hero card, plain-English user-friendly descriptions and jargon-free SVGs for all 4 Protocol steps, and aligned Contribute/Earn/About copy (`material-v8` cache bust) | Complete |
| 2 | Update `website/src/material-v8.css` and `website/src/material-v8.js` (and sync fallback CSS/JS files) to dynamically render multi-option tallies per topic | Complete |
| 3 | Verify the rendered multi-option Hero card and updated Protocol steps via headless Chrome screenshots | Complete |
| 4 | Clarify Step 1 snapshot copy & visual in `website/index.html`: topic creation records Ethereum block headers at creation so moving or buying ETH afterward has no effect on the vote | Complete |
| 5 | Clarify in `#earn` and Step 4 of `website/index.html` that USDC operator rewards are paid automatically from the topic's sponsored funds | Complete |
