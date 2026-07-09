# SP1 SDK & Toolchain Integration Tasks

## Summary
Integrate the official SP1 SDK and build toolchain into the `zk-stark-voting` project, replacing the custom mock prover implementation. This allows compiling the guest program into a true RISC-V ELF binary and using the official SP1 SDK `ProverClient` to run and verify zero-knowledge proofs.

## Architecture
- **Host Crate (`zk-stark-voting`)**:
  - Adds `sp1-sdk` dependency.
  - Adds `sp1-helper` as a build dependency.
  - Configures `build.rs` to automatically build the guest program in `/program`.
  - Removes mock `voting::sp1_sdk` module reference and swaps in `sp1-sdk` imports in `src/main.rs`.
- **Guest Crate (`program`)**:
  - Automatically compiled to RISC-V ELF by the host build process using the official SP1 toolchain.

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Update Cargo.toml dependencies to include sp1-sdk and sp1-helper | Complete |
| 2 | Create build.rs to compile the guest program to RISC-V ELF | Complete |
| 3 | Replace mock sp1_sdk imports and prover logic in main.rs | Complete |
| 4 | Run build and execute simulation to verify integration | Complete |
