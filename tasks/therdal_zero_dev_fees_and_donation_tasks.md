# Zero Developer Fees (35% Aggregators / 65% Provers) & Community Donation Support Tasks

## Feature Summary
Update the Therdal website (`website/index.html` and `website/docs.html`) and synchronized protocol documentation (`docs/`) to:
1. **Eliminate all developer / protocol fees (`0%` developer fees)**: `100%` of sponsored per-vote settlement fees go directly to permissionless operators—**35% to Vote Aggregators** and **65% to Batch Provers** (`~$0.0035` and `~$0.0065` per valid vote at the estimated `~$0.01 / vote` rate).
2. **Ask for community donations & add an interactive ETH / USDC Donation section and button at the bottom**:
   - Place a dedicated **Support Therdal / Donate** callout card at the bottom of `website/index.html` (and a compact donation card at the bottom of `website/docs.html`) asking supporters to help fund open-source protocol development, ZK circuit audits, and public infrastructure since Therdal takes `0%` developer fees.
   - Display the Ethereum donation address `0x122900f6288b51998371ed90E2A424d63Ea9564E` with one-click copy, Etherscan link, and an interactive **Donate ETH or USDC** button + modal supporting direct browser wallet transfers (ETH or Ethereum Mainnet USDC), EIP-681 wallet deep links, and quick address copy.

## Architecture
- **Homepage (`website/index.html`, `website/src/material-v11.css`, `website/src/material-v12.js`)**:
  - **`#earn` Section**: Update operator cards to `35% per Valid Vote` (`Earn 35%`) for Aggregators and `65% per Valid Vote` (`Earn 65%`) for Provers, highlighting `0%` developer fees.
  - **`#fees` Section**:
    - Update section subtitle, Aggregator batch card (`35% Share` / `~$0.0035 / vote est.`), and Prover batch card (`65% Share` / `~$0.0065 / vote est.` / `Developer Fee: $0 (0%)`).
    - Update the SVG donut chart, legend (`65% Prover`, `35% Aggregator`, `0% Developer Fee`), and interactive `$100` sponsored pool simulator (`prover = 65%`, `aggregator = 35%`, `developer = $0.00 (0%)`, plus unused refund).
  - **Bottom Donation Section (`#donate`) & Interactive Donate Modal**:
    - Add a prominent bottom card asking for **ETH** or **USDC** donations to `0x122900f6288b51998371ed90E2A424d63Ea9564E` with a **Donate ETH or USDC** button, **Copy Address** button, and footer `Donate` link.
    - Implement a clean, accessible Material Design 3 Donate dialog (`#donateModal`) in pure JS (`website/src/material-v12.js`) allowing asset selection (`ETH` or `USDC`), preset/custom amounts, browser wallet submission (`window.ethereum` on Ethereum Mainnet `0x1` with native ETH value or ERC-20 `transfer(address,uint256)` calldata), EIP-681 deep link fallback, and one-click address copy.
    - Keep legacy CSS/JS bundle mirrors in `website/src/` synchronized.
- **Website Documentation Portal (`website/docs.html`, `website/src/docs-v10.js`)**:
  - Update `#overview`, `#economics`, `#aggregator`, `#prover`, and `#security` for the `0%` developer fee and `35% Aggregator / 65% Prover` split.
  - Add a bottom community donation banner/footer on `website/docs.html` asking for ETH or USDC donations to `0x122900f6288b51998371ed90E2A424d63Ea9564E` with one-click address copy and donate action.
- **Markdown Protocol Specifications (`docs/economics.md`, `docs/decisions.md`, `docs/threat-model.md`)**:
  - Synchronize protocol economic specifications per `AGENTS.md` Rule 5 to reflect `0%` developer fees and the `35%` Aggregator / `65%` Prover split.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `#earn` and `#fees` sections (cards, SVG donut chart, legend, and interactive simulator) in `website/index.html` and `website/src/material-v12.js` for `0%` developer fees, `35%` Aggregators, and `65%` Provers | Complete |
| 2 | Add the bottom donation ask section, `Donate ETH or USDC` button, copyable `0x122900f6288b51998371ed90E2A424d63Ea9564E` address, and interactive ETH/USDC donation modal in `website/index.html`, `website/src/material-v11.css`, and `website/src/material-v12.js` | Complete |
| 3 | Synchronize `website/docs.html`, `website/src/docs-v10.js`, `docs/economics.md`, `docs/decisions.md`, and `docs/threat-model.md` with the `0%` developer fee (`35%` Aggregator / `65%` Prover) split and bottom ETH/USDC donation callout | Complete |
| 4 | Verify interactive calculator, donation button/modal, copy actions, and responsive layout across `website/index.html` and `website/docs.html` | Complete |
| 5 | Remove all explicit `0% developer fee` / `Developer Fee` labels across `website/index.html`, `website/src/material-v11.css`, `website/src/material-v12.js`, `website/docs.html`, and `docs/` so fees simply show Aggregators (35%) and Provers (65%) | Complete |
| 6 | Condense the bottom donation section into a compact one-liner with `Donate` + `Copy` actions and add `https://github.com/svylabs/therdal` GitHub repository links across `website/index.html` and `website/docs.html` | Complete |
