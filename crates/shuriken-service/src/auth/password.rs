use argon2::{
    Argon2, PasswordHash, PasswordHasher, PasswordVerifier,
    password_hash::{SaltString, rand_core::OsRng},
};

use crate::error::{ServiceError, ServiceResult};

/// ## Summary
/// Hashes a password using Argon2id with a random salt.
///
/// ## Errors
/// Returns an error if password hashing fails.
pub fn hash_password(password: &str) -> ServiceResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| ServiceError::InvalidConfiguration(format!("Failed to hash password: {e}")))?;

    Ok(password_hash.to_string())
}

/// ## Summary
/// Verifies a password against a stored Argon2 hash.
///
/// Returns `Ok(())` if the password matches the hash, or an error otherwise.
///
/// ## Errors
/// Returns an error if password verification fails or the hash format is invalid.
pub fn verify_password(password: &str, password_hash: &str) -> ServiceResult<()> {
    let parsed_hash = PasswordHash::new(password_hash)
        .map_err(|e| ServiceError::InvalidConfiguration(format!("Invalid password hash: {e}")))?;

    let argon2 = Argon2::default();

    tracing::debug!("Verifying password ({password}) against hash ({password_hash})");

    argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|err| {
            tracing::trace!("Password verification failed: {}", err);
            ServiceError::NotAuthenticated
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let password = "test_password_123";
        let hash = hash_password(password).expect("Failed to hash password");

        // Verify correct password
        assert!(verify_password(password, &hash).is_ok());

        // Verify incorrect password
        assert!(verify_password("wrong_password", &hash).is_err());
    }

    #[test]
    fn test_hash_generates_different_salts() {
        let password = "same_password";
        let hash1 = hash_password(password).expect("Failed to hash password");
        let hash2 = hash_password(password).expect("Failed to hash password");

        // Hashes should be different due to different salts
        assert_ne!(hash1, hash2);

        // But both should verify successfully
        assert!(verify_password(password, &hash1).is_ok());
        assert!(verify_password(password, &hash2).is_ok());
    }

    #[test]
    fn test_verify_invalid_hash_format() {
        let result = verify_password("password", "not_a_valid_hash");
        assert!(result.is_err());
    }
}
