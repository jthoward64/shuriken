import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CalTimezoneRow } from "#src/services/timezone/index.ts";
import type { CalTimezoneRepositoryShape } from "#src/services/timezone/repository.ts";
import type { TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory CalIndexRepository and CalTimezoneRepository
// ---------------------------------------------------------------------------

// No-op: unit tests don't exercise the RRULE index path.
export const makeCalIndexRepo = (): typeof CalIndexRepository.Service => ({
	findByTimeRange: () => Effect.succeed([]),
	findByComponentType: () => Effect.succeed([]),
	findOverlappingRange: () => Effect.succeed([]),
	indexRruleOccurrences: () => Effect.void,
});

export const makeCalTimezoneRepo = (
	stores: TestStores,
): CalTimezoneRepositoryShape => ({
	findByTzid: (tzid) =>
		Effect.succeed(Option.fromNullishOr(stores.calTimezones.get(tzid))),

	upsert: (tzid, vtimezoneData, ianaName, lastModified) =>
		Effect.sync(() => {
			const existing = stores.calTimezones.get(tzid);
			const now = Temporal.Now.instant();
			const row: CalTimezoneRow = {
				id: existing?.id ?? crypto.randomUUID(),
				tzid,
				vtimezoneData,
				ianaName: Option.getOrNull(ianaName),
				lastModifiedAt: Option.getOrNull(lastModified),
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			};
			stores.calTimezones.set(tzid, row);
			return row;
		}),
});
