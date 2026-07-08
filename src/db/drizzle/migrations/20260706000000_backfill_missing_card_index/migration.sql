-- ---------------------------------------------------------------------------
-- Every prior "extend the card_index trigger" migration (BDAY, has_photo)
-- backfilled existing card_index rows by touching dav_instance.updated_at
-- for instances that already had one (JOIN card_index ON entity_id). That
-- misses any active vCard instance that never got an initial card_index row
-- at all — e.g. one written before the card_index table/trigger existed in
-- this deployment. Those contacts are invisible to the entire card_index
-- feature (search, list, and BDAY-driven birthday generation), no matter how
-- many times later migrations or BirthdayService.regenerate run, since none
-- of them create a *first* row for an entity that has never had one.
--
-- Force a re-touch for every active vCard instance lacking a card_index row
-- so `card_index_after_instance_change` fires and creates it via the current
-- trigger function (which already covers uid/fn/n/org/title/bday/has_photo/
-- emails/phones). On a deployment where every contact was already indexed,
-- this is a no-op.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT i.id
        FROM dav_instance i
        JOIN dav_entity e ON e.id = i.entity_id
        WHERE i.deleted_at IS NULL
            AND e.entity_type = 'vcard'
            AND NOT EXISTS (
                SELECT 1 FROM card_index ci WHERE ci.entity_id = i.entity_id
            )
    LOOP
        UPDATE dav_instance SET updated_at = now() WHERE id = r.id;
    END LOOP;
END $$;
