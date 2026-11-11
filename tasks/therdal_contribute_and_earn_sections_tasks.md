# Therdal Website — Separate Contribute & Earn Sections

## Feature Summary

Split participation and operator economics on `website/` into two dedicated Material Design 3 sections—**Contribute** (`#contribute`) followed by **Earn** (`#earn`):

1. **Contribute (`#contribute`) — Civic & Stakeholder Participation**:
   - **Create a Topic**: Open a referendum on Ethereum and pin the snapshot block.
   - **Vote**: Cast nonbinding ETH-weighted preferences across wallets and validators—offline (gas-free) or directly.
   - **Sponsor Gas-Free Transactions**: Fund the topic's USDC pool so voters participate for `$0` gas, with 100% of unused funds refunded automatically.

2. **Earn (`#earn`) — Permissionless Operators & Per-Vote Revenue**:
   - **Aggregators** (`25% per valid vote`): Host a frontend through which voters sign votes offline, batch votes to Ethereum blobs, and earn a share of revenue whenever their votes are proven valid by a prover.
   - **Provers** (`50% per valid vote`): Prove that a batch of votes is valid and earn revenue for every valid vote settled on-chain.
   - **Visual Per-Vote Revenue Split & Earnings Simulator**: M3 ring chart (`$0.01` per valid vote → `50% Prover` · `25% Aggregator` · `25% Protocol`) plus interactive valid-votes slider showing live earnings.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                  website/index.html (Material Design 3 v7)                   │
├──────────────────────────────────────────────────────────────────────────────┤
│  Top App Bar:  Therdal     Protocol · Contribute · Earn · About  [Launch App]│
│  Hero:         THERDAL / The voice of ETH holders. + Live Signal Card        │
│  Protocol:     Interactive Architecture Flow SVG + Segmented Control         │
│  Contribute:   3 Tonal Cards (Create Topic · Vote · Sponsor Gas-Free Votes)  │
│  Earn:         2 Operator Cards (Aggregators · Provers) + Visual Fee Split   │
│  About:        Comparison Matrix + Wallet & Validator Unification Diagram    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `website/index.html` with a 4-step overview strip at the top of `#protocol` followed by 4 detailed alternating Left/Right visual step rows, 3 contributor cards in `#contribute` (Create Topic, Vote, Sponsor Gas-Free Votes), and `#earn` with Aggregator & Prover cards plus the visual revenue-split simulator (`material-v7`) | Complete |
| 2 | Create `website/src/material-v7.css` (and sync fallback CSS files) styling the 4-step top stepper, alternating Left/Right visual rows, 3-column Contribute cards, and 2-column Earn operator cards | Complete |
| 3 | Create `website/src/material-v7.js` (and sync fallback JS files) for interactive top-step smooth navigation, Hero chip switcher, and Earn revenue-split slider, then verify via headless Chrome screenshots | Complete |
