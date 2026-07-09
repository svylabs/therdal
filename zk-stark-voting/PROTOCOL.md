# Voting Protocol Steps and Expected Behavior

## File-Based Operations

The voting CLI operates on an election-specific folder structure. All keys, parameters, and votes are stored in files within an election's directory to simulate real-world data persistence.

### 1. `create_campaign_manager`
- **Description:** Initializes the required directory structure and automatically generates the Campaign Manager's public and private LWE keys along with the necessary parameters (`a` and `e`).
- **Inputs:**
  - `election_name`: The name of the election (used as the folder name).
- **Expected Behavior:**
  - Generates pseudo-random values for the Campaign Manager's secret, LWE parameter `a`, and LWE error term `e`.
  - Creates directory `./<election_name>`.
  - Creates directories for voters and votes.
  - Writes the secret to `./<election_name>/campaign_manager_secret.txt`.
  - Writes `cm_pub_a` and `cm_pub_b` to `./<election_name>/campaign_keys.txt`.

### 2. `create_voter`
- **Description:** Generates a secret and public key for a voter. The public key is stored in the election's voter directory to simulate registration.
- **Inputs:**
  - `election_name`: The name of the election.
  - `voter_name`: A unique identifier for the voter.
- **Expected Behavior:**
  - Generates a pseudo-random voter secret.
  - Derives a voter public key from the secret.
  - Writes the secret to `./<election_name>/voters_secrets/<voter_name>.txt`.
  - Writes the public key to `./<election_name>/voters_public_keys/<voter_name>.txt`.

### 3. `generate_merkle_root`
- **Description:** Finalizes the voter registration by reading all voter public keys and compiling them into a Merkle root.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads all voter public keys from `./<election_name>/voters_public_keys`.
  - Hashes them sequentially to simulate a Merkle tree generation.
  - Writes the computed `merkle_root` to `./<election_name>/merkle_root.txt`.

### 4. `create_election`
- **Description:** Configures the actual election by combining the Campaign Manager's public keys and the generated Merkle root into the official campaign configuration.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads `cm_pub_a` and `cm_pub_b` from `./<election_name>/campaign_keys.txt`.
  - Reads `merkle_root` from `./<election_name>/merkle_root.txt`.
  - Writes all three values to `./<election_name>/campaign.txt`.

### 5. `vote`
- **Description:** Casts a vote by homomorphically encrypting the candidate choice. It reads the voter's secret and the campaign parameters from files, and writes the resulting ciphertext to a file.
- **Inputs:**
  - `election_name`: The name of the election.
  - `voter_name`: The unique identifier for the voter.
  - `choice_idx`: The index of the chosen candidate (e.g., 0 through 9).
- **Expected Behavior:**
  - Reads the voter's secret from `./<election_name>/voters/<voter_name>.txt`.
  - Reads `cm_pub_a` and `cm_pub_b` from `./<election_name>/campaign.txt`.
  - Homomorphically encrypts the choice using the CM's public keys.
  - Writes the resulting ciphertext (`u` and `v` arrays) to `./<election_name>/votes/<voter_name>.txt`.

### 6. `tally`
- **Description:** Aggregates all submitted encrypted votes from the votes directory and decrypts the final tally using the Campaign Manager's secret key.
- **Inputs:**
  - `election_name`: The name of the election.
- **Expected Behavior:**
  - Reads the Campaign Manager's secret from `./<election_name>/campaign_manager_secret.txt`.
  - Iterates through all files in `./<election_name>/votes/`.
  - Parses each file as an LWE vector ciphertext and adds it to an aggregated ciphertext.
  - Decrypts the aggregated ciphertext using the secret.
  - Outputs the final integer tally for each candidate to the console.
