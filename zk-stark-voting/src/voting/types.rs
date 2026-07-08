use winter_math::{FieldElement, fields::f128::BaseElement};

pub const NUM_CANDIDATES: usize = 10;

#[derive(Clone, Debug)]
pub struct Vote {
    pub voter_secret: BaseElement,
    pub choice_vector: [BaseElement; NUM_CANDIDATES],
}

impl Vote {
    pub fn new(voter_secret: BaseElement, choice_index: usize) -> Self {
        let mut choice_vector = [BaseElement::ZERO; NUM_CANDIDATES];
        if choice_index < NUM_CANDIDATES {
            choice_vector[choice_index] = BaseElement::new(1);
        }
        Self {
            voter_secret,
            choice_vector,
        }
    }

    pub fn nullifier(&self) -> BaseElement {
        let v = self.voter_secret;
        let v3 = v * v * v;
        v3 + BaseElement::new(42)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use winter_math::FieldElement;

    #[test]
    fn test_vote_creation_and_nullifier() {
        let secret = BaseElement::new(50);
        let choice = 4;
        let vote = Vote::new(secret, choice);

        assert_eq!(vote.choice_vector[4], BaseElement::new(1));
        assert_eq!(vote.choice_vector[0], BaseElement::ZERO);

        assert_eq!(vote.nullifier(), BaseElement::new(125042));
    }
}
