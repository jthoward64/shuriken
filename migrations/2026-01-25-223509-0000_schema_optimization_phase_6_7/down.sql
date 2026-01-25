-- Rollback Schema Optimization for Phases 6 and 7
-- This migration reverses all changes made in the up migration

-- =============================================================================
-- PERFORMANCE HINTS ROLLBACK
-- =============================================================================

-- Reset FILLFACTOR to default (100)
ALTER TABLE dav_collection RESET (fillfactor);
ALTER TABLE dav_instance RESET (fillfactor);
ALTER TABLE dav_entity RESET (fillfactor);

-- =============================================================================
-- SCHEMA ENHANCEMENTS ROLLBACK
-- =============================================================================

-- Drop indexes for new cal_index columns
DROP INDEX IF EXISTS idx_cal_index_status;
DROP INDEX IF EXISTS idx_cal_index_transp;
DROP INDEX IF EXISTS idx_cal_index_organizer_cn;

-- Drop new columns from cal_index
ALTER TABLE cal_index DROP COLUMN IF EXISTS status;
ALTER TABLE cal_index DROP COLUMN IF EXISTS transp;
ALTER TABLE cal_index DROP COLUMN IF EXISTS organizer_cn;

-- Drop new columns from dav_instance
ALTER TABLE dav_instance DROP COLUMN IF EXISTS schedule_tag;

-- Drop new columns from dav_collection
ALTER TABLE dav_collection DROP COLUMN IF EXISTS supported_components;

-- =============================================================================
-- CONSTRAINT ENHANCEMENTS ROLLBACK
-- =============================================================================

-- Drop check constraints
ALTER TABLE cal_index DROP CONSTRAINT IF EXISTS chk_cal_index_component_type;
ALTER TABLE dav_instance DROP CONSTRAINT IF EXISTS chk_dav_instance_uri_format;
ALTER TABLE dav_collection DROP CONSTRAINT IF EXISTS chk_dav_collection_uri_format;

-- =============================================================================
-- INDEX OPTIMIZATIONS ROLLBACK
-- =============================================================================

-- Drop group/membership indexes
DROP INDEX IF EXISTS idx_group_name_group;
DROP INDEX IF EXISTS idx_group_name_name;
DROP INDEX IF EXISTS idx_membership_group;
DROP INDEX IF EXISTS idx_membership_user;

-- Drop principal/authorization indexes
DROP INDEX IF EXISTS idx_group_principal;
DROP INDEX IF EXISTS idx_user_principal;
DROP INDEX IF EXISTS idx_user_email_active;
DROP INDEX IF EXISTS idx_principal_type_active;
DROP INDEX IF EXISTS idx_principal_uri_active;

-- Drop CardDAV indexes
DROP INDEX IF EXISTS idx_card_phone_norm_active;
DROP INDEX IF EXISTS idx_card_email_email_active;
DROP INDEX IF EXISTS idx_card_index_uid_active;

-- Drop occurrence indexes
DROP INDEX IF EXISTS idx_cal_occurrence_entity_active;
DROP INDEX IF EXISTS idx_cal_occurrence_timerange;

-- Drop calendar query indexes
DROP INDEX IF EXISTS idx_cal_index_component_active;
DROP INDEX IF EXISTS idx_cal_index_uid_active;
DROP INDEX IF EXISTS idx_cal_index_timerange;

-- Drop sync query indexes
DROP INDEX IF EXISTS idx_dav_instance_sync_query;

-- Drop partial indexes
DROP INDEX IF EXISTS idx_dav_entity_logical_uid_active;
DROP INDEX IF EXISTS idx_dav_instance_sync_revision;
DROP INDEX IF EXISTS idx_dav_instance_collection_active;
DROP INDEX IF EXISTS idx_dav_collection_type_active;
DROP INDEX IF EXISTS idx_dav_collection_owner_active;

-- =============================================================================
-- PHASE 7 TABLES ROLLBACK
-- =============================================================================

-- Drop timezone cache table
DROP INDEX IF EXISTS idx_cal_timezone_tzid;
DROP TABLE IF EXISTS cal_timezone;

-- Drop attendee tracking table
DROP INDEX IF EXISTS idx_cal_attendee_deleted_at;
DROP INDEX IF EXISTS idx_cal_attendee_partstat;
DROP INDEX IF EXISTS idx_cal_attendee_address;
DROP INDEX IF EXISTS idx_cal_attendee_component;
DROP INDEX IF EXISTS idx_cal_attendee_entity;
DROP TABLE IF EXISTS cal_attendee;

-- Drop scheduling message table
DROP INDEX IF EXISTS idx_dav_schedule_message_deleted_at;
DROP INDEX IF EXISTS idx_dav_schedule_message_created;
DROP INDEX IF EXISTS idx_dav_schedule_message_recipient;
DROP INDEX IF EXISTS idx_dav_schedule_message_status;
DROP INDEX IF EXISTS idx_dav_schedule_message_collection;
DROP TABLE IF EXISTS dav_schedule_message;
