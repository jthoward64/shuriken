-- Revert simplification of index tables

-- Note: This is a destructive migration. Data in JSONB columns will be lost.
-- Only the table structure can be restored, not the data.

-- Restore cal_index columns
ALTER TABLE cal_index DROP COLUMN IF EXISTS metadata;
ALTER TABLE cal_index DROP COLUMN IF EXISTS search_tsv;

ALTER TABLE cal_index ADD COLUMN organizer TEXT;
ALTER TABLE cal_index ADD COLUMN organizer_cn TEXT;
ALTER TABLE cal_index ADD COLUMN summary TEXT;
ALTER TABLE cal_index ADD COLUMN location TEXT;
ALTER TABLE cal_index ADD COLUMN sequence INT;
ALTER TABLE cal_index ADD COLUMN transp TEXT CHECK (transp IN ('OPAQUE', 'TRANSPARENT'));
ALTER TABLE cal_index ADD COLUMN status TEXT CHECK (status IN ('TENTATIVE', 'CONFIRMED', 'CANCELLED'));

-- Restore card_index columns
ALTER TABLE card_index DROP COLUMN IF EXISTS data;
ALTER TABLE card_index DROP COLUMN IF EXISTS search_tsv;

-- Drop trigger and function
DROP TRIGGER IF EXISTS card_index_search_tsv_trigger ON card_index;
DROP FUNCTION IF EXISTS update_card_index_search_tsv();

ALTER TABLE card_index ADD COLUMN n_family TEXT;
ALTER TABLE card_index ADD COLUMN n_given TEXT;
ALTER TABLE card_index ADD COLUMN org TEXT;
ALTER TABLE card_index ADD COLUMN title TEXT;
ALTER TABLE card_index ADD COLUMN search_tsv TSVECTOR;

CREATE INDEX idx_card_index_search_tsv ON card_index USING GIN (search_tsv);

-- Recreate dropped tables (structure only, no data)
CREATE TABLE cal_occurrence (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  start_utc TIMESTAMPTZ NOT NULL,
  end_utc TIMESTAMPTZ NOT NULL,
  recurrence_id_utc TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_cal_occurrence_range CHECK (end_utc > start_utc)
);

SELECT diesel_manage_updated_at('cal_occurrence');

CREATE INDEX idx_cal_occurrence_entity ON cal_occurrence(entity_id);
CREATE INDEX idx_cal_occurrence_component ON cal_occurrence(component_id);
CREATE INDEX idx_cal_occurrence_deleted_at ON cal_occurrence(deleted_at);

CREATE TABLE card_email (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  params_json JSONB,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('card_email');

CREATE INDEX idx_card_email_email ON card_email(email);
CREATE INDEX idx_card_email_entity ON card_email(entity_id);
CREATE INDEX idx_card_email_deleted_at ON card_email(deleted_at);

CREATE TABLE card_phone (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  phone_raw TEXT NOT NULL,
  phone_norm TEXT,
  params_json JSONB,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('card_phone');

CREATE INDEX idx_card_phone_norm ON card_phone(phone_norm);
CREATE INDEX idx_card_phone_entity ON card_phone(entity_id);
CREATE INDEX idx_card_phone_deleted_at ON card_phone(deleted_at);

CREATE TABLE cal_attendee (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  calendar_user_address TEXT NOT NULL,
  partstat TEXT NOT NULL DEFAULT 'NEEDS-ACTION' CHECK (partstat IN (
    'NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'DELEGATED', 'COMPLETED', 'IN-PROCESS'
  )),
  role TEXT CHECK (role IN ('CHAIR', 'REQ-PARTICIPANT', 'OPT-PARTICIPANT', 'NON-PARTICIPANT')),
  rsvp BOOLEAN,
  cn TEXT,
  delegated_from TEXT,
  delegated_to TEXT,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('cal_attendee');

CREATE INDEX idx_cal_attendee_entity ON cal_attendee(entity_id);
CREATE INDEX idx_cal_attendee_component ON cal_attendee(component_id);
CREATE INDEX idx_cal_attendee_address ON cal_attendee(calendar_user_address);
CREATE INDEX idx_cal_attendee_partstat ON cal_attendee(partstat);
CREATE INDEX idx_cal_attendee_deleted_at ON cal_attendee(deleted_at);
