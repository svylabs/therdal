<p align="left">
  <img src="website/assets/logo-lockup.svg" alt="Therdal — Ethereum Signaling Protocol" height="58" />
</p>

# Therdal — A Permissionless and Verifiable Stakeholder Signaling Protocol for Ethereum

**The voice of ETH holders.**

- **Permissionless**: Anyone can create referendums, sponsor participation, submit votes, or generate proofs.
- **Verifiable**: Voting eligibility, uniqueness, and results can be cryptographically verified.
- **Stakeholder signaling**: ETH holders express nonbinding preferences without claiming formal governance authority.
- **For Ethereum**: A focused identity with a clearly defined ecosystem.

Built on Ethereum with **permissionless EIP-4844 blob publication**, **non-sequential off-chain STARK batch proving**, **smart-account pricing & treasury governance (`TherdalController.sol`)**, and **25% / 25% / 50% USD stablecoin (USDC) fee splitting** with pro-rata pull refunds.

---

## Core v0.2 Architecture & Economics

1. **Smart-Account Governance & Pricing (`TherdalController.sol`)**:
   - Initially operated by a single signer (`operator`), upgradable to a DAO / Timelock (`transferOperator` or `replaceController`).
   - Acts as the initial **Protocol Developer** fee recipient and manages allowlisted USD stablecoins (**USDC** 6 decimals initially, extensible to 18-decimal `DAI`/`USDS`, `USDT`, `PYUSD`).
   - Estimated settlement price: **`~$0.01 USDC` per newly accepted valid vote** (`~$10` per `1,000` votes). Fee parameters are constantly updated to reflect market realities, while frozen per resolution at creation so later price updates never retroactively reprice prepaid escrow.

2. **Free Topic Creation (`$0` Fee) & Optional Sponsorship Escrow**:
   - Anyone can create a topic / referendum for free (`$0` upfront deposit and `$0` protocol creation fee). Direct voting is also always free (`$0` protocol fee).
   - Optional sponsorships (by the creator or community via `sponsor(resolutionId, amount)`) contribute `100%` directly to settlement escrow (`$0` deposit fee, funding `~10,000` estimated valid offline votes per `$100` sponsored).

3. **Permissionless Publication & Non-Sequential STARK Settlement**:
   - Anyone can publish EIP-4844 blobs via `publishBatch(resolutionId, blobCount)` during the `Open` window (`$0` paid upfront).
   - During `Settling`, any prover can prove and settle **any** registered, unsettled batch (`0 <= batchId < nextBatchId`) in **any order**. Malformed or spam batches never block honest batches and earn `$0`.
   - Each batch proof authenticates `newlyAcceptedVoteCount` (a voter claiming multiple validators in one signed vote counts as **1 accepted vote**, increasing ETH weight without multiplying the per-vote fee).
   - Each earned settlement fee `F = newlyAcceptedVoteCount * pricePerVote` is split:
     - **25%** Protocol Developer (`TherdalController`)
     - **25%** Blob Submitter / Frontend Operator (`batch.submitter`)
     - **50%** Successful STARK Prover (`msg.sender`)

4. **Settlement Grace Period & Pro-Rata Pull Refunds**:
   - Once all batches settle (`finalizeResolution`) or `settlementDeadline` expires (`closeSettlementAndEnableRefunds`), unused escrow `U` is frozen and contributors claim `100%` of their unused share `floor(U * c_i / C)` via `claimRefund`.

---

## Quickstart & Verification

### 1. Run Solidity Tests (Foundry)
```bash
forge test -vv
```

### 2. Run Rust Prover & Circuit Tests
```bash
cargo test --offline
```

### 3. Run the v0.2 End-to-End CLI Simulation
```bash
cargo run --offline --bin therdal-cli -- demo-e2e
```

### 4. Launch the Website & Interactive Protocol App
```bash
python3 -m http.server 4173
# Public Protocol Website: http://localhost:4173/website/  (or http://localhost:4173/)
# Interactive Protocol App: http://localhost:4173/frontend/
```
