# Therdal Website — Material Design 3 (Dark) Visual Redesign

## Feature Summary

Redesign `website/` using **Material Design 3 (M3 Dark Theme)**—authentic M3 tonal surfaces (`surface-container-low/default/high`), stadium pill buttons (`100px` radius), `24px` tonal cards, M3 segmented buttons/chips, M3 linear progress bars, Material iconography, minimal text, rich custom SVG diagrams, and **zero** numeric/terminal prefixes (`00`, `01`, `02`, or `[ BRACKETS ]`).

### Page Structure & Sections
1. **Navigation**: Clean `Therdal` brand mark + `Protocol`, `Contribute`, `About`, and `Launch App`.
2. **Hero (Positioning + Live Visual)**:
   - Exact identity lockup:
     - `THERDAL`
     - `The voice of ETH holders.`
     - `A permissionless and verifiable stakeholder signaling protocol for Ethereum.`
   - Paired with a visual **Live Ethereum Signal Card** (interactive topic switcher showing ETH-weighted Yes / No / Abstain bars across wallets & staked validators, with zero wall-of-text clutter).
3. **Protocol (`#protocol`) — How It Works (Visual-First)**:
   - Interactive architecture SVG flow diagram illustrating:
     - **Create Topic** (Question & Ethereum snapshot pinned)
     - **Vote** (Vote gas-free via off-chain signature or vote direct; wallets + validators)
     - **Aggregate & Publish** (Aggregators bundle votes into Ethereum blobs)
     - **Prove & Settle** (Provers verify batch validity & settle on-chain tally)
4. **Contribute (`#contribute`) — Actors & Revenue Split**:
   - Visual role cards with custom SVG icons for all 4 open roles:
     - **Creators**: Create a topic & sponsor participation (`100% unspent refund`)
     - **Voters**: Vote direct or vote gas-free with wallet & validator ETH (`$0 gas option`)
     - **Aggregators**: Aggregate votes and publish batches (`25% fee share`)
     - **Provers**: Prove validity of batches (`50% fee share`)
   - Visual **Revenue Split & Topic Budget** graphic (`50% Provers` · `25% Aggregators` · `25% Protocol` + interactive settled-votes visual bar).
5. **About (`#about`) — What Therdal Is About & Why**:
   - Concise framing of nonbinding Ethereum stakeholder signaling (voice without formal governance capture) paired with a scannable visual comparison graphic (Social Polls vs. Centralized Servers vs. Binding Governance vs. Therdal) and unified Wallet + Validator ETH visual.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     website/index.html (Clean Dark v6)                     │
│             Loads ./src/clean-v6.css + ./src/clean-v6.js                   │
├────────────────────────────────────────────────────────────────────────────┤
│  Header:   Ξ Therdal          Protocol · Contribute · About   [Launch App] │
│  Hero:     THERDAL / The voice of ETH holders.  +  Live Visual Signal Card │
│  Protocol: Interactive SVG Flow (Topic → Vote → Aggregate → Prove)         │
│  Contrib:  4 Visual Actor Cards + Visual 50 / 25 / 25 Revenue Split Bar    │
│  About:    Why Nonbinding Signaling + Visual Comparison & ETH Coverage     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rewrite `website/index.html` using Material Design 3 components (Top App Bar, Stadium Buttons, Tonal Cards, Chips, Segmented Controls), clean `Protocol` / `Contribute` / `About` structure, rich custom SVG visuals, minimal copy, and `material-v6` asset links | Complete |
| 2 | Create `website/src/material-v6.css` (and sync fallback CSS files) implementing Material Design 3 dark tonal tokens (`--md-sys-color-*`), M3 type scale, stadium pills, state layers, M3 progress tracks, and M3 slider | Complete |
| 3 | Create `website/src/material-v6.js` (and sync fallback JS files) for Material ripple feedback, Hero referendum chip switcher, Protocol SVG stage selector, and Contribute revenue-split slider, then verify with headless Chrome screenshots | Complete |
