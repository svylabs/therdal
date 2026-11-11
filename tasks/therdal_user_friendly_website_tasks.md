# Therdal User-Friendly Website — Plain-English Positioning for Creators & Voters

## Feature Summary

Redesign `website/` with **cache-proof CSS/JS delivery** and **jargon-free, human-friendly positioning** tailored to both **Referendum Creators** and **ETH Voters**, clearly explaining why Therdal exists, why it is secure, and why it is cost-optimized:

1. **Bulletproof CSS & Asset Delivery**:
   - Use fresh versioned filenames (`website/src/website-v3.css` and `website/src/website-v3.js`) plus `Cache-Control` meta headers so open browser tabs never mix cached stylesheets or scripts across updates.
   - Avoid `opacity: 0` default states in CSS so every section renders visibly out-of-the-box regardless of script caching or viewport height.

2. **Plain-English Positioning (Zero Cryptographic Jargon)**:
   - Replace internal protocol acronyms (`EL + CL`, `EIP-712`, `EIP-4844`, `SMT Root`, `Sybil-Free`, `STARK`) with clear, human language (*Wallets & staked ETH*, *Free off-chain signature*, *No bots or fake votes*, *Cryptographic proof on Ethereum*).
   - **Hero**: *"Ask Ethereum a question. Get an answer nobody can fake."* with direct paths for both **Creating a Referendum** and **Voting with ETH**.

3. **Dedicated Sections for Core Questions**:
   - **Why Therdal Exists**: Clear 4-row visual comparison against social polls, traditional off-chain polls, and standard on-chain voting.
   - **For Creators & For Voters**: Side-by-side audience cards showing exact benefits and CTAs for poll creators and ETH voters.
   - **Why It's Secure & Optimized**: 3 visual cards (*Math, Not Trust*, *One ETH, One Voice*, *100x Lower Cost via Bundling*) explaining security and optimization in everyday language.
   - **Transparent Pricing & Refund Estimator**: Interactive slider showing `$100` launch budget, `$0.01` per verified vote, and automatic unused-budget refunds.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   website/index.html (Jargon-Free v3)                      │
│          Loads ./src/website-v3.css + ./src/website-v3.js (Cache-Safe)     │
├────────────────────────────────────────────────────────────────────────────┤
│  1. Hero: "Ask Ethereum a question..." + Live Poll Preview Card            │
│  2. Why It Exists: Visual Comparison (Social / Central / On-Chain / Us)    │
│  3. Two Audiences: [For Referendum Creators]  +  [For ETH Voters]          │
│  4. Security & Optimization: Math Not Trust · No Double Votes · 100x Cheap │
│  5. Simple Pricing: Interactive Vote & Automatic Refund Slider             │
│  6. Closing CTA ──────────────────────────────► ../frontend/index.html     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rewrite `website/index.html` with plain-English copy, dedicated Creator & Voter sections, Why It Exists comparison, Security & Optimization cards, and cache-safe `website-v3` asset links | Complete |
| 2 | Create `website/src/website-v3.css` with clean, high-contrast, responsive layout (zero `opacity: 0` traps, self-contained system/web font stack, crisp cards and visuals) | Complete |
| 3 | Create `website/src/website-v3.js` for interactive referendum preview tabs and the budget/refund slider, support `#create` deep-link in `frontend/src/app.js`, and verify visually via headless Chrome screenshot | Complete |
