-- Add array columns and specialized type columns for list-type and complex properties
-- This allows proper storage of iCalendar/vCard list values and specialized types

ALTER TABLE dav_property
  ADD COLUMN value_text_array  TEXT[],
  ADD COLUMN value_date_array  DATE[],
  ADD COLUMN value_tstz_array  TIMESTAMPTZ[],
  ADD COLUMN value_time        TIME,
  ADD COLUMN value_interval    INTERVAL,
  ADD COLUMN value_tstzrange   TSTZRANGE;

-- Update constraint to include new columns
ALTER TABLE dav_property
  DROP CONSTRAINT chk_dav_property_single_value,
  ADD CONSTRAINT chk_dav_property_single_value
  CHECK (
    (CASE WHEN value_text       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_int        IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_float      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bool       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_date       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_tstz       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bytes      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_json       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_text_array IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_date_array IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_tstz_array IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_time       IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_interval   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_tstzrange  IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  );

-- Update value type constraint to include new types
ALTER TABLE dav_property
  DROP CONSTRAINT chk_dav_property_value_matches_type,
  ADD CONSTRAINT chk_dav_property_value_matches_type
  CHECK (
    (value_text       IS NULL OR value_type IN ('TEXT', 'DURATION', 'URI', 'UTC_OFFSET')) AND
    (value_int        IS NULL OR value_type = 'INTEGER') AND
    (value_float      IS NULL OR value_type = 'FLOAT') AND
    (value_bool       IS NULL OR value_type = 'BOOLEAN') AND
    (value_date       IS NULL OR value_type = 'DATE') AND
    (value_tstz       IS NULL OR value_type = 'DATE_TIME') AND
    (value_bytes      IS NULL OR value_type = 'BINARY') AND
    (value_json       IS NULL OR value_type = 'JSON') AND
    (value_text_array IS NULL OR value_type = 'TEXT_LIST') AND
    (value_date_array IS NULL OR value_type = 'DATE_LIST') AND
    (value_tstz_array IS NULL OR value_type = 'DATE_TIME_LIST') AND
    (value_time       IS NULL OR value_type = 'TIME') AND
    (value_interval   IS NULL OR value_type IN ('DURATION_INTERVAL', 'UTC_OFFSET_INTERVAL')) AND
    (value_tstzrange  IS NULL OR value_type IN ('PERIOD', 'PERIOD_LIST'))
  );

-- Add new value types
ALTER TABLE dav_property
  DROP CONSTRAINT dav_property_value_type_check,
  ADD CONSTRAINT dav_property_value_type_check
  CHECK (value_type IN (
    'TEXT',
    'INTEGER',
    'FLOAT',
    'BOOLEAN',
    'DATE',
    'DATE_TIME',
    'DURATION',
    'URI',
    'BINARY',
    'JSON',
    'TEXT_LIST',
    'DATE_LIST',
    'DATE_TIME_LIST',
    'TIME',
    'DURATION_INTERVAL',
    'UTC_OFFSET',
    'UTC_OFFSET_INTERVAL',
    'PERIOD',
    'PERIOD_LIST'
  ));

COMMENT ON COLUMN dav_property.value_text_array IS 'Array of text values for TEXT-LIST properties (e.g., CATEGORIES)';
COMMENT ON COLUMN dav_property.value_date_array IS 'Array of date values for DATE-LIST properties (e.g., RDATE, EXDATE with DATE type)';
COMMENT ON COLUMN dav_property.value_tstz_array IS 'Array of timestamp values for DATE-TIME-LIST properties (e.g., RDATE, EXDATE with DATE-TIME type)';
COMMENT ON COLUMN dav_property.value_time IS 'Time-of-day value for TIME properties (RFC 5545 §3.3.12)';
COMMENT ON COLUMN dav_property.value_interval IS 'PostgreSQL INTERVAL for DURATION values (RFC 5545 §3.3.6) or UTC-OFFSET as interval';
COMMENT ON COLUMN dav_property.value_tstzrange IS 'PostgreSQL TSTZRANGE for PERIOD values (RFC 5545 §3.3.9) - start and end timestamps';
