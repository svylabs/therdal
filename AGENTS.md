# Agent Instructions

When implementing any new feature in this repository, you must follow these steps:

1. **Document the Feature:** First, clearly document the feature to be implemented.
2. **Create a Task List:** Create a markdown table listing all the tasks required to implement the feature.
3. **Iterative Execution:** Execute the tasks one by one.
4. **Track Progress:** After completing a task, you must mark it as complete by updating the markdown table before moving on to the next task.
5. **Keep Documentation Synchronized:** Whenever an implementation introduces or changes protocol specifications, smart contract interfaces, ZK circuit public inputs, blob formats, fee/economic parameters, CLI commands, or Aggregator/Prover workflows, you must update both:
   - The markdown specification files in `docs/` (e.g., `blob-format.md`, `proof-public-inputs.md`, `snapshot-and-stake.md`, `economics.md`, `decisions.md`, `threat-model.md`).
   - The corresponding topics and articles in the two-pane website documentation portal (`website/docs.html`, plus `website/src/docs-v10.js` if adding or renaming sidebar topic anchors).
   Include documentation updates as an explicit task row in your task table before considering any feature complete.

Create task file in a separate tasks directory. Also add a summary of the feature in the task file and the architecture of the feature.

## Markdown Table Format

Use the following format for tracking tasks:

| Task | Description | Status |
| --- | --- | --- |
| 1 | [Task Description] | Incomplete / Complete |
| 2 | [Task Description] | Incomplete / Complete |

## Development Specifications

Follow these engineering standards across all Rust crates, Solidity contracts, ZK circuits, SDKs, and frontend code:

1. **Keep Code Modular:**
   - Give every crate, contract, and module a single, well-defined responsibility with a minimal public API surface.
   - Avoid monolithic files and tight coupling; break large components into focused submodules and keep shared types/constants in dedicated domain modules.
2. **Produce Testable Code:**
   - Separate pure domain, state-transition, and cryptographic logic from I/O, RPC calls, filesystem access, and CLI/UI concerns so core logic can be unit-tested deterministically in isolation.
   - Pass external dependencies (storage, clocks, signers, RPC providers) via traits, interfaces, or explicit parameters rather than hardcoding globals.
3. **Write Comprehensive Tests:**
   - Accompany every feature or bug fix with automated tests covering happy paths, edge/boundary conditions, malformed inputs, and adversarial/revert scenarios.
   - Verify changes with the relevant test suites (`forge test` for Solidity contracts, `cargo test` for Rust workspace crates, and end-to-end CLI/SDK checks when cross-component flows change).
4. **Enforce Strong Types & Explicit Error Handling:**
   - Use expressive domain types and structured errors (`thiserror` in Rust library crates, `anyhow` only at binary/CLI boundaries, and custom Solidity errors instead of string reverts).
   - Never silently ignore errors or use `unwrap()` / `expect()` on fallible runtime or untrusted inputs in non-test code.
5. **Preserve Cross-Layer Determinism:**
   - Keep serialization formats, EIP-4844 blob layouts, hashes, field encodings, and proof public inputs strictly consistent across `contracts/`, `circuits/`, `prover/`, `publisher/`, `archive/`, and `sdk/`.
   - Back any encoding or public-input change with shared deterministic test vectors across layers.
6. **Practice Security-First Engineering:**
   - Treat all external inputs (blobs, signatures, proofs, RPC payloads, user parameters) as untrusted and validate invariants at system boundaries.
   - In smart contracts, adhere strictly to Checks-Effects-Interactions (CEI), pull-over-push payment patterns, explicit access control, and safe fixed-point/integer arithmetic.
7. **Maintain Clean Hygiene & Minimal Dependencies:**
   - Reuse existing workspace dependencies and standard library primitives before adding new third-party packages or crates.
   - Keep diffs focused, remove dead code, ensure builds remain warning-free, and keep comments/docstrings accurate and concise.
