use serde::{Deserialize, Serialize};
use rand::Rng;
use sha3::{Digest, Keccak256};

pub const NUM_CANDIDATES: usize = 10;
pub const LWE_N: usize = 512; // Standard lattice dimension for high security
pub const LWE_DELTA: u64 = 1 << 48; // Scaled factor for message encoding to tolerate noise aggregation

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LweVectorCiphertext {
    pub u: Vec<Vec<u64>>, // NUM_CANDIDATES x LWE_N
    pub v: Vec<u64>,     // NUM_CANDIDATES
}

impl LweVectorCiphertext {
    pub fn add_homomorphic(&self, other: &LweVectorCiphertext) -> LweVectorCiphertext {
        let mut u_new = vec![vec![0u64; LWE_N]; NUM_CANDIDATES];
        let mut v_new = vec![0u64; NUM_CANDIDATES];
        for i in 0..NUM_CANDIDATES {
            for j in 0..LWE_N {
                u_new[i][j] = self.u[i][j].wrapping_add(other.u[i][j]);
            }
            v_new[i] = self.v[i].wrapping_add(other.v[i]);
        }
        LweVectorCiphertext { u: u_new, v: v_new }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LwePublicKey {
    pub a: Vec<Vec<u64>>, // NUM_CANDIDATES x LWE_N
    pub b: Vec<u64>,     // NUM_CANDIDATES
}

impl LwePublicKey {
    /// Computes a deterministic Keccak256 commitment over the LWE public key parameters.
    pub fn commitment(&self) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        for row in &self.a {
            for &val in row {
                hasher.update(&val.to_le_bytes());
            }
        }
        for &val in &self.b {
            hasher.update(&val.to_le_bytes());
        }
        hasher.finalize().into()
    }
}

pub struct Lwe {
    pub delta: u64,
}

impl Lwe {
    pub fn new() -> Self {
        Self {
            delta: LWE_DELTA,
        }
    }

    /// Centered Binomial Distribution (CBD) noise sampler (eta = 32).
    /// Replaces costly modulo divisions in 32-bit RISC-V zkVM with fast bitwise popcount operations.
    #[inline]
    pub fn sample_gaussian_noise<R: Rng>(rng: &mut R) -> u64 {
        let x = rng.next_u64();
        let a = (x as u32).count_ones() as i64;
        let b = ((x >> 32) as u32).count_ones() as i64;
        (a - b) as u64
    }

    pub fn generate_keys<R: Rng>(&self, s: &[u64], rng: &mut R) -> LwePublicKey {
        let mut a = vec![vec![0u64; LWE_N]; NUM_CANDIDATES];
        let mut b = vec![0u64; NUM_CANDIDATES];

        for i in 0..NUM_CANDIDATES {
            // Generate random 'a' vector
            for j in 0..LWE_N {
                a[i][j] = rng.next_u64();
            }

            // Compute b = a * s + e
            let mut a_dot_s: u64 = 0;
            for j in 0..LWE_N {
                a_dot_s = a_dot_s.wrapping_add(a[i][j].wrapping_mul(s[j]));
            }
            let e = Self::sample_gaussian_noise(rng);
            b[i] = a_dot_s.wrapping_add(e);
        }

        LwePublicKey { a, b }
    }

    pub fn encrypt_vector<R: Rng>(
        &self,
        m: &[u64; NUM_CANDIDATES],
        pk: &LwePublicKey,
        rng: &mut R,
    ) -> LweVectorCiphertext {
        let mut u = vec![vec![0u64; LWE_N]; NUM_CANDIDATES];
        let mut v = vec![0u64; NUM_CANDIDATES];
        let num_samples = pk.b.len();
        let mask_limit = (1u32 << num_samples) - 1;

        for i in 0..NUM_CANDIDATES {
            // Regev LWE subset-sum encryption:
            // Choose non-zero random binary subset vector r in {0, 1}^m
            let r_mask = (rng.next_u32() % mask_limit) + 1;
            let mut br: u64 = 0;

            for k in 0..num_samples {
                if ((r_mask >> k) & 1) == 1 {
                    let pk_a_k = &pk.a[k];
                    let u_i = &mut u[i];
                    for j in 0..LWE_N {
                        u_i[j] = u_i[j].wrapping_add(pk_a_k[j]);
                    }
                    br = br.wrapping_add(pk.b[k]);
                }
            }

            // u_i = A^T * r + e1
            let u_i = &mut u[i];
            for j in 0..LWE_N {
                let e1 = Self::sample_gaussian_noise(rng);
                u_i[j] = u_i[j].wrapping_add(e1);
            }

            // v_i = b^T * r + e2 + m_i * delta
            let e2 = Self::sample_gaussian_noise(rng);
            let message_term = m[i].wrapping_mul(self.delta);
            v[i] = br.wrapping_add(e2).wrapping_add(message_term);
        }

        LweVectorCiphertext { u, v }
    }

    pub fn decrypt_vector(
        &self,
        c: &LweVectorCiphertext,
        s: &[u64],
    ) -> [u64; NUM_CANDIDATES] {
        let mut m_vec = [0u64; NUM_CANDIDATES];
        for i in 0..NUM_CANDIDATES {
            // Decryption: noisy_m = v - u * s
            let mut u_dot_s: u64 = 0;
            for j in 0..LWE_N {
                u_dot_s = u_dot_s.wrapping_add(c.u[i][j].wrapping_mul(s[j]));
            }
            let noisy_m = c.v[i].wrapping_sub(u_dot_s);

            // Center modulo 2^64 to signed i64 representation to handle negative noise wrapping
            let val_signed = noisy_m as i64;

            // Round to nearest multiple of delta: round(val / delta)
            let delta_signed = self.delta as i64;
            let m_approx = if val_signed >= 0 {
                (val_signed + delta_signed / 2) / delta_signed
            } else {
                (val_signed - delta_signed / 2) / delta_signed
            };

            m_vec[i] = if m_approx < 0 { 0 } else { m_approx as u64 };
        }
        m_vec
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::OsRng;
    use rand::RngCore;

    #[test]
    fn test_lwe_encryption_decryption() {
        let mut rng = OsRng;
        let lwe = Lwe::new();
        
        let mut s = vec![0u64; LWE_N];
        for j in 0..LWE_N {
            s[j] = (rng.next_u32() % 2) as u64;
        }

        let pk = lwe.generate_keys(&s, &mut rng);

        let mut m = [0u64; NUM_CANDIDATES];
        m[3] = 1;

        let ciphertext = lwe.encrypt_vector(&m, &pk, &mut rng);
        let decrypted = lwe.decrypt_vector(&ciphertext, &s);

        assert_eq!(decrypted[3], 1);
        assert_eq!(decrypted[0], 0);
    }

    #[test]
    fn test_lwe_homomorphic_addition() {
        let mut rng = OsRng;
        let lwe = Lwe::new();

        let mut s = vec![0u64; LWE_N];
        for j in 0..LWE_N {
            s[j] = (rng.next_u32() % 2) as u64;
        }

        let pk = lwe.generate_keys(&s, &mut rng);

        let mut m1 = [0u64; NUM_CANDIDATES];
        m1[2] = 1;

        let mut m2 = [0u64; NUM_CANDIDATES];
        m2[2] = 1;

        let mut m3 = [0u64; NUM_CANDIDATES];
        m3[5] = 1;

        let c1 = lwe.encrypt_vector(&m1, &pk, &mut rng);
        let c2 = lwe.encrypt_vector(&m2, &pk, &mut rng);
        let c3 = lwe.encrypt_vector(&m3, &pk, &mut rng);

        let c_agg = c1.add_homomorphic(&c2).add_homomorphic(&c3);
        let decrypted_agg = lwe.decrypt_vector(&c_agg, &s);

        assert_eq!(decrypted_agg[2], 2);
        assert_eq!(decrypted_agg[5], 1);
        assert_eq!(decrypted_agg[0], 0);
    }
}
