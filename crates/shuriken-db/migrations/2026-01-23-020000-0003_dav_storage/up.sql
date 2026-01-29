-- Ensure btree_gist extension is available for range indexes.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Principals on existing subjects.
ALTER TABLE "user" ADD COLUMN principal_id UUID NOT NULL;
ALTER TABLE "group" ADD COLUMN principal_id UUID NOT NULL;

COMMENT ON COLUMN "user".principal_id IS 'Reference to principal row representing this user';
COMMENT ON COLUMN "group".principal_id IS 'Reference to principal row representing this group';

-- Principal namespace for ACL subjects.
CREATE TABLE principal (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'group', 'system', 'public', 'resource')),
  uri TEXT NOT NULL UNIQUE,
  display_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('principal');

COMMENT ON TABLE principal IS 'Unified principal namespace for ACL subjects (users, groups, system/public/resource principals)';
COMMENT ON COLUMN principal.id IS 'UUID v7 primary key';
COMMENT ON COLUMN principal.principal_type IS 'Principal category';
COMMENT ON COLUMN principal.uri IS 'Stable principal URI used by DAV routing/discovery';
COMMENT ON COLUMN principal.display_name IS 'Human-readable display name';
COMMENT ON COLUMN principal.deleted_at IS 'Soft-delete timestamp (principal disabled / pending purge)';

CREATE INDEX idx_principal_principal_type ON principal(principal_type);
CREATE INDEX idx_principal_deleted_at ON principal(deleted_at);

ALTER TABLE "user"
  ADD CONSTRAINT fk_user_principal
  FOREIGN KEY (principal_id) REFERENCES principal(id) ON DELETE RESTRICT;

ALTER TABLE "group"
  ADD CONSTRAINT fk_group_principal
  FOREIGN KEY (principal_id) REFERENCES principal(id) ON DELETE RESTRICT;

-- 1:1 mapping enforced by NOT NULL and unique index.
CREATE UNIQUE INDEX uq_user_principal_id ON "user"(principal_id);
CREATE UNIQUE INDEX uq_group_principal_id ON "group"(principal_id);

-- DAV collections (calendar/addressbook).
CREATE TABLE dav_collection (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  owner_principal_id UUID NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  collection_type TEXT NOT NULL CHECK (collection_type IN ('calendar', 'addressbook')),
  uri TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  timezone_tzid TEXT,
  synctoken BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_collection');

COMMENT ON TABLE dav_collection IS 'DAV collections (CalDAV calendars, CardDAV addressbooks)';
COMMENT ON COLUMN dav_collection.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_collection.owner_principal_id IS 'Owner principal of this collection';
COMMENT ON COLUMN dav_collection.collection_type IS 'calendar or addressbook';
COMMENT ON COLUMN dav_collection.uri IS 'Collection URI (unique per owner)';
COMMENT ON COLUMN dav_collection.synctoken IS 'Monotonic collection sync token';
COMMENT ON COLUMN dav_collection.deleted_at IS 'Soft-delete timestamp (undo window / pending purge)';

CREATE UNIQUE INDEX uq_dav_collection_owner_uri
ON dav_collection(owner_principal_id, uri);

CREATE INDEX idx_dav_collection_owner ON dav_collection(owner_principal_id);
CREATE INDEX idx_dav_collection_deleted_at ON dav_collection(deleted_at);

-- Canonical content entity.
CREATE TABLE dav_entity (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('icalendar', 'vcard')),
  logical_uid TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_entity');

COMMENT ON TABLE dav_entity IS 'Canonical content entity (shared across one or more DAV instances)';
COMMENT ON COLUMN dav_entity.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_entity.entity_type IS 'icalendar or vcard';
COMMENT ON COLUMN dav_entity.logical_uid IS 'Logical UID inside the content (not globally unique)';
COMMENT ON COLUMN dav_entity.deleted_at IS 'Soft-delete timestamp (undo window / pending purge)';

CREATE INDEX idx_dav_entity_type ON dav_entity(entity_type);
CREATE INDEX idx_dav_entity_logical_uid ON dav_entity(logical_uid);
CREATE INDEX idx_dav_entity_deleted_at ON dav_entity(deleted_at);

-- Per-collection resource instance.
CREATE TABLE dav_instance (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  collection_id UUID NOT NULL REFERENCES dav_collection(id) ON DELETE RESTRICT,
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE RESTRICT,
  uri TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text/calendar', 'text/vcard')),
  etag TEXT NOT NULL,
  sync_revision BIGINT NOT NULL DEFAULT 0,
  last_modified TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_instance');

COMMENT ON TABLE dav_instance IS 'Per-collection resource identity that references a canonical dav_entity';
COMMENT ON COLUMN dav_instance.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_instance.collection_id IS 'Containing collection';
COMMENT ON COLUMN dav_instance.entity_id IS 'Referenced canonical entity';
COMMENT ON COLUMN dav_instance.uri IS 'Resource URI within collection';
COMMENT ON COLUMN dav_instance.content_type IS 'text/calendar or text/vcard';
COMMENT ON COLUMN dav_instance.etag IS 'ETag for this resource';
COMMENT ON COLUMN dav_instance.sync_revision IS 'Monotonic per-collection change revision for sync';
COMMENT ON COLUMN dav_instance.deleted_at IS 'Soft-delete timestamp (undo window / pending purge)';

CREATE UNIQUE INDEX uq_dav_instance_collection_uri
ON dav_instance(collection_id, uri);

CREATE INDEX idx_dav_instance_collection ON dav_instance(collection_id);
CREATE INDEX idx_dav_instance_entity ON dav_instance(entity_id);
CREATE INDEX idx_dav_instance_deleted_at ON dav_instance(deleted_at);

-- Tombstones for sync correctness after purge.
CREATE TABLE dav_tombstone (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  collection_id UUID NOT NULL REFERENCES dav_collection(id) ON DELETE RESTRICT,
  uri TEXT NOT NULL,
  entity_id UUID REFERENCES dav_entity(id) ON DELETE SET NULL,
  synctoken BIGINT NOT NULL,
  sync_revision BIGINT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_etag TEXT,
  logical_uid TEXT
);

COMMENT ON TABLE dav_tombstone IS 'Deletion tombstones for sync correctness after purge';
COMMENT ON COLUMN dav_tombstone.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_tombstone.collection_id IS 'Collection where the resource was deleted';
COMMENT ON COLUMN dav_tombstone.uri IS 'Resource URI that was deleted';
COMMENT ON COLUMN dav_tombstone.synctoken IS 'Collection synctoken at deletion time';
COMMENT ON COLUMN dav_tombstone.sync_revision IS 'Per-collection revision at deletion time';
COMMENT ON COLUMN dav_tombstone.deleted_at IS 'Deletion time';

CREATE INDEX idx_dav_tombstone_collection ON dav_tombstone(collection_id);
CREATE INDEX idx_dav_tombstone_collection_uri ON dav_tombstone(collection_id, uri);
CREATE INDEX idx_dav_tombstone_deleted_at ON dav_tombstone(deleted_at);

CREATE UNIQUE INDEX uq_dav_tombstone_collection_uri_rev
ON dav_tombstone(collection_id, uri, sync_revision);

-- Component tree.
CREATE TABLE dav_component (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  parent_component_id UUID REFERENCES dav_component(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_component');

COMMENT ON TABLE dav_component IS 'Canonical component tree for iCalendar/vCard content';
COMMENT ON COLUMN dav_component.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_component.entity_id IS 'Owning canonical entity';
COMMENT ON COLUMN dav_component.parent_component_id IS 'Parent component for nested structures (e.g., VCALENDAR -> VEVENT -> VALARM)';
COMMENT ON COLUMN dav_component.name IS 'Component name (e.g., VEVENT, VCARD)';
COMMENT ON COLUMN dav_component.ordinal IS 'Ordering within the parent scope';
COMMENT ON COLUMN dav_component.deleted_at IS 'Soft-delete timestamp (rare; usually delete entire entity)';

CREATE INDEX idx_dav_component_entity ON dav_component(entity_id);
CREATE INDEX idx_dav_component_parent ON dav_component(parent_component_id);
CREATE INDEX idx_dav_component_deleted_at ON dav_component(deleted_at);

-- Component properties.
CREATE TABLE dav_property (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN (
    'TEXT',
    'INTEGER',
    'FLOAT',
    'BOOLEAN',
    'DATE',
    'DATE_TIME',
    'DURATION',
    'URI',
    'BINARY',
    'JSON'
  )),
  value_text  TEXT,
  value_int   BIGINT,
  value_float DOUBLE PRECISION,
  value_bool  BOOLEAN,
  value_date  DATE,
  value_tstz  TIMESTAMPTZ,
  value_bytes BYTEA,
  value_json  JSONB,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_dav_property_single_value
  CHECK (
    (CASE WHEN value_text  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_int   IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_float IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bool  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_date  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_tstz  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_bytes IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN value_json  IS NOT NULL THEN 1 ELSE 0 END)
    <= 1
  ),
  CONSTRAINT chk_dav_property_value_matches_type
  CHECK (
    (value_text  IS NULL OR value_type = 'TEXT') AND
    (value_int   IS NULL OR value_type = 'INTEGER') AND
    (value_float IS NULL OR value_type = 'FLOAT') AND
    (value_bool  IS NULL OR value_type = 'BOOLEAN') AND
    (value_date  IS NULL OR value_type = 'DATE') AND
    (value_tstz  IS NULL OR value_type = 'DATE_TIME') AND
    (value_bytes IS NULL OR value_type = 'BINARY') AND
    (value_json  IS NULL OR value_type = 'JSON')
  )
);

SELECT diesel_manage_updated_at('dav_property');

COMMENT ON TABLE dav_property IS 'Canonical properties for a component, including X-* extensions; value stored in exactly one typed column';
COMMENT ON COLUMN dav_property.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_property.component_id IS 'Owning component';
COMMENT ON COLUMN dav_property.name IS 'Property name (e.g., DTSTART, FN, TEL)';
COMMENT ON COLUMN dav_property.value_type IS 'Canonical value type for deterministic serialization';
COMMENT ON COLUMN dav_property.ordinal IS 'Ordering within component';
COMMENT ON COLUMN dav_property.deleted_at IS 'Soft-delete timestamp (rare; usually delete entity)';

CREATE INDEX idx_dav_property_component ON dav_property(component_id);
CREATE INDEX idx_dav_property_name ON dav_property(name);
CREATE INDEX idx_dav_property_component_name ON dav_property(component_id, name);
CREATE INDEX idx_dav_property_deleted_at ON dav_property(deleted_at);

-- Property parameters.
CREATE TABLE dav_parameter (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  property_id UUID NOT NULL REFERENCES dav_property(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  ordinal INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('dav_parameter');

COMMENT ON TABLE dav_parameter IS 'Parameters associated with a property (including ordering for stable canonical output)';
COMMENT ON COLUMN dav_parameter.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_parameter.property_id IS 'Owning property';
COMMENT ON COLUMN dav_parameter.name IS 'Parameter name (e.g., TZID, TYPE)';
COMMENT ON COLUMN dav_parameter.value IS 'Parameter value';
COMMENT ON COLUMN dav_parameter.ordinal IS 'Ordering within the parameter list';

CREATE INDEX idx_dav_parameter_property ON dav_parameter(property_id);
CREATE INDEX idx_dav_parameter_name ON dav_parameter(name);
CREATE INDEX idx_dav_parameter_property_name ON dav_parameter(property_id, name);
CREATE INDEX idx_dav_parameter_deleted_at ON dav_parameter(deleted_at);

-- Shadow payloads for debug/compat.
CREATE TABLE dav_shadow (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  instance_id UUID REFERENCES dav_instance(id) ON DELETE CASCADE,
  entity_id UUID REFERENCES dav_entity(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content_type TEXT NOT NULL CHECK (content_type IN ('text/calendar', 'text/vcard')),
  raw_original BYTEA,
  raw_canonical BYTEA,
  diagnostics JSONB,
  request_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_dav_shadow_ref
  CHECK (instance_id IS NOT NULL OR entity_id IS NOT NULL)
);

SELECT diesel_manage_updated_at('dav_shadow');

COMMENT ON TABLE dav_shadow IS 'Debug shadow storage of original inbound payload and canonical serialized payload';
COMMENT ON COLUMN dav_shadow.id IS 'UUID v7 primary key';
COMMENT ON COLUMN dav_shadow.instance_id IS 'Related DAV instance (if known)';
COMMENT ON COLUMN dav_shadow.entity_id IS 'Related canonical entity (if known)';
COMMENT ON COLUMN dav_shadow.direction IS 'inbound or outbound';
COMMENT ON COLUMN dav_shadow.raw_original IS 'Client-sent payload bytes';
COMMENT ON COLUMN dav_shadow.raw_canonical IS 'Canonical serialized payload bytes';
COMMENT ON COLUMN dav_shadow.diagnostics IS 'Optional parse/validation diagnostics';
COMMENT ON COLUMN dav_shadow.deleted_at IS 'Soft-delete timestamp for shadow retention';

CREATE INDEX idx_dav_shadow_instance ON dav_shadow(instance_id);
CREATE INDEX idx_dav_shadow_entity ON dav_shadow(entity_id);
CREATE INDEX idx_dav_shadow_request_id ON dav_shadow(request_id);
CREATE INDEX idx_dav_shadow_deleted_at ON dav_shadow(deleted_at);

-- Derived calendar index.
CREATE TABLE cal_index (
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  component_type TEXT NOT NULL,
  uid TEXT,
  recurrence_id_utc TIMESTAMPTZ,
  dtstart_utc TIMESTAMPTZ,
  dtend_utc TIMESTAMPTZ,
  all_day BOOLEAN,
  rrule_text TEXT,
  organizer TEXT,
  summary TEXT,
  location TEXT,
  sequence INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (entity_id, component_id)
);

SELECT diesel_manage_updated_at('cal_index');

COMMENT ON TABLE cal_index IS 'Derived index for CalDAV queries (time-range, UID lookups, etc.)';
COMMENT ON COLUMN cal_index.entity_id IS 'Canonical entity';
COMMENT ON COLUMN cal_index.component_id IS 'Component indexed (e.g., VEVENT component)';

CREATE INDEX idx_cal_index_uid ON cal_index(uid);
CREATE INDEX idx_cal_index_dtstart ON cal_index(dtstart_utc);
CREATE INDEX idx_cal_index_dtend ON cal_index(dtend_utc);
CREATE INDEX idx_cal_index_deleted_at ON cal_index(deleted_at);

-- Occurrence cache for recurring events.
CREATE TABLE cal_occurrence (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  entity_id UUID NOT NULL REFERENCES dav_entity(id) ON DELETE CASCADE,
  component_id UUID NOT NULL REFERENCES dav_component(id) ON DELETE CASCADE,
  start_utc TIMESTAMPTZ NOT NULL,
  end_utc TIMESTAMPTZ NOT NULL,
  recurrence_id_utc TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT chk_cal_occurrence_range
  CHECK (end_utc > start_utc)
);

SELECT diesel_manage_updated_at('cal_occurrence');

COMMENT ON TABLE cal_occurrence IS 'Derived occurrence expansion cache for recurring components (optional)';
COMMENT ON COLUMN cal_occurrence.id IS 'UUID v7 primary key';
COMMENT ON COLUMN cal_occurrence.start_utc IS 'Occurrence start time (UTC)';
COMMENT ON COLUMN cal_occurrence.end_utc IS 'Occurrence end time (UTC)';

CREATE INDEX idx_cal_occurrence_range_gist
ON cal_occurrence
USING GIST (tstzrange(start_utc, end_utc, '[)'));

CREATE INDEX idx_cal_occurrence_entity ON cal_occurrence(entity_id);
CREATE INDEX idx_cal_occurrence_component ON cal_occurrence(component_id);
CREATE INDEX idx_cal_occurrence_deleted_at ON cal_occurrence(deleted_at);

-- CardDAV search helpers.
CREATE TABLE card_index (
  entity_id UUID PRIMARY KEY REFERENCES dav_entity(id) ON DELETE CASCADE,
  uid TEXT,
  fn TEXT,
  n_family TEXT,
  n_given TEXT,
  org TEXT,
  title TEXT,
  search_tsv TSVECTOR,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

SELECT diesel_manage_updated_at('card_index');

COMMENT ON TABLE card_index IS 'Derived index for CardDAV queries (FN, UID, text search)';
COMMENT ON COLUMN card_index.entity_id IS 'Canonical entity';

CREATE INDEX idx_card_index_uid ON card_index(uid);
CREATE INDEX idx_card_index_search_tsv ON card_index USING GIN (search_tsv);
CREATE INDEX idx_card_index_deleted_at ON card_index(deleted_at);

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

COMMENT ON TABLE card_email IS 'Derived index of vCard email addresses';
COMMENT ON COLUMN card_email.id IS 'UUID v7 primary key';

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

COMMENT ON TABLE card_phone IS 'Derived index of vCard phone numbers';
COMMENT ON COLUMN card_phone.id IS 'UUID v7 primary key';

CREATE INDEX idx_card_phone_norm ON card_phone(phone_norm);
CREATE INDEX idx_card_phone_entity ON card_phone(entity_id);
CREATE INDEX idx_card_phone_deleted_at ON card_phone(deleted_at);

-- Enforce instance/entity type compatibility via app logic or optional trigger.
