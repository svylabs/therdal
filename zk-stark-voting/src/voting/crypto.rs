use winter_crypto::Hasher;
use winter_crypto::hashers::Blake3_256;
use winter_math::{FieldElement, StarkField, fields::f128::BaseElement};

pub type HashFn = Blake3_256<BaseElement>;
pub type HashDigest = <HashFn as Hasher>::Digest;

pub const NUM_CANDIDATES: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LweVectorCiphertext {
    pub u: [BaseElement; NUM_CANDIDATES],
    pub v: [BaseElement; NUM_CANDIDATES],
}

impl LweVectorCiphertext {
    pub fn add_homomorphic(&self, other: &LweVectorCiphertext) -> LweVectorCiphertext {
        let mut u_new = [BaseElement::ZERO; NUM_CANDIDATES];
        let mut v_new = [BaseElement::ZERO; NUM_CANDIDATES];
        for i in 0..NUM_CANDIDATES {
            u_new[i] = self.u[i] + other.u[i];
            v_new[i] = self.v[i] + other.v[i];
        }
        LweVectorCiphertext { u: u_new, v: v_new }
    }
}

pub struct LwePublicKey {
    pub a: BaseElement,
    pub b: BaseElement,
}

pub struct ToyLWE {
    pub delta: BaseElement,
}

impl ToyLWE {
    pub fn new() -> Self {
        Self {
            delta: BaseElement::new(100_000_000_000),
        }
    }

    pub fn generate_keys(&self, s: BaseElement, a: BaseElement, e: BaseElement) -> LwePublicKey {
        let b = (a * s) + e;
        LwePublicKey { a, b }
    }

    pub fn encrypt_vector(
        &self,
        m: &[BaseElement; NUM_CANDIDATES],
        pk: &LwePublicKey,
        r: &[BaseElement; NUM_CANDIDATES],
        e1: &[BaseElement; NUM_CANDIDATES],
        e2: &[BaseElement; NUM_CANDIDATES],
    ) -> LweVectorCiphertext {
        let mut u = [BaseElement::ZERO; NUM_CANDIDATES];
        let mut v = [BaseElement::ZERO; NUM_CANDIDATES];

        for i in 0..NUM_CANDIDATES {
            u[i] = (pk.a * r[i]) + e1[i];
            v[i] = (pk.b * r[i]) + e2[i] + (m[i] * self.delta);
        }

        LweVectorCiphertext { u, v }
    }

    pub fn decrypt_vector(
        &self,
        c: &LweVectorCiphertext,
        s: BaseElement,
    ) -> [BaseElement; NUM_CANDIDATES] {
        let mut m_vec = [BaseElement::ZERO; NUM_CANDIDATES];
        for i in 0..NUM_CANDIDATES {
            let noisy_m = c.v[i] - (c.u[i] * s);

            // Because field elements wrap around Modulus when subtracting,
            // a negative error term will show up as Modulus - e.
            let modulus = BaseElement::MODULUS;
            let half_modulus = modulus / 2;

            let mut val = noisy_m.as_int();

            // If val is greater than half_modulus, it wrapped around.
            // But since m is small and positive, if val > half_modulus, it means m=0 and we subtracted error.
            if val > half_modulus {
                val = 0; // Negative error means message was 0
            }

            let delta_int = self.delta.as_int();

            let m_approx = (val + (delta_int / 2)) / delta_int;

            m_vec[i] = BaseElement::new(m_approx as u128);
        }
        m_vec
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use winter_math::FieldElement;

    #[test]
    fn test_toy_lwe_encryption_decryption() {
        let lwe = ToyLWE::new();
        let s = BaseElement::new(100);
        let a = BaseElement::new(200);
        let e = BaseElement::new(1);
        let pk = lwe.generate_keys(s, a, e);

        let m = BaseElement::new(1);
        let r = BaseElement::new(5);
        let e1 = BaseElement::new(1);
        let e2 = BaseElement::new(2);

        let mut m_vec = [BaseElement::ZERO; NUM_CANDIDATES];
        m_vec[3] = m;

        let mut r_vec = [BaseElement::ZERO; NUM_CANDIDATES];
        let mut e1_vec = [BaseElement::ZERO; NUM_CANDIDATES];
        let mut e2_vec = [BaseElement::ZERO; NUM_CANDIDATES];
        for i in 0..NUM_CANDIDATES {
            r_vec[i] = r;
            e1_vec[i] = e1;
            e2_vec[i] = e2;
        }

        let ciphertext = lwe.encrypt_vector(&m_vec, &pk, &r_vec, &e1_vec, &e2_vec);
        let decrypted = lwe.decrypt_vector(&ciphertext, s);

        assert_eq!(decrypted[3], BaseElement::new(1));
        assert_eq!(decrypted[0], BaseElement::ZERO);
    }

    #[test]
    fn test_toy_lwe_homomorphic_addition() {
        let lwe = ToyLWE::new();
        let s = BaseElement::new(123);
        let a = BaseElement::new(456);
        let pk = lwe.generate_keys(s, a, BaseElement::ZERO);

        let mut m1 = [BaseElement::ZERO; NUM_CANDIDATES];
        m1[2] = BaseElement::new(1);

        let mut m2 = [BaseElement::ZERO; NUM_CANDIDATES];
        m2[2] = BaseElement::new(1);

        let mut m3 = [BaseElement::ZERO; NUM_CANDIDATES];
        m3[5] = BaseElement::new(1);

        let r_vec = [BaseElement::new(10); NUM_CANDIDATES];
        let e_vec = [BaseElement::new(1); NUM_CANDIDATES];

        let c1 = lwe.encrypt_vector(&m1, &pk, &r_vec, &e_vec, &e_vec);
        let c2 = lwe.encrypt_vector(&m2, &pk, &r_vec, &e_vec, &e_vec);
        let c3 = lwe.encrypt_vector(&m3, &pk, &r_vec, &e_vec, &e_vec);

        let c_agg = c1.add_homomorphic(&c2).add_homomorphic(&c3);
        let decrypted_agg = lwe.decrypt_vector(&c_agg, s);

        assert_eq!(decrypted_agg[2], BaseElement::new(2));
        assert_eq!(decrypted_agg[5], BaseElement::new(1));
        assert_eq!(decrypted_agg[0], BaseElement::ZERO);
    }
}
