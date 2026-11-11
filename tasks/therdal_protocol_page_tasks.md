# Therdal Protocol Page — Architectural Layout, Actors, Actions & Incentives

## Feature Summary

Redesign `website/` into a **terse, institutional Ethereum protocol page** (removing verbose marketing paragraphs) that visually communicates:

1. **Terse Protocol Aesthetic (`protocol-v4.css`)**:
   - Deep carbon palette (`#06070a`), architectural 1px structural grid borders, monospace indices and metrics, schematic SVG diagrams, and single-line copy throughout (< 220 words across the entire page).
   - Cache-busted `protocol-v4.css?v=4` and `protocol-v4.js?v=4` (with synced fallback files) so open browser tabs always render fresh styles immediately.

2. **How It Works — Interactive 4-Stage Protocol Schematic**:
   - Architectural SVG pipeline (`01Create` → `02 Sign` → `03 Publish` → `04 Settle`) showing data and proof flow from off-chain signatures through Ethereum blobs to L1 settlement, with interactive stage inspection.

3. **Protocol Actors, Actions & Incentives Matrix**:
   - Structured protocol table/cards covering every participant (**Creator / Sponsor**, **ETH Voter**, **Blob Submitter**, **ZK Prover**, **Protocol Controller**), mapping each actor's exact **Role**, **Action**, and **Economic Incentive**.

4. **Live Incentive & Value-Routing Diagram**:
   - Visual schematic of the `$100` USDC deposit (`$10` protocol fee + `$90` escrow) with an interactive vote slider updating live payouts across **50% Prover**, **25% Submitter**, **25% Protocol**, and **Pro-Rata Unused Refund**.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   website/index.html (Protocol Page v4)                    │
├────────────────────────────────────────────────────────────────────────────┤
│  00. Top Protocol Bar:  Ξ THERDAL  [v0.2]    Mechanism · Actors · Split    │
│  01. Hero Grid: Terse Title + 4-Cell Spec Strip  (Gas · Scope · Fee · L1)  │
│  02. Mechanism: Interactive SVG Pipeline  [Fund] ─► [Sign] ─► [Blob] ─► L1 │
│  03. Actors Matrix: Actor  │  Action Taken  │  Economic Incentive          │
│  04. Value Router:  [$100] ─► $10 Protocol + $90 Escrow ─► 50/25/25/Refund │
│  05. Launch Bar ────────────────────────────────► ../frontend/index.html   │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rewrite `website/index.html` as a terse, schematic protocol page covering Mechanism, Actors/Actions/Incentives matrix, and Value-Routing diagram | Complete |
| 2 | Create `website/src/protocol-v4.css` with architectural 1px structural gridlines, carbon/monospace protocol styling, and responsive schematics | Complete |
| 3 | Create `website/src/protocol-v4.js` for interactive stage highlighting and live value-routing calculation, sync fallbacks, and verify via headless Chrome screenshot | Complete |
