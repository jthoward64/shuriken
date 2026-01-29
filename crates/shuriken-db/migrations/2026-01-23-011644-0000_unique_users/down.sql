-- Remove unique constraint on email in user table
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_email_unique;

-- Remove unique constraint on (auth_source, auth_id) in auth_user table
ALTER TABLE auth_user DROP CONSTRAINT IF EXISTS auth_user_auth_source_auth_id_unique;
