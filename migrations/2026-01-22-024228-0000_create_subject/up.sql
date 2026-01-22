
-- Groups table - organizational unit for users
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE groups IS 'Organizational groups for collaborative sharing of calendars and contacts';
COMMENT ON COLUMN groups.id IS 'UUID v7 primary key';

-- Users table - core user identity
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE users IS 'User accounts for the CalDAV/CardDAV server';
COMMENT ON COLUMN users.id IS 'UUID v7 primary key';
COMMENT ON COLUMN users.name IS 'Display name of the user';
COMMENT ON COLUMN users.email IS 'Unique email address for the user';
COMMENT ON COLUMN users.group_id IS 'Optional group membership for shared calendar/contact access';

-- Auth users table - external authentication mappings
CREATE TABLE auth_users (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auth_source TEXT NOT NULL,
    auth_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(auth_source, auth_id)
);

COMMENT ON TABLE auth_users IS 'External authentication provider mappings for users (OAuth, LDAP, etc.)';
COMMENT ON COLUMN auth_users.id IS 'UUID v7 primary key';
COMMENT ON COLUMN auth_users.user_id IS 'Reference to the user account';
COMMENT ON COLUMN auth_users.auth_source IS 'Authentication provider identifier (e.g., "google", "github", "ldap")';
COMMENT ON COLUMN auth_users.auth_id IS 'User identifier from the authentication provider';

-- Indexes for foreign keys
CREATE INDEX idx_users_group_id ON users(group_id);
CREATE INDEX idx_auth_users_user_id ON auth_users(user_id);
CREATE INDEX idx_auth_users_auth_source_auth_id ON auth_users(auth_source, auth_id);
