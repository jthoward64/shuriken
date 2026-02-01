-- Add auth_credential column for password hashes and other credentials
-- auth_id will now contain the username/email for basic auth, or external user ID for OIDC
-- auth_credential will contain the password hash for basic auth, or tokens for other methods
ALTER TABLE auth_user ADD COLUMN auth_credential TEXT;

COMMENT ON COLUMN auth_user.auth_credential IS 'Credential data: password hash for basic auth, tokens for OAuth, etc.';
COMMENT ON COLUMN auth_user.auth_id IS 'Authentication identifier: username/email for basic auth, external user ID for OIDC/OAuth/Proxy';
