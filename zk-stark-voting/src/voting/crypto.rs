use serde::{Deserialize, Serialize};
use rand::Rng;

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

pub struct Lwe {
    pub delta: u64,
}

impl Lwe {
    pub fn new() -> Self {
        Self {
            delta: LWE_DELTA,
        }
    }

    /// Discrete Gaussian Sampler approximation using Irwin-Hall distribution
    /// Sums 12 independent uniform samples in [-sigma, sigma] to approximate a Gaussian distribution
    pub fn sample_gaussian_noise<R: Rng>(rng: &mut R) -> u64 {
        let mut sum: i64 = 0;
        for _ in 0..12 {
            sum += (rng.next_u32() % 7) as i64 - 3; // samples in [-3, 3]
        }
        sum as u64
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

        for i in 0..NUM_CANDIDATES {
            // Encryption under LWE public key:
            // Choose small random scalar r from {0, 1}
            let r = rng.gen_range(0..2);

            // u = a * r + e1
            for j in 0..LWE_N {
                let e1 = Self::sample_gaussian_noise(rng);
                u[i][j] = pk.a[i][j].wrapping_mul(r).wrapping_add(e1);
            }

            // v = b * r + e2 + m * delta
            let e2 = Self::sample_gaussian_noise(rng);
            let br = pk.b[i].wrapping_mul(r);
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
