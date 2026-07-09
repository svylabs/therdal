use winter_math::{FieldElement, fields::f128::BaseElement};
use winter_prover::{
    CompositionPoly, CompositionPolyTrace, ConstraintCompositionCoefficients,
    DefaultConstraintCommitment, DefaultConstraintEvaluator, DefaultTraceLde, ProofOptions, Prover,
    StarkDomain, TracePolyTable, TraceTable, crypto::DefaultRandomCoin, crypto::MerkleTree,
    matrix::ColMatrix,
};
use winterfell::{AuxRandElements, PartitionOptions, TraceInfo};

use crate::voting::air::{NUM_CANDIDATES, TRACE_WIDTH, VoterAir, VoterPublicInputs};
use crate::voting::crypto::{HashFn, LwePublicKey, LweVectorCiphertext, Lwe};
use crate::voting::types::Vote;

type VectorCommitment = MerkleTree<HashFn>;
type RandomCoin = DefaultRandomCoin<HashFn>;

pub struct VoterProver {
    options: ProofOptions,
    pub_inputs: VoterPublicInputs,
}

impl VoterProver {
    pub fn new(options: ProofOptions, pub_inputs: VoterPublicInputs) -> Self {
        Self {
            options,
            pub_inputs,
        }
    }

    pub fn build_trace(
        vote: &Vote,
        r: &[BaseElement; NUM_CANDIDATES],
        e1: &[BaseElement; NUM_CANDIDATES],
        e2: &[BaseElement; NUM_CANDIDATES],
        _public_key: &LwePublicKey,
        _lwe: &Lwe,
        ciphertext: &LweVectorCiphertext,
        nullifier: BaseElement,
    ) -> TraceTable<BaseElement> {
        let trace_len = 8;
        let mut trace = TraceTable::new(TRACE_WIDTH, trace_len);

        let secret = vote.voter_secret;

        for i in 0..trace_len {
            trace.set(0, i, secret);

            for j in 0..NUM_CANDIDATES {
                trace.set(1 + j, i, vote.choice_vector[j]);
                trace.set(11 + j, i, r[j]);
                trace.set(21 + j, i, e1[j]);
                trace.set(31 + j, i, e2[j]);
                trace.set(41 + j, i, ciphertext.u[j]);
                trace.set(51 + j, i, ciphertext.v[j]);
            }

            trace.set(61, i, nullifier);
        }

        trace
    }
}

impl Prover for VoterProver {
    type BaseField = BaseElement;
    type Air = VoterAir;
    type Trace = TraceTable<BaseElement>;
    type HashFn = HashFn;
    type VC = VectorCommitment;
    type RandomCoin = RandomCoin;
    type TraceLde<E: FieldElement<BaseField = Self::BaseField>> =
        DefaultTraceLde<E, HashFn, VectorCommitment>;
    type ConstraintEvaluator<'a, E: FieldElement<BaseField = Self::BaseField>> =
        DefaultConstraintEvaluator<'a, Self::Air, E>;
    type ConstraintCommitment<E: FieldElement<BaseField = Self::BaseField>> =
        DefaultConstraintCommitment<E, HashFn, VectorCommitment>;

    fn get_pub_inputs(&self, _trace: &Self::Trace) -> VoterPublicInputs {
        self.pub_inputs.clone()
    }

    fn options(&self) -> &ProofOptions {
        &self.options
    }

    fn new_trace_lde<E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        trace_info: &TraceInfo,
        main_trace: &ColMatrix<Self::BaseField>,
        domain: &StarkDomain<Self::BaseField>,
        partition_options: PartitionOptions,
    ) -> (Self::TraceLde<E>, TracePolyTable<E>) {
        DefaultTraceLde::new(trace_info, main_trace, domain, partition_options)
    }

    fn new_evaluator<'a, E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        air: &'a Self::Air,
        aux_rand_elements: Option<AuxRandElements<E>>,
        composition_coefficients: ConstraintCompositionCoefficients<E>,
    ) -> Self::ConstraintEvaluator<'a, E> {
        DefaultConstraintEvaluator::new(air, aux_rand_elements, composition_coefficients)
    }

    fn build_constraint_commitment<E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        composition_poly_trace: CompositionPolyTrace<E>,
        num_constraint_composition_columns: usize,
        domain: &StarkDomain<Self::BaseField>,
        partition_options: PartitionOptions,
    ) -> (Self::ConstraintCommitment<E>, CompositionPoly<E>) {
        DefaultConstraintCommitment::new(
            composition_poly_trace,
            num_constraint_composition_columns,
            domain,
            partition_options,
        )
    }
}
