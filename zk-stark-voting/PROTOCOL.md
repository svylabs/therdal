# Voting Protocol Steps and Expected Behavior

## File-Based Operations

The voting CLI operates on an election-specific folder structure. All keys, parameters, and votes are stored in files within an election's directory to simulate real-world data persistence.

### 1. `create_campaign_manager`
- **Description:** Initializes the required directory structure and automatically generates the Campaign Manager's public and private LWE keys using standard parameters.
- **Inputs:**
  - `election_name`: The name of the election (used as the folder name).
- **Security Details:** Generates a private secret vector $\mathbf{s} \in \{0, 1\}^{512}$ (binary secret LWE format) using the cryptographically secure `OsRng` generator. It derives the public key $\mathbf{A} \in \mathbb{Z}_q^{10 \times 512}$ and $\mathbf{b} \in \mathbb{Z}_q^{10}$ by adding discrete Gaussian noise approximated via the Irwin-Hall distribution.
- **Expected Behavior:**
  - Creates directory `./<election_name>`.
  - Creates subdirectories `./<election_name>/voters_secrets`, `./<election_name>/voters_public_keys`, and `./<election_name>/votes`.
  - Writes the private key vector to `./<election_name>/campaign_manager_secret.json`.
  - Writes the derived public key to `./<election_name>/campaign_keys.json`.

### 2. `create_voter`
- **Description:** Generates a secret and public key for a voter. The public key hash is stored in the election's voter directory to simulate registration.
- **Inputs:**
  - `election_name`: The name of the election.
  - `voter_name`: A unique identifier for the voter.
- **Security Note:** Voter secrets must be generated using a CSPRNG (`OsRng`) to ensure unpredictability. The public key is derived by hashing the secret using Keccak256.
- **Expected Behavior:**
  - Generates a cryptographically secure random voter secret using `OsRng`.
  - Derives a voter public key (Keccak256 hash).
  - Writes the secret to `./<election_name>/voters_secrets/<voter_name>.txt`.
  - Writes the public key hash to `./<election_name>/voters_public_keys/<voter_name>.txt`.

### 3. `generate_merkle_root`
- **Description:** Finalizes the voter registration by reading all voter public keys, building a Merkle tree, and saving it.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads all voter public keys from `./<election_name>/voters_public_keys`.
  - Sorts them and builds a Keccak256 Merkle tree (padded to a power of 2).
  - Writes the full tree structure to `./<election_name>/merkle_tree.json` (used for path extraction).
  - Writes the computed `merkle_root` to `./<election_name>/merkle_root.txt`.

### 4. `create_election`
- **Description:** Configures the actual election by combining the Campaign Manager's public keys and the generated Merkle root into the official campaign configuration.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads campaign keys from `./<election_name>/campaign_keys.json`.
  - Reads the merkle root from `./<election_name>/merkle_root.txt`.
  - Writes combined configuration JSON to `./<election_name>/campaign.json`.

### 5. `vote`
- **Description:** Casts a vote by executing the guest program in the SP1 zkVM. It reads the voter's secret and the campaign parameters, performs Merkle membership checks and LWE vector encryption, and writes the resulting ciphertext to a file.
- **Inputs:**
  - `election_name`: The name of the election.
  - `voter_name`: The unique identifier for the voter.
  - `choice_idx`: The index of the chosen candidate (e.g., 0 through 9).
- **Expected Behavior:**
  - Reads the voter's secret from `./<election_name>/voters_secrets/<voter_name>.txt`.
  - Reads campaign parameters and public keys from `./<election_name>/campaign.json`.
  - Resolves the voter's public key leaf position and retrieves the Merkle membership proof from `./<election_name>/merkle_tree.json`.
  - Prepares execution inputs and executes the guest validation code in the SP1 zkVM (verified in simulation via SP1's in-memory mock client).
  - The zkVM guest program:
    - Verifies the voter secret belongs to the Merkle Root using the membership proof.
    - Asserts candidate index boundaries.
    - Encrypts the choice vector under the CM's LWE public key using deterministic randomness.
    - Computes and commits the double-voting nullifier.
  - Writes the generated LWE vector ciphertext to `./<election_name>/votes/<voter_name>.json`.

### 6. `tally`
- **Description:** Aggregates all submitted encrypted votes from the votes directory and decrypts the final tally using the Campaign Manager's secret key.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads the Campaign Manager's secret vector from `./<election_name>/campaign_manager_secret.json`.
  - Iterates through all files in `./<election_name>/votes/`.
  - Parses each file as an LWE vector ciphertext and adds it homomorphically to the aggregated ciphertext.
  - Decrypts the aggregated ciphertext using the secret vector.
  - Outputs the final integer tally for each candidate to the console.
