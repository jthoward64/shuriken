// ---------------------------------------------------------------------------
// Seed script configuration — all knobs read from env vars so a smoke test
// (a handful of users) and the full 250-user run use the same script.
// ---------------------------------------------------------------------------

const int = (name: string, fallback: number): number => {
	const raw = Deno.env.get(name);
	if (raw === undefined || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? fallback : parsed;
};

const float = (name: string, fallback: number): number => {
	const raw = Deno.env.get(name);
	if (raw === undefined || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number.parseFloat(raw);
	return Number.isNaN(parsed) ? fallback : parsed;
};

export interface SeedConfig {
	readonly users: number;
	readonly eventsPerUser: number;
	readonly contactsPerUser: number;
	readonly calendarsPerUserMin: number;
	readonly calendarsPerUserMax: number;
	readonly addressBooksPerUserMin: number;
	readonly addressBooksPerUserMax: number;
	readonly smallGroups: number;
	readonly mediumGroups: number;
	readonly largeGroups: number;
	readonly directShareFraction: number;
	readonly shareLinkFraction: number;
	readonly concurrency: number;
	readonly batchSize: number;
}

// Defaults match the requested full-scale run; override via env for a
// smoke test (see the SEED_USERS=3-style invocation in the plan notes).
const DEFAULT_USERS = 250;
const DEFAULT_EVENTS_PER_USER = 5000;
const DEFAULT_CONTACTS_PER_USER = 1000;
const DEFAULT_CALENDARS_PER_USER_MIN = 0;
const DEFAULT_CALENDARS_PER_USER_MAX = 4;
const DEFAULT_ADDRESSBOOKS_PER_USER_MIN = 0;
const DEFAULT_ADDRESSBOOKS_PER_USER_MAX = 2;
const DEFAULT_SMALL_GROUPS = 30;
const DEFAULT_MEDIUM_GROUPS = 10;
const DEFAULT_LARGE_GROUPS = 3;
const DEFAULT_DIRECT_SHARE_FRACTION = 0.3;
const DEFAULT_SHARE_LINK_FRACTION = 0.1;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_BATCH_SIZE = 500;

export const loadSeedConfig = (): SeedConfig => ({
	users: int("SEED_USERS", DEFAULT_USERS),
	eventsPerUser: int("SEED_EVENTS_PER_USER", DEFAULT_EVENTS_PER_USER),
	contactsPerUser: int("SEED_CONTACTS_PER_USER", DEFAULT_CONTACTS_PER_USER),
	calendarsPerUserMin: int(
		"SEED_CALENDARS_PER_USER_MIN",
		DEFAULT_CALENDARS_PER_USER_MIN,
	),
	calendarsPerUserMax: int(
		"SEED_CALENDARS_PER_USER_MAX",
		DEFAULT_CALENDARS_PER_USER_MAX,
	),
	addressBooksPerUserMin: int(
		"SEED_ADDRESSBOOKS_PER_USER_MIN",
		DEFAULT_ADDRESSBOOKS_PER_USER_MIN,
	),
	addressBooksPerUserMax: int(
		"SEED_ADDRESSBOOKS_PER_USER_MAX",
		DEFAULT_ADDRESSBOOKS_PER_USER_MAX,
	),
	smallGroups: int("SEED_SMALL_GROUPS", DEFAULT_SMALL_GROUPS),
	mediumGroups: int("SEED_MEDIUM_GROUPS", DEFAULT_MEDIUM_GROUPS),
	largeGroups: int("SEED_LARGE_GROUPS", DEFAULT_LARGE_GROUPS),
	directShareFraction: float(
		"SEED_DIRECT_SHARE_FRACTION",
		DEFAULT_DIRECT_SHARE_FRACTION,
	),
	shareLinkFraction: float(
		"SEED_SHARE_LINK_FRACTION",
		DEFAULT_SHARE_LINK_FRACTION,
	),
	concurrency: int("SEED_CONCURRENCY", DEFAULT_CONCURRENCY),
	batchSize: int("SEED_BATCH_SIZE", DEFAULT_BATCH_SIZE),
});
