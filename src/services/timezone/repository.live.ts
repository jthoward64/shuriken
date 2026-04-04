import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { calTimezone } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import {
	CalTimezoneRepository,
	type CalTimezoneRow,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// CalTimezoneRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findByTzid = (db: DbClient, tzid: string) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(calTimezone)
				.where(eq(calTimezone.tzid, tzid))
				.limit(1)
				.then((r) => Option.fromNullable(r[0] as CalTimezoneRow | undefined)),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const upsert = (
	db: DbClient,
	tzid: string,
	vtimezoneData: string,
	ianaName: Option.Option<string>,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.insert(calTimezone)
				.values({
					tzid,
					vtimezoneData,
					ianaName: Option.getOrNull(ianaName),
				})
				.onConflictDoUpdate({
					target: calTimezone.tzid,
					// Only overwrite ianaName when a value is explicitly provided;
					// Option.none() preserves whatever was previously stored.
					set: {
						vtimezoneData,
						...(Option.isSome(ianaName) ? { ianaName: ianaName.value } : {}),
						updatedAt: sql`now()`,
					},
				})
				.returning()
				.then((rows) => {
					const row = rows[0];
					if (!row) {
						throw new Error("cal_timezone upsert returned no rows");
					}
					return row;
				}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

export const CalTimezoneRepositoryLive = Layer.effect(
	CalTimezoneRepository,
	Effect.map(DatabaseClient, (db) =>
		CalTimezoneRepository.of({
			findByTzid: (tzid) => findByTzid(db, tzid),
			upsert: (tzid, vtimezoneData, ianaName) =>
				upsert(db, tzid, vtimezoneData, ianaName),
		}),
	),
);
