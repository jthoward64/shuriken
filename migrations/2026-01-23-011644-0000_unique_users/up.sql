-- Add unique constraint on email in user table
ALTER TABLE "user" ADD CONSTRAINT user_email_unique UNIQUE (email);

-- Add unique constraint on (auth_source, auth_id) in auth_user table
ALTER TABLE auth_user ADD CONSTRAINT auth_user_auth_source_auth_id_unique UNIQUE (auth_source, auth_id);
