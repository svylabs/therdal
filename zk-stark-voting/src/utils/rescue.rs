use winter_crypto::Hasher;
use winter_math::{fields::f128::BaseElement, FieldElement};
use winter_utils::{ByteReader, ByteWriter, Deserializable, DeserializationError, Serializable};
use winter_crypto::Digest;

// Port minimal Rescue implementation from winterfell examples
// (Using Blake3_256 for now since we are simplifying the Voting implementation,
// and we just need the Merkle Tree / ZK interface setup properly).

pub type Rescue128 = winter_crypto::hashers::Blake3_256<BaseElement>;
