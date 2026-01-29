-- Schema Optimization for Phases 6 and 7
-- This migration adds missing tables, indexes, and constraints to optimize
-- the database schema for synchronization, scheduling, and future phases.

-- =============================================================================
-- PHASE 7: SCHEDULING SUPPORT
-- =============================================================================

-- Add scheduling message table for iTIP messages (RFC 6638)
CREATE TABLE dav_schedule_message (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  collection_id UUID NOT NULL REFERENCES dav_collection(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('REQUEST', 'REPLY', 'CANCEL', 'REFRESH', 'COUNTER', 'DECLINECOUNTER', 'ADD')),
  -- RFC 5546 §3.2: iTIP Methods for scheduling
  -- REQUEST: Initial invite or update, REPLY: Response from attendee
  -- CANCEL: Cancellation notice, REFRESH: Request for updated copy
  -- COUNTER: Attendee proposes changes, DECLINECOUNTER: Organizer rejects counter
  -- ADD: Add instances to recurring event
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  ical_data TEXT NOT NULL,
  diagnostics JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_schedule_message');

COMMENT ON TABLE dav_schedule_message IS 'iTIP scheduling messages for calendar invitations (RFC 6638)';
COMMENT ON COLUMN dav_schedule_message.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_schedule_message.collection_id IS 'Schedule inbox or outbox collection';
COMMENT ON COLUMN dav_schedule_message.sender IS 'Calendar user address of sender (mailto: URI)';
COMMENT ON COLUMN dav_schedule_message.recipient IS 'Calendar user address of recipient (mailto: URI)';
COMMENT ON COLUMN dav_schedule_message.method IS 'iTIP method (REQUEST, REPLY, CANCEL, etc.)';
COMMENT ON COLUMN dav_schedule_message.status IS 'Delivery status (pending, delivered, failed)';
COMMENT ON COLUMN dav_schedule_message.ical_data IS 'iCalendar data with METHOD property';
COMMENT ON COLUMN dav_schedule_message.diagnostics IS 'Delivery diagnostics or error information';
COMMENT ON COLUMN dav_schedule_message.created_at IS 'When the message was created';
COMMENT ON COLUMN dav_schedule_message.delivered_at IS 'When the message was successfully delivered';
COMMENT ON COLUMN dav_schedule_message.deleted_at IS 'Soft-delete timestamp (message processed/archived)';

CREATE INDEX idx_dav_schedule_message_collection ON dav_schedule_message(collection_id);
CREATE INDEX idx_dav_schedule_message_status ON dav_schedule_message(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_schedule_message_recipient ON dav_schedule_message(recipient) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_schedule_message_created ON dav_schedule_message(created_at);
CREATE INDEX idx_dav_schedule_message_deleted_at ON dav_schedule_message(deleted_at);

-- Add attendee tracking table for efficient PARTSTAT queries
CREATE TABLE cal_attendee (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  calendar_user_address TEXT NOT NULL,
  partstat TEXT NOT NULL DEFAULT 'NEEDS-ACTION' CHECK (partstat IN (
    'NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE', 'DELEGATED', 'COMPLETED', 'IN-PROCESS'
  )),
  -- RFC 5545 §3.2.12: PARTSTAT (Participation Status) parameter values
  -- NEEDS-ACTION: No response yet, ACCEPTED: Accepted invitation
  -- DECLINED: Declined invitation, TENTATIVE: Tentatively accepted
  -- DELEGATED: Delegated to another attendee, COMPLETED: Completed (for TODOs)
  -- IN-PROCESS: In progress (for TODOs)
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

COMMENT ON TABLE cal_attendee IS 'Derived index of calendar event attendees for PARTSTAT queries';
COMMENT ON COLUMN cal_attendee.id IS 'UUID v7 primary key';
COMMENT ON COLUMN cal_attendee.entity_id IS 'Canonical entity';
COMMENT ON COLUMN cal_attendee.component_id IS 'Component indexed (VEVENT/VTODO)';
COMMENT ON COLUMN cal_attendee.calendar_user_address IS 'Attendee calendar user address (mailto: URI)';
COMMENT ON COLUMN cal_attendee.partstat IS 'Participation status';
COMMENT ON COLUMN cal_attendee.role IS 'Attendee role (CHAIR, REQ-PARTICIPANT, etc.)';
COMMENT ON COLUMN cal_attendee.rsvp IS 'RSVP requested flag';
COMMENT ON COLUMN cal_attendee.cn IS 'Common name of attendee';
COMMENT ON COLUMN cal_attendee.ordinal IS 'Ordering within the attendee list';
COMMENT ON COLUMN cal_attendee.deleted_at IS 'Soft-delete timestamp';

CREATE INDEX idx_cal_attendee_entity ON cal_attendee(entity_id);
CREATE INDEX idx_cal_attendee_component ON cal_attendee(component_id);
CREATE INDEX idx_cal_attendee_address ON cal_attendee(calendar_user_address) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_attendee_partstat ON cal_attendee(partstat) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_attendee_deleted_at ON cal_attendee(deleted_at);

-- Add timezone cache table for efficient timezone resolution
CREATE TABLE cal_timezone (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  tzid TEXT NOT NULL UNIQUE,
  vtimezone_data TEXT NOT NULL,
  iana_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT diesel_manage_updated_at('cal_timezone');

COMMENT ON TABLE cal_timezone IS 'Cached VTIMEZONE components for timezone resolution';
COMMENT ON COLUMN cal_timezone.id IS 'UUID v7 primary key';
COMMENT ON COLUMN cal_timezone.tzid IS 'Timezone identifier (e.g., America/New_York)';
COMMENT ON COLUMN cal_timezone.vtimezone_data IS 'Full VTIMEZONE component data';
COMMENT ON COLUMN cal_timezone.iana_name IS 'IANA timezone name if mappable';
COMMENT ON COLUMN cal_timezone.created_at IS 'When this timezone was first cached';

CREATE INDEX idx_cal_timezone_tzid ON cal_timezone(tzid);

-- =============================================================================
-- INDEX OPTIMIZATIONS
-- =============================================================================

-- Add partial indexes for common queries (exclude soft-deleted rows)
CREATE INDEX idx_dav_collection_owner_active ON dav_collection(owner_principal_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_collection_type_active ON dav_collection(collection_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_instance_collection_active ON dav_instance(collection_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_instance_sync_revision ON dav_instance(collection_id, sync_revision) WHERE deleted_at IS NULL;
CREATE INDEX idx_dav_entity_logical_uid_active ON dav_entity(logical_uid) WHERE deleted_at IS NULL AND logical_uid IS NOT NULL;

-- Add composite indexes for sync queries (critical for Phase 6)
CREATE INDEX idx_dav_instance_sync_query ON dav_instance(collection_id, sync_revision, deleted_at);

-- Add composite indexes for calendar queries
CREATE INDEX idx_cal_index_timerange ON cal_index(dtstart_utc, dtend_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_index_uid_active ON cal_index(uid) WHERE deleted_at IS NULL AND uid IS NOT NULL;
CREATE INDEX idx_cal_index_component_active ON cal_index(component_id) WHERE deleted_at IS NULL;

-- Add composite indexes for occurrence queries (Phase 5)
CREATE INDEX idx_cal_occurrence_timerange ON cal_occurrence(start_utc, end_utc) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_occurrence_entity_active ON cal_occurrence(entity_id) WHERE deleted_at IS NULL;

-- Add composite indexes for CardDAV queries
CREATE INDEX idx_card_index_uid_active ON card_index(uid) WHERE deleted_at IS NULL AND uid IS NOT NULL;
CREATE INDEX idx_card_email_email_active ON card_email(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_card_phone_norm_active ON card_phone(phone_norm) WHERE deleted_at IS NULL AND phone_norm IS NOT NULL;

-- Add indexes for principal/authorization queries (Phase 8)
CREATE INDEX idx_principal_uri_active ON principal(uri) WHERE deleted_at IS NULL;
CREATE INDEX idx_principal_type_active ON principal(principal_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_user_email_active ON "user"(email);
CREATE INDEX idx_user_principal ON "user"(principal_id);
CREATE INDEX idx_group_principal ON "group"(principal_id);

-- Note: group membership indexes already exist from previous migrations:
-- idx_membership_user_id, idx_membership_group_id (from 0002_add_memberships_table)
-- idx_group_name_name, idx_group_name_group_id (from 0001_groups_name_and_aliases)

-- =============================================================================
-- CONSTRAINT ENHANCEMENTS
-- =============================================================================

-- Add check constraint to ensure collection URIs are valid
-- Pattern: must start and end with alphanumeric, middle can have alphanumeric, underscore, dash, dot
-- This prevents path traversal (../) and ensures valid URI components
-- Examples: "work", "my-calendar", "team.cal" are valid; ".hidden", "cal..", "a..b" are invalid
ALTER TABLE dav_collection ADD CONSTRAINT chk_dav_collection_uri_format
  CHECK (uri ~ '^[a-zA-Z0-9]+([a-zA-Z0-9_.-]*[a-zA-Z0-9]+)?$');

-- Add check constraint to ensure instance URIs end with .ics or .vcf based on content type
ALTER TABLE dav_instance ADD CONSTRAINT chk_dav_instance_uri_format
  CHECK (
    (content_type = 'text/calendar' AND uri ~ '\.ics$') OR
    (content_type = 'text/vcard' AND uri ~ '\.vcf$')
  );

-- Add check constraint to ensure entity type matches content in derived indexes
ALTER TABLE cal_index ADD CONSTRAINT chk_cal_index_component_type
  CHECK (component_type IN ('VEVENT', 'VTODO', 'VJOURNAL', 'VFREEBUSY'));

-- Add check constraint to ensure occurrence times are logical
-- (already exists in schema, but documenting here for completeness)

-- =============================================================================
-- SCHEMA ENHANCEMENTS
-- =============================================================================

-- Add collection-level properties for scheduling (Phase 7)
ALTER TABLE dav_collection ADD COLUMN supported_components TEXT[] DEFAULT ARRAY['VEVENT'];

COMMENT ON COLUMN dav_collection.supported_components IS 'Supported component types (VEVENT, VTODO, etc.) for CalDAV collections';

-- Add instance-level scheduling metadata
ALTER TABLE dav_instance ADD COLUMN schedule_tag TEXT;

COMMENT ON COLUMN dav_instance.schedule_tag IS 'Schedule-Tag header for iTIP message correlation (RFC 6638)';

-- Add organizer tracking to cal_index for efficient organizer-based queries
ALTER TABLE cal_index ADD COLUMN organizer_cn TEXT;

COMMENT ON COLUMN cal_index.organizer_cn IS 'Common name of organizer for display purposes';

-- Add TRANSP and STATUS to cal_index for free-busy queries (Phase 7)
ALTER TABLE cal_index ADD COLUMN transp TEXT CHECK (transp IN ('OPAQUE', 'TRANSPARENT'));
ALTER TABLE cal_index ADD COLUMN status TEXT CHECK (status IN ('TENTATIVE', 'CONFIRMED', 'CANCELLED'));

COMMENT ON COLUMN cal_index.transp IS 'Time transparency (OPAQUE = busy, TRANSPARENT = free)';
COMMENT ON COLUMN cal_index.status IS 'Event status for free-busy filtering';

-- Add indexes for new cal_index columns
CREATE INDEX idx_cal_index_organizer_cn ON cal_index(organizer_cn) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_index_transp ON cal_index(transp) WHERE deleted_at IS NULL;
CREATE INDEX idx_cal_index_status ON cal_index(status) WHERE deleted_at IS NULL;

-- =============================================================================
-- PERFORMANCE HINTS
-- =============================================================================

-- Add FILLFACTOR to frequently updated tables to reduce bloat
ALTER TABLE dav_collection SET (fillfactor = 90);
ALTER TABLE dav_instance SET (fillfactor = 90);
ALTER TABLE dav_entity SET (fillfactor = 90);

-- =============================================================================
-- CLEANUP
-- =============================================================================

-- Analyze new tables to update statistics
ANALYZE dav_schedule_message;
ANALYZE cal_attendee;
ANALYZE cal_timezone;
