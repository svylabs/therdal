# Free Topic Creation & Estimated Market-Adaptive Vote Fee Tasks

## Feature Summary
Make creating a topic / referendum completely free (`$0` upfront deposit and `$0` protocol creation fee) and clarify that `~$0.01 / vote` is an estimate with fee parameters constantly updated to reflect market realities across the Therdal website and documentation:
1. Anyone can create a topic on Ethereum for free (`$0` protocol fee, `$0` required deposit).
2. Direct voting on Ethereum is always free (`$0` protocol fee).
3. Anyone (the topic creator or community sponsors) can optionally deposit USDC into a topic's sponsored free-voting pool (`100%` goes directly to the pool with `$0` deposit fee, with `100%` of any unused balance refunded when voting closes).
4. Per-valid-vote settlement from the sponsored pool is an **estimated `~$0.01 / vote`** (split **50% Prover · 25% Aggregator · 25% Protocol**), and **fee parameters are constantly updated to reflect market realities** (frozen per topic at creation so active pools are never repriced mid-flight).

## Architecture
- **Homepage (`website/index.html`, `website/src/material-v11.css`, & `website/src/material-v12.js`)**:
  - **Fee Card 1 (`Creating a Poll / Topic`)**: `Always Free` (`$0` deposit, `$0` protocol fee) + `Optional Sponsorship: 100% to Pool · Refundable`.
  - **Fee Cards 3 & 4 + Donut Ring + Interactive Simulator**: Show `~$0.01` (`est. / valid vote`), `~$0.0025 / vote (est.)`, `~$0.005 / vote (est.)`, and add a crisp market-pricing callout bar directly inside `#fees`: *"`$0.01 / vote` is estimated. Fee parameters are constantly updated to reflect market realities."*
- **Website Documentation Portal (`website/docs.html`)**:
  - Update `#overview`, `#quickstart`, `#topics`, `#economics`, `#circuits`, and `#security` to reflect free topic creation (`$0` deposit / `$0` creation fee), optional `100%`-to-pool sponsorship, and estimated `~$0.01 / vote` dynamic market-aligned fee parameters.
- **Markdown Specifications (`docs/economics.md`, `docs/decisions.md`, `docs/threat-model.md`, `README.md`)**:
  - Synchronize protocol economic specifications per `AGENTS.md` Rule 5.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update `#fees` cards, donut chart, interactive simulator, and market-reality fee note in `website/index.html`, `website/src/material-v11.css`, and `website/src/material-v12.js` | Complete |
| 2 | Update `website/docs.html` (`#overview`, `#quickstart`, `#topics`, `#economics`, `#circuits`, `#security`) for free topic creation, estimated `~$0.01/vote`, and market-updated fee parameters | Complete |
| 3 | Synchronize `docs/economics.md`, `docs/decisions.md`, `docs/threat-model.md`, and `README.md` with free topic creation and estimated market-updated fee parameters | Complete |
| 4 | Visually verify the updated `#fees` section on `website/index.html` and `#economics` on `website/docs.html` via headless browser screenshot | Complete |
