import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	type UuidString,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import {
	HTTP_BAD_REQUEST,
	HTTP_NOT_MODIFIED,
	HTTP_OK,
} from "#src/http/status.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { ExternalCalendarRepository } from "./repository.ts";
import { ExternalCalendarSyncService } from "./sync.ts";

// ---------------------------------------------------------------------------
// ExternalCalendarSyncServiceLive — fetch → parse → per-claim reconcile.
//
// Network and parse work happens once per URL; per-claim writes follow. We
// don't dedup events across claims at the row level (each claim's collection
// holds its own copies) — that's a future optimisation. The fetch+parse
// dedup is what the user explicitly cared about.
// ---------------------------------------------------------------------------

const SCHEDULING_COMPONENTS: ReadonlySet<string> = new Set([
	"VEVENT",
	"VTODO",
	"VJOURNAL",
	"VFREEBUSY",
]);

interface ParsedEvent {
	readonly uid: string;
	/** Raw IrComponents (master + any RECURRENCE-ID overrides) sharing this UID. */
	readonly components: ReadonlyArray<IrComponent>;
}

/**
 * Group the feed's VEVENT/VTODO/VJOURNAL components by UID. Each group becomes
 * one calendar-object-resource (one dav_entity) with its master + overrides.
 * Components without a TEXT UID property are skipped (would fail validation).
 */
const groupByUid = (doc: IrDocument): ReadonlyArray<ParsedEvent> => {
	const groups = new Map<string, Array<IrComponent>>();
	for (const c of doc.root.components) {
		if (!SCHEDULING_COMPONENTS.has(c.name)) {
			continue;
		}
		const uidProp = c.properties.find((p) => p.name === "UID");
		if (!uidProp || uidProp.value.type !== "TEXT") {
			continue;
		}
		const list = groups.get(uidProp.value.value) ?? [];
		list.push(c);
		groups.set(uidProp.value.value, list);
	}
	return [...groups.entries()].map(([uid, components]) => ({
		uid,
		components,
	}));
};

/** Build a single-UID VCALENDAR sub-document, preserving the feed's VTIMEZONEs. */
const buildSubVcalendar = (
	root: IrComponent,
	event: ParsedEvent,
): IrComponent => ({
	...root,
	components: [
		...root.components.filter((c) => c.name === "VTIMEZONE"),
		...event.components,
	],
});

/** Extract a non-empty TEXT property value from VCALENDAR (e.g. X-WR-CALNAME). */
const extractCalProp = (root: IrComponent, name: string): string | undefined => {
	const prop = root.properties.find((p) => p.name === name);
	if (!prop || prop.value.type !== "TEXT") {
		return undefined;
	}
	const v = prop.value.value;
	return v === "" ? undefined : v;
};

// Slug grammar (see `domain/types/path.ts`) caps at 128 chars and bans
// whitespace / structural chars. Truncate so the trailing `.ics` extension
// still fits inside the cap.
const SLUG_MAX_BODY = 120;
const HASH_MULTIPLIER = 31;
const HEX_RADIX = 16;
const U32_MASK = 0xff_ff_ff_ff;

const sanitizeSlug = (uid: string): Slug => {
	// Map any character outside our slug regex into `_`. Keeps the slug
	// deterministic so subsequent syncs find the same row.
	const replaced = uid.replace(/[^A-Za-z0-9._-]/g, "_");
	const trimmed = replaced.replace(/^[.]+|[.]+$/g, "");
	const truncated =
		trimmed.length > SLUG_MAX_BODY ? trimmed.slice(0, SLUG_MAX_BODY) : trimmed;
	if (truncated.length === 0) {
		// Sanitisation produced an empty string (e.g. UID was all-`.`).
		// Fall back to a deterministic hash so the same UID still maps to one slug.
		const hex = (
			[...uid].reduce(
				(h, ch) => ((h * HASH_MULTIPLIER + ch.charCodeAt(0)) & U32_MASK) >>> 0,
				0,
			) >>> 0
		).toString(HEX_RADIX);
		return Slug(`uid-${hex}`);
	}
	return Slug(`${truncated}.ics`);
};

// Clark-notation key for Apple's calendar-color dead property — hoisted to
// module scope so it satisfies the project's naming convention for constants.
const APPLE_CAL_COLOR = "{http://apple.com/ns/ical/}calendar-color";

/**
 * Apply Policy B metadata to one claim's local collection: write
 * `displayname` and the Apple `calendar-color` dead prop so PROPFIND reflects
 * the effective value (`override ?? feed default`). Idempotent — only writes
 * when at least one of the two fields actually differs from current row state.
 */
const applyClaimMetadata = (
	collSvc: ReturnType<typeof CollectionService.of>,
	collectionId: CollectionId,
	displayname: string | null,
	color: string | null,
): Effect.Effect<void, DatabaseError | DavError> =>
	Effect.gen(function* () {
		const row: CollectionRow = yield* collSvc.findById(collectionId);
		const currentDead =
			(row.clientProperties as Record<string, unknown> | null) ?? {};
		const currentColor =
			typeof currentDead[APPLE_CAL_COLOR] === "string"
				? (currentDead[APPLE_CAL_COLOR] as string)
				: null;
		const displaynameChanged = row.displayName !== displayname;
		const colorChanged = currentColor !== color;
		if (!displaynameChanged && !colorChanged) {
			return;
		}
		const nextDead: Record<string, unknown> = { ...currentDead };
		if (color === null) {
			delete nextDead[APPLE_CAL_COLOR];
		} else {
			nextDead[APPLE_CAL_COLOR] = color;
		}
		yield* collSvc.updateProperties(collectionId, {
			displayName: displaynameChanged ? displayname : undefined,
			clientProperties: nextDead,
		});
	});

interface SyncDependencies {
	readonly repo: ReturnType<typeof ExternalCalendarRepository.of>;
	readonly entityRepo: ReturnType<typeof EntityRepository.of>;
	readonly componentRepo: ReturnType<typeof ComponentRepository.of>;
	readonly instanceSvc: ReturnType<typeof InstanceService.of>;
	readonly db: DatabaseClient;
}

/**
 * Reconcile one claim's collection against the parsed feed. New UIDs are
 * inserted; existing UIDs have their component trees + etag replaced; UIDs
 * present locally but not in the feed are soft-deleted.
 */
const reconcileClaim = (
	deps: SyncDependencies,
	collectionId: CollectionId,
	rootForVtimezones: IrComponent,
	events: ReadonlyArray<ParsedEvent>,
): Effect.Effect<void, DatabaseError | DavError> =>
	Effect.gen(function* () {
		const existing = yield* deps.entityRepo.listActiveInstancesWithUid(
			collectionId,
		);
		const existingByUid = new Map(
			existing
				.filter((r) => r.logicalUid !== null)
				.map((r) => [r.logicalUid as string, r] as const),
		);
		const feedUids = new Set(events.map((e) => e.uid));

		for (const event of events) {
			const subDoc: IrDocument = {
				kind: "icalendar",
				root: buildSubVcalendar(rootForVtimezones, event),
			};
			const canonical = yield* encodeICalendar(subDoc);
			const etag = ETag(yield* makeEtag(canonical));
			const slug = sanitizeSlug(event.uid);
			const contentLength = new TextEncoder().encode(canonical).byteLength;

			const prev = existingByUid.get(event.uid);
			if (prev === undefined) {
				// New event — insert entity + tree + instance atomically.
				yield* withTransaction(
					Effect.gen(function* () {
						const entityRow = yield* deps.entityRepo.insert({
							entityType: "icalendar",
							logicalUid: event.uid,
						});
						yield* deps.componentRepo.insertTree(
							EntityId(entityRow.id),
							subDoc.root,
						);
						yield* deps.instanceSvc.put({
							collectionId,
							entityId: EntityId(entityRow.id),
							contentType: "text/calendar",
							etag,
							slug,
							contentLength,
						});
					}),
				).pipe(Effect.provideService(DatabaseClient, deps.db));
				continue;
			}

			// Existing UID — only rewrite if etag changed. Avoids churn on idempotent
			// resyncs of a feed that hasn't changed.
			if (prev.etag === etag) {
				continue;
			}
			yield* withTransaction(
				Effect.gen(function* () {
					yield* deps.componentRepo.deleteByEntity(prev.entityId);
					yield* deps.componentRepo.insertTree(prev.entityId, subDoc.root);
					yield* deps.instanceSvc.put(
						{
							collectionId,
							entityId: prev.entityId,
							contentType: "text/calendar",
							etag,
							slug: Slug(prev.slug),
							contentLength,
						},
						prev.instanceId,
					);
				}),
			).pipe(Effect.provideService(DatabaseClient, deps.db));
		}

		// Anything in the local collection that's no longer in the feed: delete.
		for (const [uid, row] of existingByUid) {
			if (!feedUids.has(uid)) {
				yield* deps.instanceSvc.delete(row.instanceId);
			}
		}
	});

const stampError = (
	repo: SyncDependencies["repo"],
	id: UuidString,
	now: Temporal.Instant,
	error: string,
): Effect.Effect<void, DatabaseError> =>
	repo.recordSyncResult(id, {
		lastSyncStatus: "failure",
		lastSyncAt: now,
		lastSyncError: error,
	});

const syncOne = (
	id: UuidString,
): Effect.Effect<
	void,
	DatabaseError | DavError | InternalError,
	| ExternalCalendarRepository
	| EntityRepository
	| ComponentRepository
	| InstanceService
	| CollectionService
	| DatabaseClient
	| HttpClient.HttpClient
> =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		const repo = yield* ExternalCalendarRepository;
		const entityRepo = yield* EntityRepository;
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;
		const http = yield* HttpClient.HttpClient;

		const externalOpt = yield* repo.findById(id);
		if (Option.isNone(externalOpt)) {
			yield* Effect.logDebug("sync.external: row missing or deleted", { id });
			return;
		}
		const external = externalOpt.value;
		const now = Temporal.Now.instant();
		const deps: SyncDependencies = {
			repo,
			entityRepo,
			componentRepo,
			instanceSvc,
			db,
		};

		// Conditional GET — pass through the cached validators if we have them.
		const req = HttpClientRequest.get(external.url).pipe(
			external.httpEtag !== null
				? HttpClientRequest.setHeader("If-None-Match", external.httpEtag)
				: (r) => r,
			external.httpLastModified !== null
				? HttpClientRequest.setHeader(
						"If-Modified-Since",
						external.httpLastModified,
					)
				: (r) => r,
			HttpClientRequest.setHeader("Accept", "text/calendar, text/*;q=0.5"),
			HttpClientRequest.setHeader("User-Agent", "shuriken-ts/sync"),
		);

		const responseResult = yield* http.execute(req).pipe(Effect.either);
		if (responseResult._tag === "Left") {
			yield* stampError(
				repo,
				id,
				now,
				`fetch failed: ${String(responseResult.left)}`,
			);
			yield* Effect.logWarning("sync.external: fetch failed", {
				id,
				url: external.url,
				cause: responseResult.left,
			});
			return;
		}
		const response = responseResult.right;

		if (response.status === HTTP_NOT_MODIFIED) {
			yield* repo.recordSyncResult(id, {
				lastSyncStatus: "success",
				lastSyncAt: now,
				lastSyncError: null,
			});
			return;
		}
		// Treat any non-2xx (after 304 short-circuit) as failure. HttpClient
		// follows 3xx redirects, so anything <200 or ≥400 here is a real error.
		if (response.status < HTTP_OK || response.status >= HTTP_BAD_REQUEST) {
			yield* stampError(repo, id, now, `HTTP ${response.status}`);
			return;
		}

		const bodyResult = yield* response.text.pipe(Effect.either);
		if (bodyResult._tag === "Left") {
			yield* stampError(
				repo,
				id,
				now,
				`body read failed: ${String(bodyResult.left)}`,
			);
			return;
		}
		const docResult = yield* decodeICalendar(bodyResult.right).pipe(
			Effect.either,
		);
		if (docResult._tag === "Left") {
			yield* stampError(repo, id, now, `parse failed: ${String(docResult.left)}`);
			return;
		}
		const doc = docResult.right;
		const events = groupByUid(doc);

		// Apply feed-level defaults so future claims can read them. Live claims
		// own their displayname/color separately (Policy B handled in M4).
		const defaultDisplayname =
			extractCalProp(doc.root, "X-WR-CALNAME") ??
			extractCalProp(doc.root, "NAME");
		const defaultColor = extractCalProp(doc.root, "X-APPLE-CALENDAR-COLOR");
		const etagHeader = response.headers.etag;
		const lastModHeader = response.headers["last-modified"];

		const claims = yield* repo.listClaimsForExternal(id);
		const collSvc = yield* CollectionService;
		for (const claim of claims) {
			// Policy B (chosen for #7+#12): the claim's override always wins;
			// when null the dav_collection follows the feed's freshly-parsed
			// default. So feed renames propagate automatically until the user
			// PROPPATCHes a name/color of their own (M4 routes that into the
			// override columns).
			const effectiveDisplayname =
				claim.displaynameOverride ?? defaultDisplayname ?? null;
			const effectiveColor = claim.colorOverride ?? defaultColor ?? null;
			const metadataPatch = yield* applyClaimMetadata(
				collSvc,
				claim.collectionId as CollectionId,
				effectiveDisplayname,
				effectiveColor,
			).pipe(Effect.either);
			if (metadataPatch._tag === "Left") {
				yield* Effect.logWarning("sync.external: metadata update failed", {
					id,
					claimId: claim.id,
					cause: metadataPatch.left,
				});
			}

			const claimResult = yield* reconcileClaim(
				deps,
				claim.collectionId as CollectionId,
				doc.root,
				events,
			).pipe(Effect.either);
			if (claimResult._tag === "Left") {
				// Per-claim failures don't abort the rest of the sync; log and
				// continue so one user's broken collection doesn't starve others.
				yield* Effect.logWarning("sync.external: claim reconcile failed", {
					id,
					claimId: claim.id,
					cause: claimResult.left,
				});
			}
		}

		yield* repo.recordSyncResult(id, {
			lastSyncStatus: "success",
			lastSyncAt: now,
			fetchedAt: now,
			lastSyncError: null,
			httpEtag: etagHeader ?? null,
			httpLastModified: lastModHeader ?? null,
			defaultDisplayname: defaultDisplayname ?? null,
			defaultColor: defaultColor ?? null,
		});
	}).pipe(
		// `syncOne` is intentionally not allowed to fail upward — sync errors are
		// surfaced via `last_sync_status`/`last_sync_error` on the row and via
		// logs. Background scheduler treats all returns as "tried; move on."
		Effect.catchAll((err) =>
			Effect.logError("sync.external: unexpected error", {
				id,
				cause: err,
			}).pipe(Effect.as<void>(undefined)),
		),
	);

export const ExternalCalendarSyncServiceLive = Layer.effect(
	ExternalCalendarSyncService,
	Effect.gen(function* () {
		const repo = yield* ExternalCalendarRepository;
		const entityRepo = yield* EntityRepository;
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const collSvc = yield* CollectionService;
		const db = yield* DatabaseClient;
		const http = yield* HttpClient.HttpClient;
		return ExternalCalendarSyncService.of({
			syncOne: (id) =>
				syncOne(id).pipe(
					Effect.provideService(ExternalCalendarRepository, repo),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(InstanceService, instanceSvc),
					Effect.provideService(CollectionService, collSvc),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(HttpClient.HttpClient, http),
				),
		});
	}),
);

/** Convenience layer providing a fetch-backed HttpClient for the sync service. */
export const ExternalCalendarSyncLayer = ExternalCalendarSyncServiceLive.pipe(
	Layer.provide(FetchHttpClient.layer),
);

export type { ParsedEvent };
