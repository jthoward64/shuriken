-- ---------------------------------------------------------------------------
-- Extend the card_index trigger to also record whether the vCard carries a
-- PHOTO property, as data->>'has_photo' (a JSON boolean).
--
-- The contacts list UI needs a cheap "does this contact have a picture?" bit
-- so it can decide whether to emit an <img> (served lazily by the per-contact
-- photo endpoint) or a text/initials placeholder — without reloading every
-- vCard component tree to look for a PHOTO.
--
-- We deliberately index only the *presence* of a photo, not its bytes: PHOTO
-- values are frequently large base64 data: URIs, and inlining them into the
-- index (or the list HTML) would bloat both. The actual bytes are streamed on
-- demand by GET /ui/contacts/<id>/photo, which loads the tree only when a
-- browser requests the image.
--
-- Presence is computed here (in SQL) rather than in application code so that it
-- stays correct across *every* write path — including external CalDAV clients
-- that set a photo via DAV PUT, which never touch the web UI.
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
    v_bday_raw TEXT;
    v_bday TEXT;
    v_has_photo BOOLEAN;
    v_emails JSONB;
    v_phones JSONB;
BEGIN
    v_entity_id := COALESCE(NEW.entity_id, OLD.entity_id);

    SELECT entity_type INTO v_entity_type
    FROM dav_entity WHERE id = v_entity_id;

    IF v_entity_type IS DISTINCT FROM 'vcard' THEN
        RETURN NEW;
    END IF;

    DELETE FROM card_index WHERE entity_id = v_entity_id;

    IF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT id INTO v_comp_id
    FROM dav_component
    WHERE entity_id = v_entity_id AND name = 'VCARD' AND deleted_at IS NULL
    LIMIT 1;

    IF v_comp_id IS NULL THEN
        RETURN NEW;
    END IF;

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

    -- BDAY may land in value_text (partial dates like "--MM-DD", date-times,
    -- raw strings) or in value_date (full ISO dates that decoded cleanly).
    -- Coalesce both, casting value_date back to text for normalisation.
    SELECT COALESCE(value_text, to_char(value_date, 'YYYY-MM-DD'))
    INTO v_bday_raw
    FROM dav_property
    WHERE component_id = v_comp_id AND name = 'BDAY' AND deleted_at IS NULL LIMIT 1;

    -- Normalise BDAY to a canonical form. Substring slicing keeps this
    -- pure SQL — no regex backtracking.
    IF v_bday_raw IS NULL OR v_bday_raw = '' THEN
        v_bday := NULL;
    ELSIF v_bday_raw ~ '^\d{8}$' THEN
        v_bday := substr(v_bday_raw, 1, 4) || '-' ||
                  substr(v_bday_raw, 5, 2) || '-' ||
                  substr(v_bday_raw, 7, 2);
    ELSIF v_bday_raw ~ '^\d{4}-\d{2}-\d{2}' THEN
        v_bday := substr(v_bday_raw, 1, 10);
    ELSIF v_bday_raw ~ '^--\d{4}$' THEN
        v_bday := '--' || substr(v_bday_raw, 3, 2) || '-' || substr(v_bday_raw, 5, 2);
    ELSIF v_bday_raw ~ '^--\d{2}-\d{2}$' THEN
        v_bday := v_bday_raw;
    ELSE
        v_bday := lower(v_bday_raw);
    END IF;

    -- Presence-only photo flag: true iff a live PHOTO property exists. We never
    -- read the value (it may be a multi-hundred-KB base64 data: URI).
    SELECT EXISTS(
        SELECT 1 FROM dav_property
        WHERE component_id = v_comp_id AND name = 'PHOTO' AND deleted_at IS NULL
    ) INTO v_has_photo;

    IF v_n_raw IS NOT NULL THEN
        v_n_parts := string_to_array(v_n_raw, ';');
    END IF;

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
            'bday',      v_bday,
            'has_photo', v_has_photo,
            'emails',    v_emails,
            'phones',    v_phones
        )
    );

    RETURN NEW;
END;
$$;
--> statement-breakpoint

-- Backfill has_photo for existing card_index rows by replaying the trigger on
-- each vCard's most-recent live instance. On a fresh DB this is a no-op.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT i.id
        FROM dav_instance i
        JOIN card_index ci ON ci.entity_id = i.entity_id
        WHERE i.deleted_at IS NULL
    LOOP
        UPDATE dav_instance SET updated_at = now() WHERE id = r.id;
    END LOOP;
END $$;
