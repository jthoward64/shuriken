import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { InternalError } from "#src/domain/errors.ts";
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
import {
	isBlockedAddress,
	NetworkGuardService,
	NetworkGuardServiceLive,
} from "#src/platform/network-guard.ts";
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
const extractCalProp = (
	root: IrComponent,
	name: string,
): string | undefined => {
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
const HTTP_MULTIPLE_CHOICES = 300;
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
	readonly db: DbClient;
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
		const existing =
			yield* deps.entityRepo.listActiveInstancesWithUid(collectionId);
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

interface GuardedFetchResult {
	readonly status: number;
	readonly etag: string | null;
	readonly lastModified: string | null;
	readonly body: string;
}

/** Read a response body up to `maxBytes`, rejecting (and cancelling the stream) if exceeded. */
const readCapped = async (
	response: Response,
	maxBytes: number,
): Promise<string> => {
	if (response.body === null) {
		return "";
	}
	const reader = response.body.getReader();
	const chunks: Array<Uint8Array> = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error(`response body exceeded ${maxBytes} bytes`);
		}
		chunks.push(value);
	}
	const combined = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder("utf-8").decode(combined);
};

/**
 * SSRF-guarded fetch: resolves and rejects private/loopback/link-local/
 * metadata hosts before *every* connection attempt — including each redirect
 * hop, since `fetch`'s automatic redirect-following would otherwise connect
 * to an unvalidated host (DNS rebinding, or a feed 302-ing to the cloud
 * metadata address). Follows redirects manually up to `maxRedirects`, and
 * caps the final response body at `maxResponseBytes`.
 */
const fetchWithGuard = (
	startUrl: URL,
	opts: {
		readonly ifNoneMatch: string | null;
		readonly ifModifiedSince: string | null;
		readonly maxRedirects: number;
		readonly maxResponseBytes: number;
	},
): Effect.Effect<GuardedFetchResult, InternalError, NetworkGuardService> =>
	Effect.gen(function* () {
		const guard = yield* NetworkGuardService;
		let url = startUrl;
		let hop = 0;
		for (;;) {
			const addresses = yield* guard.resolveAddresses(url.hostname);
			if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
				return yield* Effect.fail(
					new InternalError({
						cause: new Error(`URL host is not allowed: ${url.hostname}`),
					}),
				);
			}

			const headers = new Headers({
				Accept: "text/calendar, text/*;q=0.5",
				"User-Agent": "shuriken-ts/sync",
			});
			if (hop === 0 && opts.ifNoneMatch !== null) {
				headers.set("If-None-Match", opts.ifNoneMatch);
			}
			if (hop === 0 && opts.ifModifiedSince !== null) {
				headers.set("If-Modified-Since", opts.ifModifiedSince);
			}

			const response = yield* Effect.tryPromise({
				try: () => fetch(url, { headers, redirect: "manual" }),
				catch: (e) => new InternalError({ cause: e }),
			});

			if (
				response.status >= HTTP_MULTIPLE_CHOICES &&
				response.status < HTTP_BAD_REQUEST
			) {
				const location = response.headers.get("location");
				if (location === null) {
					return yield* Effect.fail(
						new InternalError({
							cause: new Error(
								`redirect (status ${response.status}) with no Location header`,
							),
						}),
					);
				}
				if (hop >= opts.maxRedirects) {
					return yield* Effect.fail(
						new InternalError({ cause: new Error("too many redirects") }),
					);
				}
				const next = yield* Effect.try({
					try: () => new URL(location, url),
					catch: (e) => new InternalError({ cause: e }),
				});
				if (next.protocol !== "http:" && next.protocol !== "https:") {
					return yield* Effect.fail(
						new InternalError({
							cause: new Error(
								`redirect to unsupported scheme: ${next.protocol}`,
							),
						}),
					);
				}
				url = next;
				hop += 1;
				continue;
			}

			const body = yield* Effect.tryPromise({
				try: () => readCapped(response, opts.maxResponseBytes),
				catch: (e) => new InternalError({ cause: e }),
			});

			return {
				status: response.status,
				etag: response.headers.get("etag"),
				lastModified: response.headers.get("last-modified"),
				body,
			};
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
	| NetworkGuardService
	| AppConfigService
> =>
	Effect.gen(function* () {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		const repo = yield* ExternalCalendarRepository;
		const entityRepo = yield* EntityRepository;
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;
		const config = yield* AppConfigService;

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

		const targetUrl = yield* Effect.try({
			try: () => new URL(external.url),
			catch: (e) => new InternalError({ cause: e }),
		});

		const fetchResult = yield* fetchWithGuard(targetUrl, {
			ifNoneMatch: external.httpEtag,
			ifModifiedSince: external.httpLastModified,
			maxRedirects: config.externalCalendar.maxRedirects,
			maxResponseBytes: config.externalCalendar.maxResponseBytes,
		}).pipe(Effect.result);
		if (fetchResult._tag === "Failure") {
			yield* stampError(
				repo,
				id,
				now,
				`fetch failed: ${String(fetchResult.failure)}`,
			);
			yield* Effect.logWarning("sync.external: fetch failed", {
				id,
				url: external.url,
				cause: fetchResult.failure,
			});
			return;
		}
		const response = fetchResult.success;

		if (response.status === HTTP_NOT_MODIFIED) {
			yield* repo.recordSyncResult(id, {
				lastSyncStatus: "success",
				lastSyncAt: now,
				lastSyncError: null,
			});
			return;
		}
		// Treat any non-2xx (after 304 short-circuit) as failure. Redirects are
		// resolved inside fetchWithGuard, so anything <200 or ≥400 here is real.
		if (response.status < HTTP_OK || response.status >= HTTP_BAD_REQUEST) {
			yield* stampError(repo, id, now, `HTTP ${response.status}`);
			return;
		}

		const docResult = yield* decodeICalendar(response.body).pipe(Effect.result);
		if (docResult._tag === "Failure") {
			yield* stampError(
				repo,
				id,
				now,
				`parse failed: ${String(docResult.failure)}`,
			);
			return;
		}
		const doc = docResult.success;
		const events = groupByUid(doc);

		// Apply feed-level defaults so future claims can read them. Live claims
		// own their displayname/color separately (Policy B handled in M4).
		const defaultDisplayname =
			extractCalProp(doc.root, "X-WR-CALNAME") ??
			extractCalProp(doc.root, "NAME");
		const defaultColor = extractCalProp(doc.root, "X-APPLE-CALENDAR-COLOR");
		const etagHeader = response.etag;
		const lastModHeader = response.lastModified;

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
			).pipe(Effect.result);
			if (metadataPatch._tag === "Failure") {
				yield* Effect.logWarning("sync.external: metadata update failed", {
					id,
					claimId: claim.id,
					cause: metadataPatch.failure,
				});
			}

			const claimResult = yield* reconcileClaim(
				deps,
				claim.collectionId as CollectionId,
				doc.root,
				events,
			).pipe(Effect.result);
			if (claimResult._tag === "Failure") {
				// Per-claim failures don't abort the rest of the sync; log and
				// continue so one user's broken collection doesn't starve others.
				yield* Effect.logWarning("sync.external: claim reconcile failed", {
					id,
					claimId: claim.id,
					cause: claimResult.failure,
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
		Effect.catch((err) =>
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
		const networkGuard = yield* NetworkGuardService;
		const config = yield* AppConfigService;
		return {
			syncOne: (id) =>
				syncOne(id).pipe(
					Effect.provideService(ExternalCalendarRepository, repo),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(InstanceService, instanceSvc),
					Effect.provideService(CollectionService, collSvc),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(NetworkGuardService, networkGuard),
					Effect.provideService(AppConfigService, config),
				),
		};
	}),
);

/** Convenience layer providing the SSRF-guard dependency for the sync service. */
export const ExternalCalendarSyncLayer = ExternalCalendarSyncServiceLive.pipe(
	Layer.provide(NetworkGuardServiceLive),
);

export type { ParsedEvent };
