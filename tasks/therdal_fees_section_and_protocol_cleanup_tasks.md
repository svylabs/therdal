# Dedicated Fees Section & Protocol Deposit Cleanup Tasks

## Feature Summary
Separate protocol mechanics from fee economics and clearly distinguish who performs each protocol step on the Therdal main website (`website/index.html`):
1. **Explicit Actor Labels in `#protocol`**: Clearly show **who performs each step** in both the 4-step top overview bar and each of the 4 alternating step rows—**1. Topic Creator**, **2. ETH Holders (Voters)**, **3. Vote Aggregators**, **4. Batch Provers**—so readers immediately understand that voters only cast their vote and never need to bundle batches or generate proofs themselves.
2. **Remove Launch Deposit Details from `#protocol`**: Remove launch deposit details (`$100 USDC`, `$10` launch fee, `$90` vote pool) from Step 1 of `#protocol` (and fee split percentages from Step 4's SVG) so `#protocol` focuses cleanly on how the 4 steps work.
3. **Add `Fees` Header Navigation & Dedicated `#fees` Section**:
   - **Creating a Poll / Topic (`$100` USDC)**: `$10` goes to the protocol, and `$90` goes to the sponsored free-voting pool (`100%` of any unused pool refunded; optional extra sponsorships go `100%` to the pool with `$0` fee).
   - **Voting (`$0` Protocol Fee)**: Direct voting is **always free** (`$0` protocol fee), and offline voting is `$0` gas & `$0` fee for voters (covered by the sponsored pool).
   - **Submitting & Proving Vote Batches (`$0.01` per Valid Vote from Sponsored Pool)**: Show the exact fee flow and **50% Prover / 25% Batch Submitter (Aggregator) / 25% Protocol** split unlocked when a submitted vote batch is proven on Ethereum, paired with the interactive `$100` topic payout & refund simulator.

## Architecture
- **Navigation (`website/index.html`, `website/docs.html`)**: Add `Fees` (`#fees` / `./index.html#fees`) to the Material Design 3 top app bar and footer links.
- **Protocol Section (`website/index.html` `#protocol`)**: Update Step 1 SVG and copy to focus strictly on topic creation, custom choices, and Ethereum block-header snapshots (no ETH locked), and update Step 4 SVG to show the verified L1 tally rather than fee percentages.
- **Fees Section (`website/index.html` `#fees` & `website/src/material-v11.css`)**:
  - 4-step Material Design 3 fee cards covering Topic Creation (`$100`: `$10` Protocol + `$90` Sponsored Pool), Voting (Direct always free + Offline `$0` gas), Submitting Vote Batches (`$0` fee, earns `25%` when proven), and Proving Vote Batches (`$0.01`/valid vote split `50% / 25% / 25%`).
  - Visual Fee Split & Interactive `$100` Topic Simulator card demonstrating exact payouts during batch submission & proving plus unused pool refunds.
- **Documentation Sync (`website/docs.html`)**: Keep top-bar navigation aligned and ensure direct voting (`$0` protocol fee) and `$100` (`$10` protocol + `$90` sponsored pool) wording remain consistent in `#economics`.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Add explicit actor labels (`Topic Creator`, `ETH Holders`, `Vote Aggregators`, `Batch Provers`) across the 4-step top bar and step rows in `#protocol`, and remove launch deposit details from Step 1 (and fee splits from Step 4 SVG) in `website/index.html` | Complete |
| 2 | Add `Fees` navigation item in header/footer and build the dedicated `#fees` section on `website/index.html` covering poll creation (`$100`: `$10` protocol + `$90` pool), direct voting (`always free`), and the `50% / 25% / 25%` fee split during batch submission & proving | Complete |
| 3 | Style the `#fees` cards, `$10 / $90` split bar, and batch submission/proving fee-split visual in `website/src/material-v11.css` (and sync fallback CSS/JS assets) | Complete |
| 4 | Synchronize `Fees` header link and fee notes in `website/docs.html` and verify desktop layout via headless browser screenshot | Complete |
