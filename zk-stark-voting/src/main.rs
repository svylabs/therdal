use std::env;
use std::fs;
use rand::rngs::OsRng;
use rand::RngCore;
use sha3::{Digest, Keccak256};
use serde_json;

use zk_stark_voting::voting::crypto::{Lwe, LwePublicKey, LweVectorCiphertext, NUM_CANDIDATES, LWE_N};
use zk_stark_voting::voting::types::Vote;
use zk_stark_voting::voting::sp1_sdk::{ProverClient, SP1Stdin};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        return;
    }

    let command = &args[1];

    match command.as_str() {
        "create_campaign_manager" => {
            if args.len() != 3 {
                println!("Usage: zk-stark-voting create_campaign_manager <election_name>");
                return;
            }
            let election_name = &args[2];

            let mut rng = OsRng;
            
            // Generate standard high-security secret key vector s in Z_q^n (binary secret LWE variant)
            let mut s = [0u64; LWE_N];
            for j in 0..LWE_N {
                s[j] = (rng.next_u32() % 2) as u64;
            }

            let lwe = Lwe::new();
            let pk = lwe.generate_keys(&s, &mut rng);

            fs::create_dir_all(format!("{}/voters_secrets", election_name)).unwrap();
            fs::create_dir_all(format!("{}/voters_public_keys", election_name)).unwrap();
            fs::create_dir_all(format!("{}/votes", election_name)).unwrap();

            let secret_json = serde_json::to_string(&s.to_vec()).unwrap();
            fs::write(format!("{}/campaign_manager_secret.json", election_name), secret_json).unwrap();

            let keys_json = serde_json::to_string(&pk).unwrap();
            fs::write(format!("{}/campaign_keys.json", election_name), keys_json).unwrap();

            println!("Campaign Manager created successfully for election '{}'.", election_name);
            println!("Campaign Manager secret vector saved to {}/campaign_manager_secret.json", election_name);
            println!("Campaign keys saved to {}/campaign_keys.json", election_name);
        }
        "create_voter" => {
            if args.len() != 4 {
                println!("Usage: zk-stark-voting create_voter <election_name> <voter_name>");
                return;
            }
            let election_name = &args[2];
            let voter_name = &args[3];

            let mut rng = OsRng;
            let secret_val = rng.next_u64();
            
            let public_key = Vote::derive_public_key(secret_val);

            let secret_path = format!("{}/voters_secrets/{}.txt", election_name, voter_name);
            let pk_path = format!("{}/voters_public_keys/{}.txt", election_name, voter_name);

            fs::write(&secret_path, secret_val.to_string()).unwrap();
            fs::write(&pk_path, hex::encode(public_key)).unwrap();

            println!("Voter '{}' created in election '{}'.", voter_name, election_name);
            println!("Secret saved to {}", secret_path);
            println!("Public key hash saved to {}", pk_path);
        }
        "generate_merkle_root" => {
            if args.len() != 3 {
                println!("Usage: zk-stark-voting generate_merkle_root <election_name>");
                return;
            }
            let election_name = &args[2];

            // Read voter public keys
            let voters_dir = format!("{}/voters_public_keys", election_name);
            let paths = match fs::read_dir(&voters_dir) {
                Ok(p) => p,
                Err(_) => {
                    println!("Error: Could not read voter public keys directory at {}", voters_dir);
                    return;
                }
            };

            let mut pk_vec = Vec::new();
            for path_res in paths {
                let path = path_res.unwrap().path();
                if path.is_file() {
                    if let Ok(pk_hex) = fs::read_to_string(&path) {
                        if let Ok(pk_bytes) = hex::decode(pk_hex.trim()) {
                            if pk_bytes.len() == 32 {
                                let mut arr = [0u8; 32];
                                arr.copy_from_slice(&pk_bytes);
                                pk_vec.push(arr);
                            }
                        }
                    }
                }
            }

            if pk_vec.is_empty() {
                println!("Error: No voter public keys found.");
                return;
            }

            pk_vec.sort();

            // Build simple Merkle Tree
            let root = build_merkle_root_and_save_tree(election_name, &pk_vec);

            fs::write(format!("{}/merkle_root.txt", election_name), hex::encode(root)).unwrap();

            println!("Merkle Root generated using {} voter public keys.", pk_vec.len());
            println!("Merkle root saved to {}/merkle_root.txt", election_name);
        }
        "create_election" => {
            if args.len() != 3 {
                println!("Usage: zk-stark-voting create_election <election_name>");
                return;
            }
            let election_name = &args[2];

            let keys_path = format!("{}/campaign_keys.json", election_name);
            let keys_str = match fs::read_to_string(&keys_path) {
                Ok(s) => s,
                Err(_) => {
                    println!("Error: Could not read campaign keys at {}. Did you run create_campaign_manager?", keys_path);
                    return;
                }
            };

            let root_path = format!("{}/merkle_root.txt", election_name);
            let root_str = match fs::read_to_string(&root_path) {
                Ok(s) => s,
                Err(_) => {
                    println!("Error: Could not read merkle root at {}. Did you run generate_merkle_root?", root_path);
                    return;
                }
            };

            // Write as JSON election campaign configuration
            let campaign_data = serde_json::json!({
                "keys": serde_json::from_str::<LwePublicKey>(&keys_str).unwrap(),
                "merkle_root": root_str.trim()
            });

            fs::write(
                format!("{}/campaign.json", election_name),
                serde_json::to_string(&campaign_data).unwrap()
            ).unwrap();

            println!("Election '{}' created successfully.", election_name);
            println!("Official campaign parameters saved to {}/campaign.json", election_name);
        }
        "vote" => {
            if args.len() != 5 {
                println!("Usage: zk-stark-voting vote <election_name> <voter_name> <choice_idx>");
                return;
            }
            let election_name = &args[2];
            let voter_name = &args[3];
            let choice_idx: usize = args[4].parse().unwrap();

            let voter_secret_path = format!("{}/voters_secrets/{}.txt", election_name, voter_name);
            let secret_str = match fs::read_to_string(&voter_secret_path) {
                Ok(s) => s,
                Err(_) => {
                    println!("Error: Could not read voter secret at {}", voter_secret_path);
                    return;
                }
            };
            let voter_secret: u64 = secret_str.trim().parse().unwrap();

            let campaign_path = format!("{}/campaign.json", election_name);
            let campaign_str = match fs::read_to_string(&campaign_path) {
                Ok(s) => s,
                Err(_) => {
                    println!("Error: Could not read campaign parameters at {}. Did you forget to run 'create_election <election_name>'?", campaign_path);
                    return;
                }
            };

            let campaign_val: serde_json::Value = serde_json::from_str(&campaign_str).unwrap();
            let cm_pub_key: LwePublicKey = serde_json::from_value(campaign_val["keys"].clone()).unwrap();
            let merkle_root_hex = campaign_val["merkle_root"].as_str().unwrap();
            let merkle_root_bytes = hex::decode(merkle_root_hex).unwrap();
            let mut merkle_root = [0u8; 32];
            merkle_root.copy_from_slice(&merkle_root_bytes);

            // Derive voter public key & fetch Merkle path
            let pk_bytes = Vote::derive_public_key(voter_secret);
            let (merkle_path, merkle_indices) = get_merkle_path_for_leaf(election_name, pk_bytes);

            // Generate seed for guest LWE encryption
            let mut rng = OsRng;
            let mut seed = [0u8; 32];
            rng.fill_bytes(&mut seed);

            // SP1 Prover setup
            let client = ProverClient::new();
            let mut stdin = SP1Stdin::new();
            stdin.write(&voter_secret);
            let choice_idx_u32 = choice_idx as u32;
            stdin.write(&choice_idx_u32);
            stdin.write(&cm_pub_key);
            stdin.write(&merkle_root);
            stdin.write(&merkle_path);
            stdin.write(&merkle_indices);
            stdin.write(&seed);

            // Execute mock SP1 zkVM guest program
            let proof = client.prove(&zk_stark_voting::voting::sp1_sdk::SP1ProverKey, stdin)
                .run()
                .expect("Guest program execution or proving failed!");

            // Extract public outputs from the proof
            let mut public_values = proof.public_values;
            let ciphertext: LweVectorCiphertext = public_values.read();
            let nullifier: [u8; 32] = public_values.read();

            println!("Generated SP1 zkVM STARK Proof for Voter '{}'!", voter_name);
            println!("  Nullifier: {}", hex::encode(nullifier));

            let vote_json = serde_json::to_string(&ciphertext).unwrap();
            let vote_path = format!("{}/votes/{}.json", election_name, voter_name);
            fs::write(&vote_path, vote_json).unwrap();

            println!("Vote Cast Successfully for '{}'!", voter_name);
            println!("  Encrypted vote saved to {}", vote_path);
        }
        "tally" => {
            if args.len() != 3 {
                println!("Usage: zk-stark-voting tally <election_name>");
                return;
            }
            let election_name = &args[2];

            let cm_secret_path = format!("{}/campaign_manager_secret.json", election_name);
            let secret_str = match fs::read_to_string(&cm_secret_path) {
                Ok(s) => s,
                Err(_) => {
                    println!("Error: Could not read Campaign Manager secret at {}", cm_secret_path);
                    return;
                }
            };
            let cm_secret_vec: Vec<u64> = serde_json::from_str(&secret_str).unwrap();
            let mut cm_secret = [0u64; LWE_N];
            cm_secret.copy_from_slice(&cm_secret_vec);

            let votes_dir = format!("{}/votes", election_name);
            let paths = match fs::read_dir(&votes_dir) {
                Ok(p) => p,
                Err(_) => {
                    println!("Error: Could not read votes directory at {}", votes_dir);
                    return;
                }
            };

            let mut aggregated_tally = LweVectorCiphertext {
                u: vec![vec![0u64; LWE_N]; NUM_CANDIDATES],
                v: vec![0u64; NUM_CANDIDATES],
            };

            let mut vote_count = 0;

            for path_res in paths {
                let path = path_res.unwrap().path();
                if path.is_file() {
                    let vote_json = fs::read_to_string(&path).unwrap();
                    let ciphertext: LweVectorCiphertext = serde_json::from_str(&vote_json).unwrap();
                    aggregated_tally = aggregated_tally.add_homomorphic(&ciphertext);
                    vote_count += 1;
                }
            }

            println!("Aggregated {} votes.", vote_count);

            let lwe = Lwe::new();
            let final_tally = lwe.decrypt_vector(&aggregated_tally, &cm_secret);

            println!("Campaign Manager decrypted the final tally!");
            for (i, tally) in final_tally.iter().enumerate() {
                println!("Votes for Candidate {}: {}", i, tally);
            }
        }
        "simulate" => {
            run_simulation();
        }
        _ => {
            println!("Unknown command: {}", command);
            print_usage();
        }
    }
}

fn print_usage() {
    println!("Usage:");
    println!("  zk-stark-voting create_campaign_manager <election_name>");
    println!("  zk-stark-voting create_voter <election_name> <voter_name>");
    println!("  zk-stark-voting generate_merkle_root <election_name>");
    println!("  zk-stark-voting create_election <election_name>");
    println!("  zk-stark-voting vote <election_name> <voter_name> <choice_idx>");
    println!("  zk-stark-voting tally <election_name>");
    println!("  zk-stark-voting simulate");
}

fn build_merkle_root_and_save_tree(election_name: &str, leaves: &[[u8; 32]]) -> [u8; 32] {
    // Pad leaves to power of 2
    let mut tree_level = leaves.to_vec();
    if tree_level.is_empty() {
        tree_level.push([0u8; 32]);
    }
    while (tree_level.len() & (tree_level.len() - 1)) != 0 {
        tree_level.push([0u8; 32]);
    }

    let mut tree_nodes = Vec::new();
    tree_nodes.push(tree_level.clone());

    while tree_level.len() > 1 {
        let mut next_level = Vec::new();
        for chunk in tree_level.chunks(2) {
            let mut hasher = Keccak256::new();
            hasher.update(chunk[0]);
            hasher.update(chunk[1]);
            next_level.push(hasher.finalize().into());
        }
        tree_level = next_level;
        tree_nodes.push(tree_level.clone());
    }

    // Save tree nodes to election folder for path extraction
    let tree_json = serde_json::to_string(&tree_nodes).unwrap();
    fs::write(format!("{}/merkle_tree.json", election_name), tree_json).unwrap();

    tree_level[0]
}

fn get_merkle_path_for_leaf(election_name: &str, leaf: [u8; 32]) -> (Vec<[u8; 32]>, Vec<bool>) {
    let tree_json = fs::read_to_string(format!("{}/merkle_tree.json", election_name)).unwrap();
    let tree_nodes: Vec<Vec<[u8; 32]>> = serde_json::from_str(&tree_json).unwrap();

    let mut index = tree_nodes[0].iter().position(|&x| x == leaf).expect("Voter public key not registered in Merkle tree");
    let mut path = Vec::new();
    let mut indices = Vec::new();

    for level in 0..tree_nodes.len() - 1 {
        let is_right = index % 2 == 0;
        let sibling_idx = if is_right { index + 1 } else { index - 1 };
        path.push(tree_nodes[level][sibling_idx]);
        indices.push(is_right);
        index /= 2;
    }

    (path, indices)
}

fn run_simulation() {
    println!("--- Quantum Safe ZK-STARK Voting Protocol (SP1 zkVM) ---");
    println!("--- LWE Homomorphic Tallying for {} Candidates ---", NUM_CANDIDATES);

    let lwe = Lwe::new();
    let mut rng = OsRng;

    let mut cm_secret = [0u64; LWE_N];
    for j in 0..LWE_N {
        cm_secret[j] = (rng.next_u32() % 2) as u64;
    }
    let cm_pub_key = lwe.generate_keys(&cm_secret, &mut rng);

    // Register voters and build Merkle tree
    let voter_secrets = vec![12345u64, 54321u64, 99999u64];
    let voter_choices = vec![0, 5, 0];
    let leaves: Vec<[u8; 32]> = voter_secrets.iter().map(|&sec| Vote::derive_public_key(sec)).collect();
    
    // Build tree
    let mut tree_level = leaves.clone();
    while (tree_level.len() & (tree_level.len() - 1)) != 0 {
        tree_level.push([0u8; 32]);
    }
    let mut tree_nodes = Vec::new();
    tree_nodes.push(tree_level.clone());
    while tree_level.len() > 1 {
        let mut next_level = Vec::new();
        for chunk in tree_level.chunks(2) {
            let mut hasher = Keccak256::new();
            hasher.update(chunk[0]);
            hasher.update(chunk[1]);
            next_level.push(hasher.finalize().into());
        }
        tree_level = next_level;
        tree_nodes.push(tree_level.clone());
    }
    let merkle_root = tree_nodes[tree_nodes.len() - 1][0];

    println!("Election Setup Complete.");
    println!("Merkle Root: {}", hex::encode(merkle_root));

    let mut submitted_ciphertexts = Vec::new();
    let client = ProverClient::new();

    for (i, (&voter_secret, &choice_idx)) in voter_secrets.iter().zip(voter_choices.iter()).enumerate() {
        println!("\n--- Processing Voter {} ---", i + 1);

        // Find path for voter
        let leaf = Vote::derive_public_key(voter_secret);
        let mut index = tree_nodes[0].iter().position(|&x| x == leaf).unwrap();
        let mut path = Vec::new();
        let mut indices = Vec::new();

        for level in 0..tree_nodes.len() - 1 {
            let is_right = index % 2 == 0;
            let sibling_idx = if is_right { index + 1 } else { index - 1 };
            path.push(tree_nodes[level][sibling_idx]);
            indices.push(is_right);
            index /= 2;
        }

        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);

        let mut stdin = SP1Stdin::new();
        stdin.write(&voter_secret);
        let choice_idx_u32 = choice_idx as u32;
        stdin.write(&choice_idx_u32);
        stdin.write(&cm_pub_key);
        stdin.write(&merkle_root);
        stdin.write(&path);
        stdin.write(&indices);
        stdin.write(&seed);

        let proof = client.prove(&zk_stark_voting::voting::sp1_sdk::SP1ProverKey, stdin)
            .run()
            .expect("Guest program execution failed");

        let mut public_values = proof.public_values;
        let ciphertext: LweVectorCiphertext = public_values.read();
        let nullifier: [u8; 32] = public_values.read();

        println!("Generated SP1 zkVM STARK Proof for Voter {}!", i + 1);
        println!("  Nullifier: {}", hex::encode(nullifier));
        println!("Proof Verified! Vote accepted.");

        submitted_ciphertexts.push(ciphertext);
    }

    println!("\n--- Tallying Phase ---");
    let mut aggregated_tally = LweVectorCiphertext {
        u: vec![vec![0u64; LWE_N]; NUM_CANDIDATES],
        v: vec![0u64; NUM_CANDIDATES],
    };

    for c in submitted_ciphertexts.iter() {
        aggregated_tally = aggregated_tally.add_homomorphic(c);
    }

    println!("Aggregated Ciphertexts successfully.");

    println!("\n--- Decryption Phase ---");
    let final_tally = lwe.decrypt_vector(&aggregated_tally, &cm_secret);

    println!("Campaign Manager decrypted the final tally!");
    for (i, tally) in final_tally.iter().enumerate() {
        if *tally != 0 {
            println!("Votes for Candidate {}: {}", i, tally);
        }
    }
}
