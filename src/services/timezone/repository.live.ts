import { eq, sql } from "drizzle-orm";
import { Effect, Layer, Metric, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { calTimezone } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { repoQueryDurationMs } from "#src/observability/metrics.ts";
import { CalTimezoneRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// CalTimezoneRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const tzDuration = repoQueryDurationMs.pipe(
	Metric.tagged("repo.entity", "timezone"),
);

const findByTzid = Effect.fn("CalTimezoneRepository.findByTzid")(
	function* (db: DbClient, tzid: string) {
		yield* Effect.annotateCurrentSpan({ "tz.tzid": tzid });
		yield* Effect.logTrace("repo.timezone.findByTzid", { tzid });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(calTimezone)
					.where(eq(calTimezone.tzid, tzid))
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				tzDuration.pipe(Metric.tagged("repo.operation", "findByTzid")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.timezone.findByTzid failed", e.cause),
	),
);

const upsert = Effect.fn("CalTimezoneRepository.upsert")(
	function* (
		db: DbClient,
		tzid: string,
		vtimezoneData: string,
		ianaName: Option.Option<string>,
		lastModified: Option.Option<Temporal.Instant>,
	) {
		yield* Effect.annotateCurrentSpan({ "tz.tzid": tzid });
		yield* Effect.logTrace("repo.timezone.upsert", {
			tzid,
			hasIanaName: Option.isSome(ianaName),
			hasLastModified: Option.isSome(lastModified),
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(calTimezone)
					.values({
						tzid,
						vtimezoneData,
						ianaName: Option.getOrNull(ianaName),
						// Use sql cast to avoid temporal-polyfill vs temporal-spec type conflict.
						// The custom type's toDriver (Instant → ISO string) is bypassed here;
						// we perform the same conversion manually and let PG parse it.
						lastModifiedAt: Option.match(lastModified, {
							onNone: () => null,
							onSome: (inst) => sql`${inst.toString()}::timestamptz`,
						}),
					})
					.onConflictDoUpdate({
						target: calTimezone.tzid,
						// RFC 5545 §3.6.5: only overwrite vtimezoneData when the incoming
						// LAST-MODIFIED is absent (recency unknown) or ≥ the stored value.
						// This prevents a stale client-sent VTIMEZONE from clobbering a
						// more recent definition that another client already stored.
						set: {
							vtimezoneData: sql`CASE
								WHEN excluded.last_modified_at IS NULL
								  OR cal_timezone.last_modified_at IS NULL
								  OR excluded.last_modified_at >= cal_timezone.last_modified_at
								THEN excluded.vtimezone_data
								ELSE cal_timezone.vtimezone_data
							END`,
							// GREATEST ignores NULLs, so whichever side has a timestamp wins;
							// if both are NULL the column stays NULL.
							lastModifiedAt: sql`GREATEST(excluded.last_modified_at, cal_timezone.last_modified_at)`,
							// Only overwrite ianaName when a value is explicitly provided;
							// Option.none() preserves whatever was previously resolved.
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
		}).pipe(
			Metric.trackDuration(
				tzDuration.pipe(Metric.tagged("repo.operation", "upsert")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.timezone.upsert failed", e.cause),
	),
);

export const CalTimezoneRepositoryLive = Layer.effect(
	CalTimezoneRepository,
	Effect.map(DatabaseClient, (db) =>
		CalTimezoneRepository.of({
			findByTzid: (tzid) => findByTzid(db, tzid),
			upsert: (tzid, vtimezoneData, ianaName, lastModified) =>
				upsert(db, tzid, vtimezoneData, ianaName, lastModified),
		}),
	),
);
