use winter_math::{FieldElement, ToElements, fields::f128::BaseElement};
use winterfell::{
    Air, AirContext, Assertion, EvaluationFrame, ProofOptions, TraceInfo,
    TransitionConstraintDegree,
};

pub const NUM_CANDIDATES: usize = 10;
pub const TRACE_WIDTH: usize = 1 + (6 * NUM_CANDIDATES) + 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VoterPublicInputs {
    pub merkle_root: BaseElement,
    pub nullifier: BaseElement,
    pub ciphertext_u: [BaseElement; NUM_CANDIDATES],
    pub ciphertext_v: [BaseElement; NUM_CANDIDATES],
    pub public_key_a: BaseElement,
    pub public_key_b: BaseElement,
    pub delta: BaseElement,
}

impl ToElements<BaseElement> for VoterPublicInputs {
    fn to_elements(&self) -> Vec<BaseElement> {
        let mut elements = vec![
            self.merkle_root,
            self.nullifier,
            self.public_key_a,
            self.public_key_b,
            self.delta,
        ];
        elements.extend_from_slice(&self.ciphertext_u);
        elements.extend_from_slice(&self.ciphertext_v);
        elements
    }
}

pub struct VoterAir {
    context: AirContext<BaseElement>,
    pub_inputs: VoterPublicInputs,
}

impl Air for VoterAir {
    type BaseField = BaseElement;
    type PublicInputs = VoterPublicInputs;

    fn new(trace_info: TraceInfo, pub_inputs: VoterPublicInputs, options: ProofOptions) -> Self {
        let mut degrees = vec![];
        for _ in 0..TRACE_WIDTH {
            degrees.push(TransitionConstraintDegree::new(1));
        }

        let num_assertions = 1 + (2 * NUM_CANDIDATES);
        let context = AirContext::new(trace_info, degrees, num_assertions, options);
        Self {
            context,
            pub_inputs,
        }
    }

    fn context(&self) -> &AirContext<Self::BaseField> {
        &self.context
    }

    fn evaluate_transition<E: FieldElement<BaseField = Self::BaseField>>(
        &self,
        frame: &EvaluationFrame<E>,
        _periodic_values: &[E],
        result: &mut [E],
    ) {
        let current = frame.current();
        let next = frame.next();

        for i in 0..TRACE_WIDTH {
            result[i] = next[i] - current[i];
        }
    }

    fn get_assertions(&self) -> Vec<Assertion<Self::BaseField>> {
        let mut assertions = Vec::new();

        for i in 0..NUM_CANDIDATES {
            assertions.push(Assertion::single(
                41 + i,
                0,
                self.pub_inputs.ciphertext_u[i],
            ));
            assertions.push(Assertion::single(
                51 + i,
                0,
                self.pub_inputs.ciphertext_v[i],
            ));
        }
        assertions.push(Assertion::single(61, 0, self.pub_inputs.nullifier));

        assertions
    }
}
