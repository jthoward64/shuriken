
-- Group table - organizational unit for users
CREATE TABLE "group" (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "group" IS 'Organizational groups for collaborative sharing of calendars and contacts';
COMMENT ON COLUMN "group".id IS 'UUID v7 primary key';

-- User table - core user identity
CREATE TABLE "user" (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    group_id UUID REFERENCES "group"(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE "user" IS 'User accounts for the CalDAV/CardDAV server';
COMMENT ON COLUMN "user".id IS 'UUID v7 primary key';
COMMENT ON COLUMN "user".name IS 'Display name of the user';
COMMENT ON COLUMN "user".email IS 'Unique email address for the user';
COMMENT ON COLUMN "user".group_id IS 'Optional group membership for shared calendar/contact access';

-- Auth user table - external authentication mappings
CREATE TABLE auth_user (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    auth_source TEXT NOT NULL,
    auth_id TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(auth_source, auth_id)
);

COMMENT ON TABLE auth_user IS 'External authentication provider mappings for users (OAuth, LDAP, etc.)';
COMMENT ON COLUMN auth_user.id IS 'UUID v7 primary key';
COMMENT ON COLUMN auth_user.user_id IS 'Reference to the user account';
COMMENT ON COLUMN auth_user.auth_source IS 'Authentication provider identifier (e.g., "google", "github", "ldap")';
COMMENT ON COLUMN auth_user.auth_id IS 'User identifier from the authentication provider';

-- Indexes for foreign keys
CREATE INDEX idx_user_group_id ON "user"(group_id);
CREATE INDEX idx_auth_user_user_id ON auth_user(user_id);
CREATE INDEX idx_auth_user_auth_source_auth_id ON auth_user(auth_source, auth_id);
