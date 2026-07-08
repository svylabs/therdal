use winter_prover::crypto::{DefaultRandomCoin, MerkleTree};
use winterfell::{AcceptableOptions, verify};

use crate::voting::air::{VoterAir, VoterPublicInputs};
use crate::voting::crypto::HashFn;

type VectorCommitment = MerkleTree<HashFn>;
type RandomCoin = DefaultRandomCoin<HashFn>;

pub fn verify_voter_proof(
    proof: winterfell::Proof,
    pub_inputs: VoterPublicInputs,
) -> Result<(), winterfell::VerifierError> {
    let acceptable_options = AcceptableOptions::OptionSet(vec![proof.options().clone()]);

    verify::<VoterAir, HashFn, RandomCoin, VectorCommitment>(proof, pub_inputs, &acceptable_options)
}
