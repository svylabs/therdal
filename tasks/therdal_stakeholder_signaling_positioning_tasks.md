# Therdal Positioning — Permissionless & Verifiable Stakeholder Signaling Protocol for Ethereum

## Feature Summary

Establish Therdal's core protocol positioning across the homepage (`website/`), root entry/metadata (`index.html`, `README.md`), and app shell (`frontend/`):

**Protocol Positioning:**
> **Therdal — A Permissionless and Verifiable Stakeholder Signaling Protocol for Ethereum**

**Four Core Differentiators:**
1. **Permissionless**: Anyone can create referendums, sponsor participation, submit votes, or generate proofs.
2. **Verifiable**: Voting eligibility, uniqueness, and results can be cryptographically verified.
3. **Stakeholder signaling**: ETH holders express nonbinding preferences without claiming formal governance authority.
4. **For Ethereum**: A focused identity with a clearly defined ecosystem.

**Homepage Hero Presentation (`website/index.html`):**
```text
THERDAL
The voice of ETH holders.
A permissionless and verifiable stakeholder signaling protocol for Ethereum.
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     website/index.html (Homepage v5)                         │
│            Loads ./src/protocol-v5.css + ./src/protocol-v4.js                │
├──────────────────────────────────────────────────────────────────────────────┤
│  00. Protocol Header:  Ξ THERDAL [v0.2]   Pillars · Mechanism · Actors · Fee │
│  01. Hero Lockup:                                                            │
│      THERDAL                                                                 │
│      The voice of ETH holders.                                               │
│      A permissionless and verifiable stakeholder signaling protocol          │
│      for Ethereum.                                                           │
│  02. 4-Column Positioning Pillars Strip:                                     │
│      [Permissionless] · [Verifiable] · [Stakeholder signaling] · [Ethereum]  │
│  03. Compact Protocol Telemetry Strip ($0 Gas · Wallets+Stakers · $0.01 · %) │
│  04. Mechanism, Actors & Incentives, and Fee Routing Schematics              │
└──────────────────────────────────────────────────────────────────────────────┘
          │                                              │
          ▼                                              ▼
   README.md & index.html                     frontend/index.html & package.json
   Unified protocol positioning               Cohesive app title & metadata
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `website/index.html` with the exact homepage hero lockup (`THERDAL` / `The voice of ETH holders.` / `A permissionless and verifiable stakeholder signaling protocol for Ethereum.`), the 4 differentiating pillars, aligned referendum/signaling copy, and cache-safe `protocol-v5.css` link | Complete |
| 2 | Create `website/src/protocol-v5.css` (and sync fallback CSS files `protocol-v4.css`, `styles.css`, `website-v3.css`) styling the 3-line hero identity lockup, 4-pillar architectural strip, and compact telemetry bar | Complete |
| 3 | Align repository positioning across `README.md`, `index.html`, `website/package.json`, `frontend/index.html`, and `frontend/package.json`, and verify rendered output | Complete |
