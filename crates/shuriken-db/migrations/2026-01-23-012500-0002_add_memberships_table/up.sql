-- Create membership table for many-to-many user-group relationship
CREATE TABLE membership (
    user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, group_id),
    PRIMARY KEY (user_id, group_id)
);

SELECT diesel_manage_updated_at('membership');

COMMENT ON TABLE membership IS 'Many-to-many relationship between users and groups';
COMMENT ON COLUMN membership.user_id IS 'Reference to the user';
COMMENT ON COLUMN membership.group_id IS 'Reference to the group';

-- Create indexes for faster lookups
CREATE INDEX idx_membership_user_id ON membership(user_id);
CREATE INDEX idx_membership_group_id ON membership(group_id);

-- Remove the group_id column from user table
ALTER TABLE "user" DROP COLUMN group_id;
