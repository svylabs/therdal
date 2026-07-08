# Voting Protocol Steps and Expected Behavior

## Operations

### 1. `generate_cm_keys`
- **Description:** Generates the LWE public and private key pair for the Campaign Manager.
- **Inputs:**
  - `cm_secret`: The secret integer for the Campaign Manager.
  - `a`: An integer element `a` for LWE generation.
  - `e`: An error integer `e` for LWE generation.
- **Expected Behavior:** Generates the public key pair `(a, b)` and outputs it. These public keys will be used by voters to homomorphically encrypt their votes. The secret key is kept hidden to decrypt the aggregated vote.

### 2. `generate_voter_keys`
- **Description:** Generates a secret value for a voter. In this prototype, this acts as the "voter's public/private key equivalent", giving them a unique secret to use when voting.
- **Inputs:** None (randomly generated) or pseudo-randomly generated from a seed.
- **Expected Behavior:** Outputs a unique voter secret integer that acts as their identity within the Merkle tree of eligible voters.

### 3. `create_campaign`
- **Description:** Initializes the campaign by registering the valid voters and the Campaign Manager's public key.
- **Inputs:**
  - `cm_pub_a`: Campaign Manager's public key element `a`.
  - `cm_pub_b`: Campaign Manager's public key element `b`.
  - `merkle_root`: The Merkle root of all valid voter secrets.
- **Expected Behavior:** Sets up the public parameters for the election. All voters will use `cm_pub_a` and `cm_pub_b` to encrypt, and their proofs will be checked against `merkle_root`. Outputs a success message containing the parameters.

### 4. `vote`
- **Description:** Casts a vote by homomorphically encrypting the candidate choice and simulating a ZK-STARK proof.
- **Inputs:**
  - `voter_secret`: The secret identifier of the voter.
  - `choice_idx`: The index of the chosen candidate (e.g., 0 through 9).
  - `cm_pub_a`: Campaign Manager's public key element `a`.
  - `cm_pub_b`: Campaign Manager's public key element `b`.
- **Expected Behavior:** The voter creates an array of choices (all zeros, except a 1 at `choice_idx`). This array is homomorphically encrypted using the CM's public keys. A STARK trace is generated (and conceptually proven). Outputs the ciphertext components `u` and `v` along with the nullifier to prevent double voting.

### 5. `tally`
- **Description:** Aggregates all submitted encrypted votes and decrypts the final tally using the Campaign Manager's secret key.
- **Inputs:**
  - `cm_secret`: The Campaign Manager's secret key.
  - `ciphertexts`: A list of comma-separated `u` and `v` arrays representing all valid submitted votes.
- **Expected Behavior:** Iteratively adds each valid ciphertext using LWE homomorphic addition. The `cm_secret` is then used to decrypt the aggregated ciphertext. Outputs the final integer tally for each candidate.
