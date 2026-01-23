-- Create group_name table for group names and aliases
CREATE TABLE group_name (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    group_id UUID NOT NULL REFERENCES "group"(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE group_name IS 'Group names and aliases';
COMMENT ON COLUMN group_name.id IS 'UUID v7 primary key';
COMMENT ON COLUMN group_name.group_id IS 'Reference to the group';
COMMENT ON COLUMN group_name.name IS 'Unique name for the group';

-- Add primary_name column to group table
ALTER TABLE "group" ADD COLUMN primary_name UUID REFERENCES group_name(id) ON DELETE SET NULL;

COMMENT ON COLUMN "group".primary_name IS 'Primary name identifier for the group';

-- Create indexes for faster lookups
CREATE INDEX idx_group_name_group_id ON group_name(group_id);
CREATE INDEX idx_group_name_name ON group_name(name);
