# Therdal Website — Docs Header Navigation, Operator CTA Banner & Operator Documentation Page

## Feature Summary

Add **Docs** navigation and a dedicated **Operator Documentation** callout and guide explaining how to run a **Vote Aggregator** and **Prover**:

1. **Header & Footer Navigation (`website/index.html`)**:
   - Add `Docs` (`./docs.html`) to the Material Design 3 Top App Bar and Footer.
2. **Dual Closing CTA Section (`website/index.html`)**:
   - **Ready to participate?**: *Create a topic with custom options, vote offline for free, or earn by bundling and proving votes.* (`Create a Topic` + `Launch App`)
   - **Run a Vote Aggregator or Prover**: *Check the docs to learn how to host an offline voting frontend, publish vote batches, or run a prover and earn from sponsored funds.* (`Aggregator Guide` + `Prover Guide`)
3. **Dedicated Material Design 3 Operator Docs Page (`website/docs.html`)**:
   - Step-by-step guides for **Running a Vote Aggregator** (`#aggregator`) and **Running a Prover** (`#prover`), CLI & Rust SDK commands, on-chain contract calls (`publishBatch`, `authenticateSnapshot`, `settleBatch`), and protocol specification references.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     website/index.html (Material v9)                         │
│   Top Bar:  Therdal   Protocol · Contribute · Earn · About · Docs  [App ↗]   │
│   Bottom:   [Ready to participate?]  +  [Run an Aggregator or Prover → Docs] │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     website/docs.html (Operator Docs)                        │
│   1. Quickstart & End-to-End Simulation (`therdal-cli`)                      │
│   2. How to Run a Vote Aggregator (`#aggregator`) — 25% of sponsored fees    │
│   3. How to Run a Batch Prover (`#prover`) — 50% of sponsored fees           │
│   4. Protocol Specifications (`docs/*.md` reference cards)                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `website/index.html` to add `Docs` to the Top App Bar & Footer and add the **Run a Vote Aggregator or Prover** docs callout section alongside **Ready to participate?** (`material-v9` cache bust) | Complete |
| 2 | Create `website/docs.html` with Material Design 3 guides on running a Vote Aggregator (`#aggregator`), running a Prover (`#prover`), CLI commands, and protocol specification links | Complete |
| 3 | Update `website/src/material-v9.css` & `website/src/material-v9.js` (and sync fallback assets) to style the dual CTA banners and Operator Docs layout, then verify both pages via headless Chrome screenshots | Complete |
