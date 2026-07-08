# Quantum Safe ZK-STARK Voting Protocol

This project is an experimental prototype of a quantum-safe, privacy-preserving voting protocol leveraging Zero-Knowledge STARKs (`winterfell`) and Homomorphic Encryption (Toy Learning With Errors - LWE).

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
- **Data Structures**: The `Vote` and `Ciphertext` structures are fully implemented.
- **Quantum-Safe Homomorphic Encryption**: A toy Learning With Errors (LWE) cryptosystem operates correctly over the STARK `BaseElement` prime field. Vector encryption, additive homomorphism, and decryption all function properly.
- **Nullifier Generation**: Simple algebraic nullifiers are generated to prevent double-voting.
- **Trace Building**: The `VoterProver` successfully builds the necessary STARK execution trace (a matrix representing the mathematical progression of the vote).
- **End-to-End Simulation**: The `main.rs` binary successfully simulates the Campaign Manager generating keys, 3 voters casting homomorphically encrypted vector votes, the verifier aggregating them, and the Campaign Manager decrypting the correct final tally.

### What is NOT Working / Bypassed:
- **Winterfell STARK Proof Generation**: The `winterfell` STARK library enforces strict rules where the algebraic degrees of transition polynomials must exactly match the constraints defined during the composer phase. Aligning the LWE vector encryption matrix perfectly inside the `evaluate_transition` logic causes a degree mismatch panic. Currently, the `evaluate_transition` logic is stubbed/bypassed, meaning the protocol simulates a valid proof but does not actually mathematically enforce zero-knowledge constraints yet.
- **Full Merkle Tree Inclusion**: The STARK trace currently simulates inclusion. Real Merkle branch hashing (via STARK-friendly hashes like Rescue or Poseidon) is incredibly complex to hand-write constraints for and is stubbed out.

## Tasks for a Production-Ready System

If this prototype were to move to production, the following tasks must be completed sequentially:

1. **Framework Pivot or Specialized zkVM implementation**
   - *Task:* Switch from manual STARK constraint writing (`winterfell`) to a zkVM framework (like SP1 or RISC Zero) or a higher-level STARK language (like Cairo). Hand-writing polynomial transitions for vectors and cryptographic hash functions is notoriously error-prone and brittle.
2. **Standardize LWE Homomorphic Encryption**
   - *Task:* Replace the `ToyLWE` with a standardized, audited, and optimized Lattice-Based Cryptography library (e.g., modified BGV or TFHE) adapted for the STARK field.
3. **Implement Full STARK-friendly Merkle Trees**
   - *Task:* Integrate a proper Sparse Merkle Tree (SMT) using a STARK-friendly hash function (Rescue-Prime or Poseidon). The STARK trace must verify the Merkle authentication path natively.
4. **Distributed Key Generation (Threshold Decryption)**
   - *Task:* The Campaign Manager's private key currently presents a single point of failure and trust. Implement a threshold-decryption scheme so that `M` of `N` election organizers must cooperate to decrypt the final aggregated LWE tally.
5. **Smart Contract Verifier**
   - *Task:* Port the Verifier and Homomorphic Aggregation logic from Rust to a Smart Contract (e.g., Solidity on Ethereum) to ensure censorship-resistant decentralized tallying.

## Running the Prototype

### End-to-End Simulation
To run the original self-contained end-to-end tallying simulation without managing files:
```bash
cargo run -- simulate
```

### CLI Usage (File-Based)
The project includes a file-based CLI to simulate a real election flow.

**1. Create a Campaign Manager**
Initializes the election directories and generates the Campaign Manager keys.
```bash
cargo run -- create_campaign_manager <election_name> <cm_secret> <a> <e>
# Example: cargo run -- create_campaign_manager usa_2024 12345 98765 3
```

**2. Register a Voter**
Generates a secret identity for a voter. This simulates generating a voter public key.
```bash
cargo run -- create_voter <election_name> <voter_name>
# Example: cargo run -- create_voter usa_2024 alice
```

**3. Generate Merkle Root**
Aggregates all the registered voters in the election directory to compute a Merkle Root, officially opening the campaign.
```bash
cargo run -- generate_merkle_root <election_name>
# Example: cargo run -- generate_merkle_root usa_2024
```

**4. Cast a Vote**
Homomorphically encrypts a choice (0-9) and generates a STARK proof.
```bash
cargo run -- vote <election_name> <voter_name> <choice_idx>
# Example: cargo run -- vote usa_2024 alice 5
```

**5. Tally the Votes**
Aggregates all valid votes in the election's folder and decrypts the final results.
```bash
cargo run -- tally <election_name> <cm_secret>
# Example: cargo run -- tally usa_2024 12345
```

### Running Tests
To run the mathematical unit tests:
```bash
cargo test
```
