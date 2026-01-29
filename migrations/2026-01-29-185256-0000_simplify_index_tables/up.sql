-- Simplify index tables: drop unused tables, consolidate fields into JSONB, add search_tsv

-- =============================================================================
-- DROP UNUSED INDEX TABLES
-- =============================================================================

DROP TABLE IF EXISTS cal_occurrence;
DROP TABLE IF EXISTS card_email;
DROP TABLE IF EXISTS card_phone;
DROP TABLE IF EXISTS cal_attendee;

COMMENT ON TABLE cal_index IS 'Derived index for CalDAV queries (time-range, UID lookups, text search)';
COMMENT ON TABLE card_index IS 'Derived index for CardDAV queries (FN, UID, text search)';

-- =============================================================================
-- CAL_INDEX: CONSOLIDATE METADATA INTO JSONB
-- =============================================================================

-- Remove rarely-queried fields that will move to JSONB
ALTER TABLE cal_index DROP COLUMN IF EXISTS organizer;
ALTER TABLE cal_index DROP COLUMN IF EXISTS organizer_cn;
ALTER TABLE cal_index DROP COLUMN IF EXISTS summary;
ALTER TABLE cal_index DROP COLUMN IF EXISTS location;
ALTER TABLE cal_index DROP COLUMN IF EXISTS sequence;
ALTER TABLE cal_index DROP COLUMN IF EXISTS transp;
ALTER TABLE cal_index DROP COLUMN IF EXISTS status;

-- Add metadata JSONB column for flexible storage
ALTER TABLE cal_index ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN cal_index.metadata IS 'Flexible metadata: summary, location, organizer, attendees, etc.';

-- Add full-text search column (generated from metadata)
ALTER TABLE cal_index ADD COLUMN search_tsv TSVECTOR 
  GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(metadata->>'summary', '') || ' ' ||
      COALESCE(metadata->>'location', '') || ' ' ||
      COALESCE(metadata->>'description', '')
    )
  ) STORED;

COMMENT ON COLUMN cal_index.search_tsv IS 'Full-text search vector for summary, location, description';

-- Add GIN index for full-text search
CREATE INDEX idx_cal_index_search_tsv ON cal_index USING GIN (search_tsv);

-- Add GIN index for metadata queries
CREATE INDEX idx_cal_index_metadata ON cal_index USING GIN (metadata);

-- =============================================================================
-- CARD_INDEX: CONSOLIDATE FIELDS INTO JSONB
-- =============================================================================

-- Remove fields that will move to JSONB (keep fn for quick lookups)
ALTER TABLE card_index DROP COLUMN IF EXISTS n_family;
ALTER TABLE card_index DROP COLUMN IF EXISTS n_given;
ALTER TABLE card_index DROP COLUMN IF EXISTS org;
ALTER TABLE card_index DROP COLUMN IF EXISTS title;

-- Add data JSONB column for flexible storage
ALTER TABLE card_index ADD COLUMN data JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN card_index.data IS 'Flexible vCard data: n_family, n_given, org, title, emails, phones, etc.';

-- Recreate search_tsv as regular column (maintained by trigger)
ALTER TABLE card_index DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE card_index ADD COLUMN search_tsv TSVECTOR;

COMMENT ON COLUMN card_index.search_tsv IS 'Full-text search vector for all text fields including emails and phones';

-- Create trigger function to maintain card_index.search_tsv
CREATE OR REPLACE FUNCTION update_card_index_search_tsv()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract all text from data JSONB
  NEW.search_tsv := to_tsvector('english',
    COALESCE(NEW.fn, '') || ' ' ||
    COALESCE(NEW.data->>'n_family', '') || ' ' ||
    COALESCE(NEW.data->>'n_given', '') || ' ' ||
    COALESCE(NEW.data->>'org', '') || ' ' ||
    COALESCE(NEW.data->>'title', '') || ' ' ||
    -- Extract emails array
    COALESCE(
      (SELECT string_agg(value::text, ' ') 
       FROM jsonb_array_elements_text(NEW.data->'emails')),
      ''
    ) || ' ' ||
    -- Extract phones array
    COALESCE(
      (SELECT string_agg(value::text, ' ') 
       FROM jsonb_array_elements_text(NEW.data->'phones')),
      ''
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update search_tsv
CREATE TRIGGER card_index_search_tsv_trigger
  BEFORE INSERT OR UPDATE ON card_index
  FOR EACH ROW
  EXECUTE FUNCTION update_card_index_search_tsv();

-- Recreate GIN index for full-text search
DROP INDEX IF EXISTS idx_card_index_search_tsv;
CREATE INDEX idx_card_index_search_tsv ON card_index USING GIN (search_tsv);

-- Add GIN index for data queries
CREATE INDEX idx_card_index_data ON card_index USING GIN (data);

-- =============================================================================
-- CLEANUP OLD INDEXES
-- =============================================================================

-- Drop indexes related to removed columns
DROP INDEX IF EXISTS idx_cal_index_organizer_cn;
DROP INDEX IF EXISTS idx_cal_index_transp;
DROP INDEX IF EXISTS idx_cal_index_status;
DROP INDEX IF EXISTS idx_cal_occurrence_range_gist;
DROP INDEX IF EXISTS idx_cal_occurrence_entity;
DROP INDEX IF EXISTS idx_cal_occurrence_component;
DROP INDEX IF EXISTS idx_cal_occurrence_deleted_at;
DROP INDEX IF EXISTS idx_cal_occurrence_timerange;
DROP INDEX IF EXISTS idx_cal_occurrence_entity_active;
DROP INDEX IF EXISTS idx_card_email_email;
DROP INDEX IF EXISTS idx_card_email_entity;
DROP INDEX IF EXISTS idx_card_email_deleted_at;
DROP INDEX IF EXISTS idx_card_email_email_active;
DROP INDEX IF EXISTS idx_card_phone_norm;
DROP INDEX IF EXISTS idx_card_phone_entity;
DROP INDEX IF EXISTS idx_card_phone_deleted_at;
DROP INDEX IF EXISTS idx_card_phone_norm_active;
DROP INDEX IF EXISTS idx_cal_attendee_entity;
DROP INDEX IF EXISTS idx_cal_attendee_component;
DROP INDEX IF EXISTS idx_cal_attendee_address;
DROP INDEX IF EXISTS idx_cal_attendee_partstat;
DROP INDEX IF EXISTS idx_cal_attendee_deleted_at;

-- =============================================================================
-- ANALYZE TABLES
-- =============================================================================

ANALYZE cal_index;
ANALYZE card_index;
