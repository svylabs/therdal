# Voting Logic Fixes & zkVM Optimization Tasks

## Summary
Fix cryptographic and protocol vulnerabilities in the LWE voting and SP1 zkVM proof pipeline, and optimize both guest execution and host proving so `cargo run -- simulate` and `vote` run quickly and securely.

## Architecture
- **LWE Cryptosystem (`src/voting/crypto.rs`)**:
  - Replace the single-bit $r \in \{0, 1\}$ scalar encryption (which leaked plaintext votes) with multi-sample subset-sum LWE encryption over all public key samples.
  - Replace the 12-iteration `% 7` division loop in `sample_gaussian_noise` with a bitwise Centered Binomial Distribution (CBD) sampler using `count_ones()`, eliminating 60,000+ integer divisions per encrypted vote inside the 32-bit RISC-V zkVM.
- **SP1 Guest Program (`program/src/main.rs`)**:
  - Replace the 64-bit truncated LCG (`SeededRng`) with a full 256-bit `Xoshiro256StarStar` PRNG seeded from all 32 bytes of randomness.
  - Commit the LWE public key hash alongside `ciphertext`, `nullifier`, and `merkle_root` so proofs are cryptographically bound to the election's public key.
- **Host CLI & Simulation (`src/main.rs` & `Cargo.toml`)**:
  - Sort Merkle tree leaves consistently in `run_simulation` to match `generate_merkle_root`.
  - Verify SP1 proofs, check committed public values (`merkle_root` and `pk_hash`), and enforce nullifier uniqueness to prevent double voting during simulation and tallying.
  - Default `SP1_PROVER` to `mock` when unset (as specified in `PROTOCOL.md`) and enable `opt-level = 3` for dependencies in dev profile so `cargo run -- simulate` executes quickly without hanging.

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Optimize LWE noise sampling (CBD) and fix subset-sum encryption security in `src/voting/crypto.rs` | Complete |
| 2 | Upgrade guest PRNG to 256-bit Xoshiro256** and commit public key hash in `program/src/main.rs` | Complete |
| 3 | Add proof verification, nullifier deduplication, leaf sorting, and prover configuration in `src/main.rs` & `Cargo.toml` | Complete |
| 4 | Run unit tests and `cargo run -- simulate` to verify correctness and performance | Complete |
