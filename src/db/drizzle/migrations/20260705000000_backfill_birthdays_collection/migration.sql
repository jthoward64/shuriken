-- ---------------------------------------------------------------------------
-- Backfill the auto-managed "Birthdays" calendar for every user principal
-- that predates the birthday feature (provisioning only creates it for new
-- users — see src/services/provisioning/service.live.ts). The scheduler
-- sweep (BirthdaySchedulerLayer) picks up any collection with
-- auto_managed_kind = 'birthdays' and populates it on its next tick, so this
-- migration only needs to create the empty collection.
-- ---------------------------------------------------------------------------

INSERT INTO dav_collection (
	owner_principal_id,
	collection_type,
	slug,
	display_name,
	supported_components,
	auto_managed_kind,
	sort_order
)
SELECT
	p.id,
	'calendar',
	'birthdays',
	'Birthdays',
	ARRAY['VEVENT'],
	'birthdays',
	1000
FROM principal p
WHERE p.principal_type = 'user'
	AND p.deleted_at IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM dav_collection c
		WHERE c.owner_principal_id = p.id
			AND c.collection_type = 'calendar'
			AND c.auto_managed_kind = 'birthdays'
			AND c.deleted_at IS NULL
	);
