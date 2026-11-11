# Therdal Website Redesign — Sharp Positioning & Visual-First Design

## Feature Summary

Redesign `website/` from a text-heavy technical explainer into a **high-craft, visual-first protocol landing page** with sharp category positioning and minimal, scannable copy:

1. **Sharp Category Positioning**:
   - **Core Positioning**: *"The verifiable referendum layer for Ethereum."* — Measure real ETH-weighted conviction across wallets and validators, with **$0 voter gas** and **100% on-chain proof**.
   - **Instant Contrast**: Scannable visual comparison positioning Therdal against noisy social polls, centralized off-chain snapshots, and high-gas on-chain voting.
   - **Drastically Reduced Copy**: Replace multi-sentence technical paragraphs, code-symbol tables, and bullet walls with punchy 8–15 word statements, bespoke SVG diagrams, and visual metrics.

2. **Visual-First Bento & Flow Architecture (`website/index.html`, `website/src/styles.css`)**:
   - **Editorial Hero**: Bold display headline, concise one-sentence positioning hook, dual CTAs (`Launch App` + `How It Works`), and an interactive live **Referendum Signal Card** (toggle between live Ethereum questions to watch real-time ETH-weighted tallies & ZK verification badges).
   - **Positioning Bento Grid (3 Visual Cards)**:
     1. *Every ETH Counts* (Wallets + Staked Validators graphic).
     2. *Cold Keys Stay Safe* ($0 gas off-chain signature graphic).
     3. *Don't Trust Servers* (EIP-4844 Blob + STARK proof graphic).
   - **Visual 3-Step Flow**: Clean horizontal graphic (`Sign` → `Batch` → `Prove`) with interactive hover/click visual states instead of dense text lists.
   - **Minimal Interactive Economics Card**: Single sleek slider ("Votes Settled") visually animating the `$100` launch deposit, **25% Protocol / 25% Submitter / 50% Prover** split bar, and automatic unspent refund—no clutter.

3. **Polish & Micro-Interactions (`website/src/site.js`)**:
   - Live hero referendum switcher, interactive 3-step visual diagram state, single-slider visual economics bar, subtle scroll-reveal transitions, and seamless navigation into `frontend/` ("Launch App").

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     website/ (Visual-First Redesign)                    │
├─────────────────────────────────────────────────────────────────────────┤
│  1. Sticky Minimal Glass Nav: Brand  ·  Why  ·  Flow  ·  Model  [App →] │
│  2. Hero Split: Sharp Positioning Headline  +  Live Interactive Poll UI │
│  3. Positioning Matrix: Polls vs. Snapshots vs. On-Chain vs. Therdal    │
│  4. Bento Trio (SVG Visuals): Wallets+Stakers · $0 Gas · STARK Verified │
│  5. Visual 3-Step Flow: [1. Sign] ───► [2. Blob] ───► [3. Prove]        │
│  6. Single-Slider Alignment Card: $0.01/vote · 25/25/50 · Auto-Refund   │
│  7. High-Contrast Closing CTA ──────────────────────► ../frontend/      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rewrite `website/index.html` with sharp category positioning, minimal scannable copy, custom SVG visuals, positioning matrix, bento cards, and sleek single-slider alignment model | Complete |
| 2 | Redesign `website/src/styles.css` with editorial typography, generous whitespace, obsidian-and-light-beam aesthetic, bento visual cards, and responsive polish | Complete |
| 3 | Update `website/src/site.js` for the live hero referendum switcher, visual flow selector, single-slider fee/refund visualizer, and scroll-reveal animations, then verify syntax and DOM integrity | Complete |
