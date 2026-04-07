-- ---------------------------------------------------------------------------
-- Sync token trigger
--
-- Fires BEFORE every INSERT or UPDATE on dav_instance.
-- Increments dav_collection.synctoken atomically and sets sync_revision on
-- the instance row to the new token value.
-- On soft-delete (deleted_at going NULL → non-NULL) also inserts a tombstone
-- into dav_tombstone for RFC 6578 delta-sync support.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sync_token_on_instance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_synctoken BIGINT;
BEGIN
    -- Atomically increment collection synctoken and capture new value
    UPDATE dav_collection
    SET synctoken = synctoken + 1
    WHERE id = NEW.collection_id
    RETURNING synctoken INTO v_new_synctoken;

    -- Assign collection-scoped revision to this instance row
    NEW.sync_revision := v_new_synctoken;

    -- On soft-delete: create tombstone for sync-collection REPORT consumers
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        INSERT INTO dav_tombstone (
            collection_id,
            entity_id,
            synctoken,
            sync_revision,
            last_etag,
            logical_uid,
            uri_variants
        )
        SELECT
            OLD.collection_id,
            OLD.entity_id,
            v_new_synctoken,
            v_new_synctoken,
            OLD.etag,
            e.logical_uid,
            ARRAY[OLD.slug, OLD.id::text]
        FROM dav_entity e
        WHERE e.id = OLD.entity_id;
    END IF;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER sync_token_before_instance_change
BEFORE INSERT OR UPDATE ON dav_instance
FOR EACH ROW EXECUTE FUNCTION sync_token_on_instance_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- cal_index maintenance trigger
--
-- Fires AFTER every INSERT or UPDATE on dav_instance.
-- Rebuilds the cal_index rows for the entity from the current component tree.
--
-- DTSTART / DTEND mapping:
--   DATE_TIME       → value_tstz (already UTC; ZonedDateTime stored by codec)
--   DATE            → value_date cast to UTC midnight timestamptz, all_day = true
--   PLAIN_DATE_TIME → NULL (floating, no timezone context available in trigger)
--
-- NOTE: Events with rrule_text always pass time-range filters in
-- CalIndexRepository.findByTimeRange (conservative behavior). Full recurrence
-- expansion is deferred.
-- TODO(recurrence): expand rrule_text for accurate overlap when implemented.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION maintain_cal_index_on_instance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_entity_id UUID;
    v_entity_type TEXT;
BEGIN
    v_entity_id := COALESCE(NEW.entity_id, OLD.entity_id);

    SELECT entity_type INTO v_entity_type
    FROM dav_entity WHERE id = v_entity_id;

    IF v_entity_type IS DISTINCT FROM 'icalendar' THEN
        RETURN NEW;
    END IF;

    -- Remove stale index entries for this entity
    DELETE FROM cal_index WHERE entity_id = v_entity_id;

    -- Skip re-indexing if instance is soft-deleted
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Rebuild from current non-deleted component tree
    INSERT INTO cal_index (
        entity_id,
        component_id,
        component_type,
        uid,
        dtstart_utc,
        dtend_utc,
        all_day,
        rrule_text,
        metadata
    )
    SELECT
        comp.entity_id,
        comp.id,
        comp.name,
        uid_prop.value_text,
        CASE
            WHEN dtstart_prop.value_type = 'DATE_TIME' THEN dtstart_prop.value_tstz
            WHEN dtstart_prop.value_type = 'DATE'
                THEN (dtstart_prop.value_date || 'T00:00:00Z')::timestamptz
            ELSE NULL
        END,
        CASE
            WHEN dtend_prop.value_type = 'DATE_TIME' THEN dtend_prop.value_tstz
            WHEN dtend_prop.value_type = 'DATE'
                THEN (dtend_prop.value_date || 'T00:00:00Z')::timestamptz
            ELSE NULL
        END,
        (dtstart_prop.value_type = 'DATE'),
        rrule_prop.value_text,
        jsonb_build_object(
            'summary',     summary_prop.value_text,
            'location',    location_prop.value_text,
            'description', description_prop.value_text
        )
    FROM dav_component comp
    LEFT JOIN dav_property uid_prop
        ON uid_prop.component_id = comp.id
        AND uid_prop.name = 'UID'
        AND uid_prop.deleted_at IS NULL
    LEFT JOIN dav_property dtstart_prop
        ON dtstart_prop.component_id = comp.id
        AND dtstart_prop.name = 'DTSTART'
        AND dtstart_prop.deleted_at IS NULL
    LEFT JOIN dav_property dtend_prop
        ON dtend_prop.component_id = comp.id
        AND dtend_prop.name = 'DTEND'
        AND dtend_prop.deleted_at IS NULL
    LEFT JOIN dav_property rrule_prop
        ON rrule_prop.component_id = comp.id
        AND rrule_prop.name = 'RRULE'
        AND rrule_prop.deleted_at IS NULL
    LEFT JOIN dav_property summary_prop
        ON summary_prop.component_id = comp.id
        AND summary_prop.name = 'SUMMARY'
        AND summary_prop.deleted_at IS NULL
    LEFT JOIN dav_property location_prop
        ON location_prop.component_id = comp.id
        AND location_prop.name = 'LOCATION'
        AND location_prop.deleted_at IS NULL
    LEFT JOIN dav_property description_prop
        ON description_prop.component_id = comp.id
        AND description_prop.name = 'DESCRIPTION'
        AND description_prop.deleted_at IS NULL
    WHERE comp.entity_id = v_entity_id
      AND comp.name IN ('VEVENT', 'VTODO', 'VJOURNAL', 'VFREEBUSY')
      AND comp.deleted_at IS NULL;

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER cal_index_after_instance_change
AFTER INSERT OR UPDATE ON dav_instance
FOR EACH ROW EXECUTE FUNCTION maintain_cal_index_on_instance_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- card_index maintenance trigger
--
-- Fires AFTER every INSERT or UPDATE on dav_instance.
-- Rebuilds the card_index row for the entity from the VCARD component tree.
--
-- The `data` JSONB column is used for case-insensitive property matching via
-- generated columns (data_ascii_fold, data_unicode_fold).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION maintain_card_index_on_instance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_entity_id UUID;
    v_entity_type TEXT;
    v_comp_id UUID;
    v_uid TEXT;
    v_fn TEXT;
    v_n_raw TEXT;
    v_n_parts TEXT[];
    v_org TEXT;
    v_title TEXT;
    v_emails JSONB;
    v_phones JSONB;
BEGIN
    v_entity_id := COALESCE(NEW.entity_id, OLD.entity_id);

    SELECT entity_type INTO v_entity_type
    FROM dav_entity WHERE id = v_entity_id;

    IF v_entity_type IS DISTINCT FROM 'vcard' THEN
        RETURN NEW;
    END IF;

    -- Remove stale index entry
    DELETE FROM card_index WHERE entity_id = v_entity_id;

    -- Skip re-indexing if soft-deleted
    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Find the VCARD root component
    SELECT id INTO v_comp_id
    FROM dav_component
    WHERE entity_id = v_entity_id AND name = 'VCARD' AND deleted_at IS NULL
    LIMIT 1;

    IF v_comp_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Extract scalar properties
    SELECT value_text INTO v_uid FROM dav_property
    WHERE component_id = v_comp_id AND name = 'UID' AND deleted_at IS NULL LIMIT 1;

    SELECT value_text INTO v_fn FROM dav_property
    WHERE component_id = v_comp_id AND name = 'FN' AND deleted_at IS NULL LIMIT 1;

    SELECT value_text INTO v_n_raw FROM dav_property
    WHERE component_id = v_comp_id AND name = 'N' AND deleted_at IS NULL LIMIT 1;

    SELECT value_text INTO v_org FROM dav_property
    WHERE component_id = v_comp_id AND name = 'ORG' AND deleted_at IS NULL LIMIT 1;

    SELECT value_text INTO v_title FROM dav_property
    WHERE component_id = v_comp_id AND name = 'TITLE' AND deleted_at IS NULL LIMIT 1;

    -- Parse N: "Family;Given;..." → [family, given]
    IF v_n_raw IS NOT NULL THEN
        v_n_parts := string_to_array(v_n_raw, ';');
    END IF;

    -- Aggregate multi-value properties
    SELECT COALESCE(jsonb_agg(value_text ORDER BY ordinal), '[]'::jsonb) INTO v_emails
    FROM dav_property
    WHERE component_id = v_comp_id AND name = 'EMAIL' AND deleted_at IS NULL;

    SELECT COALESCE(jsonb_agg(value_text ORDER BY ordinal), '[]'::jsonb) INTO v_phones
    FROM dav_property
    WHERE component_id = v_comp_id AND name = 'TEL' AND deleted_at IS NULL;

    INSERT INTO card_index (entity_id, uid, fn, data)
    VALUES (
        v_entity_id,
        v_uid,
        v_fn,
        jsonb_build_object(
            'n_family',  COALESCE(v_n_parts[1], ''),
            'n_given',   COALESCE(v_n_parts[2], ''),
            'org',       COALESCE(v_org, ''),
            'title',     COALESCE(v_title, ''),
            'emails',    v_emails,
            'phones',    v_phones
        )
    );

    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER card_index_after_instance_change
AFTER INSERT OR UPDATE ON dav_instance
FOR EACH ROW EXECUTE FUNCTION maintain_card_index_on_instance_change();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Wire up the existing card_index tsvector update trigger (function defined in
-- the functions migration but not yet activated).
-- ---------------------------------------------------------------------------

CREATE TRIGGER update_card_index_search_tsv
BEFORE INSERT OR UPDATE ON card_index
FOR EACH ROW EXECUTE FUNCTION update_card_index_search_tsv();
