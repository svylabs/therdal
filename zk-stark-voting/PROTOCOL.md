# Voting Protocol Steps and Expected Behavior

## File-Based Operations

The voting CLI operates on an election-specific folder structure. All keys, parameters, and votes are stored in files within an election's directory to simulate real-world data persistence.

### 1. `create_election`
- **Description:** Initializes a new election, creating the required directory structure and generating the Campaign Manager's public and private keys, as well as storing the Merkle Root of eligible voters.
- **Inputs:**
  - `election_name`: The name of the election (used as the folder name).
  - `cm_secret`: The secret integer for the Campaign Manager.
  - `a`: An integer element `a` for LWE generation.
  - `e`: An error integer `e` for LWE generation.
  - `merkle_root`: The Merkle root of all valid voter secrets.
- **Expected Behavior:**
  - Creates directory `./<election_name>`.
  - Creates directory `./<election_name>/voters`.
  - Creates directory `./<election_name>/votes`.
  - Writes `cm_pub_a`, `cm_pub_b`, and `merkle_root` to `./<election_name>/campaign.txt`.

### 2. `create_voter`
- **Description:** Generates a secret value for a voter and stores it in the election's voter directory. In a real system, the Merkle root would be updated.
- **Inputs:**
  - `election_name`: The name of the election.
  - `voter_name`: A unique identifier for the voter.
- **Expected Behavior:**
  - Generates a pseudo-random voter secret.
  - Writes the secret to `./<election_name>/voters/<voter_name>.txt`.

### 3. `vote`
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

### 4. `tally`
- **Description:** Aggregates all submitted encrypted votes from the votes directory and decrypts the final tally using the Campaign Manager's secret key.
- **Inputs:**
  - `election_name`: The name of the election.
  - `cm_secret`: The Campaign Manager's secret key.
- **Expected Behavior:**
  - Iterates through all files in `./<election_name>/votes/`.
  - Parses each file as an LWE vector ciphertext and adds it to an aggregated ciphertext.
  - Decrypts the aggregated ciphertext using `cm_secret`.
  - Outputs the final integer tally for each candidate to the console.
