-- ---------------------------------------------------------------------------
-- OIDC + app passwords + browser sessions.
--
-- Replaces proxy auth with OIDC for the web UI:
--   * auth_user gains `label` / `last_used_at` to describe app-password
--     credentials (authSource = 'app_password'). OIDC identities reuse the same
--     table with authSource = 'oidc' and a null auth_credential.
--   * `session` holds server-side browser sessions; the cookie carries an
--     opaque token and only its SHA-256 hash is stored here.
--   * `oidc_login` holds short-lived pending auth-code state keyed by `state`.
-- ---------------------------------------------------------------------------

ALTER TABLE "auth_user" ADD COLUMN "label" text;
--> statement-breakpoint

ALTER TABLE "auth_user" ADD COLUMN "last_used_at" timestamptz;
--> statement-breakpoint

CREATE TABLE "session" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "user_id" uuid NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
    "token_hash" text NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "expires_at" timestamptz NOT NULL,
    "last_seen_at" timestamptz DEFAULT now() NOT NULL,
    "user_agent" text,
    "ip" text
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_session_token_hash"
    ON "session" USING btree ("token_hash");
--> statement-breakpoint

CREATE INDEX "idx_session_user_id"
    ON "session" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "idx_session_expires_at"
    ON "session" USING btree ("expires_at");
--> statement-breakpoint

CREATE TABLE "oidc_login" (
    "id" uuid PRIMARY KEY DEFAULT uuidv7(),
    "state" text NOT NULL,
    "pkce_verifier" text NOT NULL,
    "nonce" text NOT NULL,
    "return_to" text NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_oidc_login_state"
    ON "oidc_login" USING btree ("state");
--> statement-breakpoint

CREATE INDEX "idx_oidc_login_expires_at"
    ON "oidc_login" USING btree ("expires_at");
