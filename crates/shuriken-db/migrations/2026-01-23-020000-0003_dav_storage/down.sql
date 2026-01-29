-- Rollback DAV storage schema.

DROP TABLE IF EXISTS card_phone;
DROP TABLE IF EXISTS card_email;
DROP TABLE IF EXISTS card_index;
DROP TABLE IF EXISTS cal_occurrence;
DROP TABLE IF EXISTS cal_index;
DROP TABLE IF EXISTS dav_shadow;
DROP TABLE IF EXISTS dav_parameter;
DROP TABLE IF EXISTS dav_property;
DROP TABLE IF EXISTS dav_component;
DROP TABLE IF EXISTS dav_tombstone;
DROP TABLE IF EXISTS dav_instance;
DROP TABLE IF EXISTS dav_entity;
DROP TABLE IF EXISTS dav_collection;

ALTER TABLE "user" DROP CONSTRAINT IF EXISTS fk_user_principal;
ALTER TABLE "group" DROP CONSTRAINT IF EXISTS fk_group_principal;
DROP INDEX IF EXISTS uq_user_principal_id;
DROP INDEX IF EXISTS uq_group_principal_id;
ALTER TABLE "user" DROP COLUMN IF EXISTS principal_id;
ALTER TABLE "group" DROP COLUMN IF EXISTS principal_id;

DROP TABLE IF EXISTS principal;
