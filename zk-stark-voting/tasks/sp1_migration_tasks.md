# SP1 zkVM Migration Tasks

## Summary
Migrate the zk-stark-voting protocol from manual STARK constraints (`winterfell`) to the SP1 zkVM, introducing high-security multi-dimensional LWE parameters (lattice dimension $n \ge 512$, discrete Gaussian noise) verified in the guest program.

## Architecture
- Delete manual constraint files `air.rs` and `prover.rs`.
- Set up a Cargo workspace containing the CLI (host) and `program` (guest).
- Implement standard LWE key generation, discrete Gaussian noise sampler, and encryption logic in `crypto.rs` using `u64` fields.
- Write the guest program to verify Merkle paths, LWE encryption, candidate validity, and nullifiers.
- Update CLI commands in `main.rs` to invoke the SP1 ProverClient.

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Create Cargo workspace structure and program/Cargo.toml | Complete |
| 2 | Refactor crypto.rs to implement standard high-security LWE | Complete |
| 3 | Remove air.rs and prover.rs | Complete |
| 4 | Implement guest program in program/src/main.rs | Complete |
| 5 | Refactor types.rs and main.rs to invoke SP1 ProverClient | Complete |
| 6 | Verify everything builds, tests pass, and simulation runs successfully | Complete |
