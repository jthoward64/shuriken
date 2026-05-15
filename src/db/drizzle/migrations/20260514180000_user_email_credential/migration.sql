-- ---------------------------------------------------------------------------
-- user_email_credential — per-user outbound SMTP credentials.
--
-- Password is stored in `password_encrypted` as base64 ciphertext encrypted
-- with EMAIL_CREDS_KEY (AES-GCM); `password_iv` holds the IV separately for
-- ergonomics. See src/services/email-credential/ for the cipher.
-- ---------------------------------------------------------------------------

CREATE TABLE "user_email_credential" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "from_address" text NOT NULL,
    "from_name" text,
    "host" text NOT NULL,
    "port" integer NOT NULL,
    "username" text NOT NULL,
    "password_encrypted" text NOT NULL,
    "password_iv" text NOT NULL,
    "security" text NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT user_email_credential_security_check
        CHECK (security IN ('none', 'starttls', 'tls'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_user_email_credential_user"
    ON "user_email_credential" USING btree ("user_id");
