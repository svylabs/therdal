# Therdal Protocol Public Website & App Navigation Integration

## Feature Summary

Create a public-facing **Therdal Protocol Website** (`website/`) that explains to users what Therdal is, how it works, its cryptographic guarantees, and its v0.2 incentive model, while positioning `frontend/` as the interactive **Protocol Web Application ("Launch App")**:

1. **Clear Narrative & Protocol Overview (`website/index.html`)**:
   - Explains **what Therdal is**: an Ethereum-native, nonbinding public resolution protocol where ETH holders (both execution-layer wallets and consensus-layer validators) express ETH-weighted preferences off-chain without paying gas.
   - Highlights the **core 3-stage separation**:
     1. **Permissionless Publication**: Anyone collects EIP-712 signed votes and registers EIP-4844 blobs on Ethereum (`publishBatch`).
     2. **Permissionless Off-Chain STARK Proving**: Any prover verifies signatures, Ethereum state proofs (EIP-2935 MPT & EIP-4788 SSZ), and 256-bit Sparse Merkle Tree position uniqueness off-chain.
     3. **Atomic On-Chain Settlement**: `Therdal.sol` verifies one succinct proof (`settleBatch` in any batch order), updates tallies and counted-position roots, and splits stablecoin fees **25% Developer / 25% Submitter / 50% Prover**.
   - Explains **eligible ETH positions** (Execution balances + Beacon validator stakes via `0x01` / `0x02` withdrawal credentials, with zero double-counting) and **explicit non-goals** (nonbinding signaling, native ETH only in v1, public auditable ballots).

2. **Interactive Protocol Visualizers (`website/src/site.js` & `website/src/styles.css`)**:
   - **Interactive State-Transition & Batch Proving Inspector**: Lets visitors click through each step of what happens off-chain and on-chain when a batch is proven and settled, highlighting exact Solidity & Rust states updated (`positionRoot`, `tallies`, `countedPositions`, `acceptedVotes`, `remainingEscrow`, and ERC-20 splits).
   - **Live v0.2 Economics & Refund Calculator**: Interactive sliders for extra sponsorship, newly accepted votes, and validator claims per voter demonstrating the `$100` creation deposit (`$10` fee + `$90` escrow), `$0.01/vote` frozen pricing, 25% / 25% / 50% USDC payout bars, and pro-rata pull refunds (`floor(U * c_i / C)`).
   - **Role-by-Role Ecosystem Guide**: Tabbed walkthrough for **ETH Voters**, **Creators & Sponsors**, **Submitters / Frontends**, and **STARK Provers**.

3. **Seamless Website ↔ App (`frontend/`) Integration**:
   - Prominent **"Launch App"** CTAs throughout `website/` navigating directly to `../frontend/index.html`.
   - Topbar **"← Protocol Website"** link added to `frontend/index.html` (`../website/index.html`) and updated `frontend/package.json` / `website/package.json` + root `index.html` entrypoint so static serving works seamlessly across both Website and App.

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                         Static Web Entrypoint (Root)                          │
│                   index.html ──► redirects to ./website/                      │
└───────────────────────────────────────┬───────────────────────────────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
┌───────────────────────────────────────┐   ┌───────────────────────────────────┐
│        website/ (Public Site)         │   │      frontend/ (Protocol App)     │
│  - Hero & Live Protocol Metrics       │   │  - Persona / Wallet Switcher      │
│  - 3-Stage Architecture Diagram       │◄─►│  - Create Resolution ($100 USDC)  │
│  - Interactive Batch-Proving Stepper  │   │  - Sign EIP-712 Votes & Blobs     │
│  - Live 25/25/50 Fee & Refund Sim     │   │  - Out-of-Order STARK Settlement  │
│  - Role Tabs & Security Non-Goals     │   │  - 25/25/50 Ledger & Pull Refunds │
│  - "Launch App →" (../frontend/)      │   │  - "← Website" (../website/)      │
└───────────────────────────────────────┘   └───────────────────────────────────┘
```

---

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Create `website/index.html` with protocol hero, 3-stage architecture breakdown, ETH eligibility & security model, interactive batch-proving inspector, live v0.2 fee/refund calculator, actor tabs, and Launch App links to `frontend/` | Complete |
| 2 | Create `website/src/styles.css` and `website/src/site.js` implementing responsive dark-protocol visual design and interactive state/economics visualizers | Complete |
| 3 | Connect `frontend/` ("App") and `website/` ("Website") with bidirectional navigation, root `index.html` entrypoint, `website/package.json`, and updated `README.md`, then verify JS syntax and link integrity | Complete |
