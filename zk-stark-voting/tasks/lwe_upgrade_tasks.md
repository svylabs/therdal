# LWE Cryptosystem Upgrade

## Summary
Upgrade the cryptographic protocol from a toy LWE implementation to a standard, mathematically correct LWE cryptosystem, renaming all references and fixing decryption/rounding logic.

## Architecture
- Rename the `ToyLWE` struct to `Lwe`.
- Update standard decryption to utilize centered representation modulo $q$ and rounding to support tallies and general parameters correctly.
- Update downstream dependencies in prover logic, CLI commands, and documentation.

## Tasks

| Task | Description | Status |
| --- | --- | --- |
| 1 | Rename ToyLWE to Lwe and refactor decryption logic in crypto.rs | Complete |
| 2 | Update imports and types in prover.rs | Complete |
| 3 | Update imports and commands in main.rs | Complete |
| 4 | Update references in PROTOCOL.md | Complete |
| 5 | Update references in README.md | Complete |
| 6 | Verify everything builds, tests pass, and simulation runs successfully | Complete |
