# Protocol Architecture Documentation & Mermaid Sequence Diagrams Tasks

## Feature Summary
Document the end-to-end **Therdal System Architecture** with detailed **Mermaid architecture and sequence diagrams** across both the repository's markdown specifications (`docs/architecture.md`) and the interactive two-pane website documentation portal (`website/docs.html`, `website/src/docs-v10.js`, `website/src/material-v11.css`).

## Architecture
- **Markdown Architecture Specification (`docs/architecture.md`)**:
  - **System Component Topology (`flowchart TB`)**: Client/SDK layer (`frontend/`, `@therdal/sdk`, `therdal-cli`), permissionless off-chain operators (`therdal-publisher`, `therdal-archive`, `therdal-prover`, `therdal-circuits`), and Ethereum L1 contracts (`Therdal.sol`, `SnapshotAuthenticator.sol`, `PositionEligibility.sol`, `StarkVerifierAdapter.sol`, `SponsorEscrow.sol`, `TherdalController.sol`).
  - **Sequence Diagram 1 (`sequenceDiagram`)**: Topic Creation, Optional USDC Sponsorship, and Lazy Snapshot Authentication (`BLOCKHASH` / EIP-2935 + EIP-4788).
  - **Sequence Diagram 2 (`sequenceDiagram`)**: Gas-Free Offline EIP-712 Voting, EIP-4844 Blob Aggregation, Out-of-Order STARK Proof Settlement, 35% Aggregator / 65% Prover Fee Split, and Pro-Rata Refunds.
  - **Sequence Diagram 3 (`sequenceDiagram`)**: Direct On-Chain Voting with EIP-1186 Execution Balance & Beacon `0x01`/`0x02` Validator SSZ Proofs.
  - **Cross-Layer Deterministic Commitments Reference**: Domain tags (`THERDAL_TOPIC_V1`, `THERDAL_WALLET`, `THERDAL_VALIDATOR`, `THERDAL_SMT_LEAF_V1`, `THERDAL_BLOB_V1`, `THERDAL_PUBLIC_INPUTS_V2`).
- **Website Two-Pane Documentation Portal (`website/docs.html`, `website/src/docs-v10.js`, `website/src/material-v11.css`)**:
  - Add a new **System Architecture** (`#architecture`) sidebar navigation link and documentation article containing the component overview, 3 Mermaid sequence diagrams, and cross-layer commitment table.
  - Configure Mermaid v11 ESM rendering with Therdal's Material Design 3 dark palette and lazy visible-pane rendering (`window.__renderActiveMermaid`) inside `activateDoc()` so diagrams render at full fidelity even when switching tabs dynamically, with graceful `<pre class="mermaid">` fallback styling offline.

## Task List

| Task | Description | Status |
| --- | --- | --- |
| 1 | Create `docs/architecture.md` documenting Therdal's layered architecture, cross-layer commitments, component topology flowchart, and 3 Mermaid sequence diagrams | Complete |
| 2 | Add the `#architecture` topic, Mermaid sequence diagrams, dark-mode diagram container styling, and tab-aware Mermaid rendering to `website/docs.html`, `website/src/docs-v10.js`, and `website/src/material-v11.css` | Complete |
| 3 | Verify Mermaid diagram syntax, tab navigation, search filtering, and live rendered SVG diagrams on `website/docs.html#architecture` via headless Chrome screenshots | Complete |
