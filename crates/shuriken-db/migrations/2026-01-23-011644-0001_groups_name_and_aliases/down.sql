-- Remove primary_name column from group table
ALTER TABLE "group" DROP COLUMN primary_name;

-- Drop group_name table
DROP TABLE IF EXISTS group_name;
