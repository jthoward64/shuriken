// ---------------------------------------------------------------------------
// db-seed — populate the database with a large, realistic fake dataset:
// users (basic auth + one app password each), personal calendars/
// addressbooks full of events/contacts, groups of varying size, and
// group/direct/share-link sharing.
//
// Assumes a fresh, already-migrated DB (`deno task db:reset && deno task
// migrations:run`) — this script is purely additive. All scale knobs are
// env vars (see scripts/seed/config.ts); a small SEED_USERS=3-style
// invocation is a good smoke test before committing to the full run.
//
// Reuses the same Effect services real requests go through
// (ProvisioningService, GroupService, CollectionService, importIcs/
// importVcf, …) rather than writing a parallel bulk-SQL path — see
// scripts/seed/layer.ts for the lean layer composition this implies.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { loadSeedConfig } from "./seed/config.ts";
import { seedContacts } from "./seed/contacts.ts";
import { seedEvents } from "./seed/events.ts";
import {
	buildGroupSizePlan,
	seedGroup,
	shouldSeedAddressbook,
} from "./seed/groups.ts";
import { SeedLayer } from "./seed/layer.ts";
import { chance, intBetween, weightedSplit } from "./seed/random.ts";
import { seedDirectShare, seedShareLink } from "./seed/sharing.ts";
import { type SeededUser, seedUser } from "./seed/users.ts";

const config = loadSeedConfig();

const seedOneUser = (index: number) =>
	Effect.gen(function* () {
		const user = yield* seedUser(
			index,
			config.calendarsPerUserMin,
			config.calendarsPerUserMax,
			config.addressBooksPerUserMin,
			config.addressBooksPerUserMax,
		);

		const eventSplits = weightedSplit(
			config.eventsPerUser,
			user.calendarIds.length,
		);
		yield* Effect.forEach(user.calendarIds, (calendarId, i) =>
			seedEvents(calendarId, eventSplits[i] ?? 0, config.batchSize),
		);

		const contactSplits = weightedSplit(
			config.contactsPerUser,
			user.addressBookIds.length,
		);
		yield* Effect.forEach(user.addressBookIds, (addressBookId, i) =>
			seedContacts(addressBookId, contactSplits[i] ?? 0, config.batchSize),
		);

		yield* Effect.logInfo(
			`seed: user ${index + 1}/${config.users} provisioned`,
			{
				email: user.email,
				calendars: user.calendarIds.length,
				addressBooks: user.addressBookIds.length,
			},
		);
		return user;
	});

const program = Effect.gen(function* () {
	const startedAt = Temporal.Now.instant();
	yield* Effect.logInfo("seed: starting", { ...config });

	const users: ReadonlyArray<SeededUser> = yield* Effect.forEach(
		Array.from({ length: config.users }, (_, i) => i),
		seedOneUser,
		{ concurrency: config.concurrency },
	);

	const sizePlan = buildGroupSizePlan(
		config.smallGroups,
		config.mediumGroups,
		config.largeGroups,
	);
	yield* Effect.forEach(
		sizePlan,
		(spec, i) =>
			seedGroup(
				i,
				intBetween(spec.min, spec.max),
				shouldSeedAddressbook(i, config.smallGroups),
				config.batchSize,
				users,
			).pipe(
				Effect.tap(() =>
					Effect.logInfo(`seed: group ${i + 1}/${sizePlan.length} done`),
				),
			),
		{ concurrency: config.concurrency },
	);

	yield* Effect.forEach(
		users,
		(user) =>
			Effect.gen(function* () {
				if (chance(config.directShareFraction)) {
					yield* seedDirectShare(user, users);
				}
				if (chance(config.shareLinkFraction)) {
					yield* seedShareLink(user);
				}
			}),
		{ concurrency: config.concurrency },
	);

	const durationSeconds = startedAt.until(Temporal.Now.instant()).total({
		unit: "seconds",
	});
	yield* Effect.logInfo("seed: complete", {
		users: users.length,
		groups: sizePlan.length,
		eventsPerUser: config.eventsPerUser,
		contactsPerUser: config.contactsPerUser,
		durationSeconds: Math.round(durationSeconds),
	});
});

Effect.runPromise(program.pipe(Effect.provide(SeedLayer))).catch((err) => {
	console.error("seed: failed", err);
	Deno.exit(1);
});
