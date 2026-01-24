//! `ETag` generation functions.

use sha2::{Digest, Sha256};

/// ## Summary
/// Generates an `ETag` from canonical bytes using SHA256.
///
/// The `ETag` is the hex-encoded SHA256 hash of the content, wrapped in quotes.
#[must_use]
pub fn generate_etag(canonical_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_bytes);
    let hash = hasher.finalize();
    format!("\"{}\"", hex::encode(hash))
}
