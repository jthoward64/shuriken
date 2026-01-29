-- Restore group_id column to user table
ALTER TABLE "user" ADD COLUMN group_id UUID REFERENCES "group"(id) ON DELETE SET NULL;

-- Drop membership table
DROP TABLE IF EXISTS membership;
