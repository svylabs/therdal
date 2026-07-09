# Quantum Safe ZK-STARK Voting Protocol

This project is an experimental prototype of a quantum-safe, privacy-preserving voting protocol leveraging Zero-Knowledge STARKs (`winterfell`) and Homomorphic Encryption (Learning With Errors - LWE).

## Architecture

The protocol uses **Architecture 2 (Homomorphic Tallying)** to ensure no single entity can decrypt an individual's vote:

1. **Election Setup**
   - The Campaign Manager creates a set of LWE Public/Private keys.
   - The LWE scheme acts as a quantum-safe Additive Homomorphic Encryption scheme over the STARK prime field.
   - The Campaign Manager publishes the Merkle Root of all eligible voters.

2. **Voting**
   - Voters generate a vector of choices representing N candidates (e.g. `[1, 0, 0, ..., 0]` for Candidate 0).
   - They homomorphically encrypt this vector using the Campaign Manager's public LWE key.
   - They generate a ZK-STARK execution trace to prove:
     - They know a secret that belongs in the Merkle Root.
     - They calculated the Nullifier correctly.
     - The LWE ciphertexts correspond to valid boolean choice encryptions.
     - Only one candidate was chosen (sum of choices = 1).

3. **Tallying**
   - A smart contract or verifier accepts the ciphertexts and the STARK proof.
   - It checks the Nullifier to prevent double voting.
   - It homomorphically adds all accepted ciphertexts into an `Aggregated Ciphertext`.

4. **Decryption**
   - The Campaign Manager decrypts the `Aggregated Ciphertext` using their private key to reveal the final tally without ever seeing individual votes.

## Current Prototype Status

### What is Working:
- **Data Structures**: The `Vote` and `LweVectorCiphertext` structures are fully implemented.
- **Quantum-Safe Homomorphic Encryption**: A standard multi-dimensional Learning With Errors (LWE) cryptosystem operates correctly over $2^{64}$ wrapping integers, using dimension $n = 512$ and an Irwin-Hall discrete Gaussian approximation. Vector encryption, additive homomorphism, and decryption all function properly.
- **Nullifier Generation**: Cryptographically secure nullifiers are derived from voter secrets using Keccak256 hashes to prevent double-voting.
- **SP1 zkVM Guest Program**: The guest logic resides in standard Rust inside the `program` crate, validating Merkle paths, LWE choice vectors, and outputting public values.
- **End-to-End Simulation**: The CLI simulates the entire campaign path, generating actual inputs, running the guest validations, generating and verifying proofs, and homomorphically tallying results.

### Bypassed for Simulation:
- **SP1 Production Proofs**: To run without requiring massive native toolchain installations (like `riscv32im-succinct-zkvm-elf` compilers and CUDA runtimes), the host uses a mock SP1 SDK implementation in `sp1_sdk.rs`. The code is fully structured to swap in the official `sp1-sdk` crate.

## Tasks for a Production-Ready System

If this prototype were to move to production, the following tasks must be completed:

1. **Official SP1 SDK & Toolchain Integration**
   - *Task:* Install the official SP1 toolchain (`cargo-sp1`), compile the guest `program` to a RISC-V ELF binary, and swap the mock `ProverClient` in `main.rs` for the real `sp1-sdk` crate dependency.

2. **Migrate to Ring-LWE or Module-LWE**
   - *Task:* Replace the standard LWE implementation with a Ring-LWE (RLWE) or Module-LWE (MLWE) scheme (like Kyber or BGV/Bfv). This reduces public key sizes from $\approx 40$ KB to under a few kilobytes by using polynomial representations and optimizes vector multiplication using the Number Theoretic Transform (NTT).

3. **Distributed Key Generation (Threshold Decryption)**
   - *Task:* The Campaign Manager's secret key currently presents a single point of trust. Implement a threshold decryption scheme so that $M$ of $N$ election coordinators must collaborate to decrypt the aggregated LWE tally.

4. **Integration with Censorship-Resistant Registry**
   - *Task:* Port the Merkle Root storage and the Homomorphic Aggregation logic to a decentralized blockchain or smart contract, serving as a censorship-resistant ledger for voter registration and vote casting.

## Running the Prototype

### End-to-End Simulation
To run the original self-contained end-to-end tallying simulation without managing files:
```bash
cargo run -- simulate
```

### CLI Usage (File-Based)
The project includes a file-based CLI to simulate a real election flow.

**1. Create a Campaign Manager**
Initializes the election directories and automatically generates the Campaign Manager keys and configuration parameters.
```bash
cargo run -- create_campaign_manager <election_name>
# Example: cargo run -- create_campaign_manager usa_2024
```

**2. Register a Voter**
Generates a secret identity for a voter. This simulates generating a voter public key.
```bash
cargo run -- create_voter <election_name> <voter_name>
# Example: cargo run -- create_voter usa_2024 alice
```

**3. Generate Merkle Root**
Aggregates all the registered voters in the election directory to compute a Merkle Root.
```bash
cargo run -- generate_merkle_root <election_name>
# Example: cargo run -- generate_merkle_root usa_2024
```

**4. Create an Election**
Combines the Campaign Manager public keys and the Merkle root to officially open the election.
```bash
cargo run -- create_election <election_name>
# Example: cargo run -- create_election usa_2024
```

**5. Cast a Vote**
Homomorphically encrypts a choice (0-9) and generates a STARK proof.
```bash
cargo run -- vote <election_name> <voter_name> <choice_idx>
# Example: cargo run -- vote usa_2024 alice 5
```

**6. Tally the Votes**
Aggregates all valid votes in the election's folder and decrypts the final results using the stored Campaign Manager secret.
```bash
cargo run -- tally <election_name>
# Example: cargo run -- tally usa_2024
```

### Running Tests
To run the mathematical unit tests:
```bash
cargo test
```
