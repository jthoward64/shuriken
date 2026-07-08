import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import { ensureDtstamp } from "#src/data/icalendar/ensure-dtstamp.ts";
import {
	getDtendInstant,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import { extractVtimezones } from "#src/data/icalendar/timezone.ts";
import { extractUid as extractICalUid } from "#src/data/icalendar/uid.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { extractUid as extractVCardUid } from "#src/data/vcard/uid.ts";
import { DatabaseClient } from "#src/db/client.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	conflict,
	type DatabaseError,
	type DavError,
	forbidden,
	methodNotAllowed,
	preconditionFailed,
	unauthorized,
	unsupportedMediaType,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import {
	isValidInstanceSlug,
	type ResolvedDavPath,
	type Slug,
} from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_CREATED, HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { fireAndForgetBirthdayRegenerate } from "#src/services/birthday/event-hook.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { isReadOnlyCollection } from "#src/services/collection/read-only-guard.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { SchedulingService } from "#src/services/scheduling/index.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";

// ---------------------------------------------------------------------------
// PUT handler — RFC 4918 §9.7, RFC 4791 §5.3.2, RFC 6352 §5.3.2
// ---------------------------------------------------------------------------

/** Handles PUT for CalDAV/CardDAV instances (create or replace). */
export const putHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| InstanceService
	| EntityRepository
	| ComponentRepository
	| CalTimezoneRepository
	| AclService
	| BirthdayService
	| CalIndexRepository
	| CollectionRepository
	| CollectionService
	| ExternalCalendarRepository
	| SchedulingService
	| DatabaseClient
> =>
	Effect.gen(function* () {
		// 1. Require an authenticated principal — must precede any path-shape
		// branching so anonymous probes cannot leak resource topology.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		const db = yield* DatabaseClient;
		// 2. Only new-instance and instance paths accept PUT.
		if (path.kind !== "new-instance" && path.kind !== "instance") {
			return yield* methodNotAllowed();
		}

		// 2a. Slug shape — only enforced on new-instance creation; updates
		// preserve the existing slug regardless of whether it matches today's
		// stricter rules. Same constraints as MKCOL.
		if (path.kind === "new-instance" && !isValidInstanceSlug(path.slug)) {
			return yield* forbidden();
		}

		// RFC 6638 §3.2.3.1: PUT to scheduling inbox or outbox is not allowed.
		if (path.namespace === "inbox" || path.namespace === "outbox") {
			return yield* forbidden("CALDAV:valid-calendar-object-resource");
		}

		// External-calendar subscriptions are read-only for their members:
		// the sync engine owns the event set and the next sync would overwrite
		// a user-side PUT anyway. RFC 4918 §15 doesn't define a specific
		// precondition for this, but `<DAV:need-privileges>` is the conventional
		// signal that the principal lacks `DAV:write-content` on the resource —
		// which is effectively what's happening here.
		if (yield* isReadOnlyCollection(path.collectionId)) {
			return yield* forbidden("DAV:need-privileges");
		}

		// 3. Validate Content-Type.
		const rawContentType = req.headers.get("Content-Type") ?? "";
		const baseContentType =
			rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";

		let entityType: EntityType;
		let contentType: "text/calendar" | "text/vcard";

		if (baseContentType === "text/calendar") {
			entityType = "icalendar";
			contentType = "text/calendar";
		} else if (baseContentType === "text/vcard") {
			entityType = "vcard";
			contentType = "text/vcard";
		} else {
			const precondition =
				path.namespace === "card"
					? "CARDDAV:supported-address-data"
					: "CALDAV:supported-calendar-data";
			return yield* unsupportedMediaType(precondition);
		}

		// Validate entity type matches the collection namespace.
		if (path.namespace === "cal" && entityType !== "icalendar") {
			return yield* unsupportedMediaType("CALDAV:supported-calendar-data");
		}
		if (path.namespace === "card" && entityType !== "vcard") {
			return yield* unsupportedMediaType("CARDDAV:supported-address-data");
		}

		// 4. RFC 7232 §6 — preconditions are evaluated BEFORE we touch the body.
		//    Otherwise a client retrying after a 304 with stale credentials etc.
		//    can be told "your body is invalid" when the real failure is the
		//    precondition. Also avoids reading + parsing a potentially large
		//    body just to reject it for an ETag mismatch.
		const ifMatch = req.headers.get("If-Match");
		const ifNoneMatch = req.headers.get("If-None-Match");
		const ifScheduleTagMatch = req.headers.get("If-Schedule-Tag-Match");
		const existingInstance =
			path.kind === "instance"
				? yield* (yield* InstanceService).findById(path.instanceId)
				: null;
		if (existingInstance === null) {
			// new-instance: any If-Match value is a precondition failure since
			// no current ETag exists; If-Schedule-Tag-Match likewise (no current tag).
			if (ifMatch !== null || ifScheduleTagMatch !== null) {
				return yield* preconditionFailed();
			}
		} else {
			if (
				ifMatch !== null &&
				ifMatch !== "*" &&
				ifMatch !== existingInstance.etag
			) {
				return yield* preconditionFailed();
			}
			if (ifNoneMatch === "*") {
				return yield* preconditionFailed();
			}
			if (
				ifScheduleTagMatch !== null &&
				ifScheduleTagMatch !== existingInstance.scheduleTag
			) {
				return yield* preconditionFailed();
			}
		}

		// 5. Read body. RFC 5545 §6 / RFC 6350 §3.1 require iCalendar and vCard
		// to be UTF-8. Decode strictly so invalid byte sequences fail-fast with
		// a precondition error rather than silently producing U+FFFD replacements
		// that would later corrupt XML responses.
		const bodyBytes = new Uint8Array(
			yield* Effect.promise(() => req.arrayBuffer()),
		);
		const body = yield* Effect.try({
			try: () => new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes),
			catch: () => undefined,
		}).pipe(
			Effect.catch(() =>
				forbidden(
					entityType === "icalendar"
						? "CALDAV:valid-calendar-data"
						: "CARDDAV:valid-address-data",
				),
			),
		);

		// 5. Parse into IrDocument. Fill a missing DTSTAMP (required by RFC 5545
		// §3.6 on VEVENT/VTODO/VJOURNAL/VFREEBUSY) with the store time so we never
		// persist or serve invalid iCalendar; a client-supplied DTSTAMP is kept.
		const doc = ensureDtstamp(
			entityType === "icalendar"
				? yield* decodeICalendar(body)
				: yield* decodeVCard(body),
		);

		// 5a. Cache VTIMEZONE definitions in cal_timezone (iCalendar only).
		//     Each VTIMEZONE is upserted with RFC 5545 §3.6.5 LAST-MODIFIED conflict
		//     resolution handled by the repository (newer definition wins).
		if (entityType === "icalendar") {
			const tzRepo = yield* CalTimezoneRepository;
			const vtimezones = yield* extractVtimezones(doc);
			yield* Effect.forEach(
				vtimezones,
				(tz) =>
					tzRepo.upsert(
						tz.tzid,
						tz.vtimezoneData,
						tz.ianaName,
						tz.lastModified,
					),
				{ discard: true },
			);
		}

		// 6. Extract logical UID.
		const logicalUid = Option.getOrNull(
			entityType === "icalendar" ? extractICalUid(doc) : extractVCardUid(doc),
		);

		// 6a. UID REQUIRED. RFC 5545 §3.6.1 (iCalendar) / RFC 6350 §6.7.6 (vCard).
		//     CalDAV §4.1 / CardDAV §3.1 both require every stored resource to
		//     have a UID so the server can enforce uniqueness; absence means we
		//     could never detect conflicts. Reject with the corresponding
		//     "valid-*-data" precondition so clients see a meaningful error.
		if (logicalUid === null) {
			return yield* forbidden(
				entityType === "icalendar"
					? "CALDAV:valid-calendar-object-resource"
					: "CARDDAV:valid-address-data",
			);
		}

		// 6b. CalDAV semantic validation — RFC 4791 §4.1, §5.3.2.
		//     Applies to every iCalendar PUT (both new and update).
		if (entityType === "icalendar") {
			const nonTzComponents = doc.root.components.filter(
				(c) => c.name !== "VTIMEZONE",
			);
			// Rule 1: empty VCALENDAR (no content components other than VTIMEZONE).
			if (nonTzComponents.length === 0) {
				return yield* forbidden("CALDAV:valid-calendar-object-resource");
			}
			// Rule 2: mixed UIDs — all content components must share the same UID.
			const componentUids = new Set(
				nonTzComponents.flatMap((c) => {
					const uidProp = c.properties.find((p) => p.name === "UID");
					if (!uidProp || uidProp.value.type !== "TEXT") {
						return [];
					}
					return [uidProp.value.value];
				}),
			);
			if (componentUids.size > 1) {
				return yield* forbidden("CALDAV:valid-calendar-object-resource");
			}
			// Rule 3: DTEND/DUE MUST be later than DTSTART (RFC 5545 §3.8.2.2,
			// §3.8.2.3). Servers that don't enforce this push the burden onto
			// every querying client, so e.g. a calendar-query time-range would
			// silently miss inverted events. Only checked when both endpoints
			// resolve to comparable instants — floating or partial dates skip.
			for (const c of nonTzComponents) {
				const dtstart = getDtstartInstant(c);
				const dtend = getDtendInstant(c);
				if (
					dtstart !== undefined &&
					dtend !== undefined &&
					Temporal.Instant.compare(dtend, dtstart) < 0
				) {
					return yield* forbidden("CALDAV:valid-calendar-object-resource");
				}
			}
		}

		// 7. Serialize canonical form.
		const canonical =
			entityType === "icalendar"
				? yield* encodeICalendar(doc)
				: yield* encodeVCard(doc);

		// 8. Compute ETag and content length.
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		// 9 + 10. Dispatch on path kind.
		if (path.kind === "new-instance") {
			// ACL check: bind on the parent collection (RFC 3744 §3.6 — creating a new member).
			const acl = yield* AclService;
			yield* acl.check(
				principal.principalId,
				path.collectionId,
				"collection",
				"DAV:bind",
			);

			// (Preconditions already enforced in step 4 — If-Match on a
			// non-existent resource returned 412 there.)

			// RFC 4791 §5.2.3: reject if the component type is not in the collection's
			// supported-calendar-component-set.
			if (entityType === "icalendar") {
				const collSvc = yield* CollectionService;
				const collRow = yield* collSvc.findById(path.collectionId);
				const supported = collRow.supportedComponents;
				if (supported !== null && supported.length > 0) {
					const docTypes = doc.root.components
						.filter((c) => c.name !== "VTIMEZONE")
						.map((c) => c.name);
					const allowedSet = new Set<string>(supported);
					if (docTypes.some((t) => !allowedSet.has(t))) {
						return yield* forbidden("CALDAV:supported-calendar-component");
					}
				}
			}

			// UID uniqueness — RFC 4791 §5.3.2 / RFC 6352 §5.1.
			// Reject if another active instance in this collection already holds the same UID.
			const entityRepo = yield* EntityRepository;
			if (logicalUid !== null) {
				const uidConflict = yield* entityRepo.existsByUid(
					path.collectionId,
					logicalUid,
				);
				if (uidConflict) {
					return yield* conflict(
						entityType === "icalendar"
							? "CALDAV:no-uid-conflict"
							: "CARDDAV:no-uid-conflict",
					);
				}
			}

			// RFC 6638 §3.2.4.1: SOR UID must also be unique across ALL calendar
			// collections owned by the principal (not just the target collection).
			if (entityType === "icalendar" && logicalUid !== null) {
				const isSorCandidate = doc.root.components.some(
					(c) =>
						(c.name === "VEVENT" || c.name === "VTODO") &&
						c.properties.some((p) => p.name === "ORGANIZER") &&
						c.properties.some((p) => p.name === "ATTENDEE"),
				);
				if (isSorCandidate) {
					const entityRepo2 = yield* EntityRepository;
					const crossConflict = yield* entityRepo2.existsByUidForPrincipal(
						principal.principalId,
						logicalUid,
					);
					if (crossConflict) {
						return yield* conflict("CALDAV:unique-scheduling-object-resource");
					}
				}
			}

			// Create entity, component tree, and instance atomically.
			const componentRepo = yield* ComponentRepository;
			const instanceSvc = yield* InstanceService;
			const { entityRow, newInstance } = yield* withTransaction(
				Effect.gen(function* () {
					const row = yield* entityRepo.insert({ entityType, logicalUid });
					yield* componentRepo.insertTree(EntityId(row.id), doc.root);
					const inst = yield* instanceSvc.put({
						collectionId: path.collectionId,
						entityId: EntityId(row.id),
						contentType,
						etag,
						slug: path.slug,
						contentLength,
					});
					return { entityRow: row, newInstance: inst };
				}),
			).pipe(Effect.provideService(DatabaseClient, db));

			if (entityType === "vcard") {
				yield* fireAndForgetBirthdayRegenerate(path.collectionId);
			}

			// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
			const calIdx = yield* CalIndexRepository;
			yield* calIdx.indexRruleOccurrences(EntityId(entityRow.id));

			// RFC 6638: process implicit scheduling after successful write.
			const schedulingSvc = yield* SchedulingService;
			const schedTagOpt =
				entityType === "icalendar"
					? yield* schedulingSvc.processAfterPut({
							actingPrincipalId: principal.principalId,
							entityId: EntityId(entityRow.id),
							instanceId: InstanceId(newInstance.id),
							collectionId: path.collectionId,
							doc,
							previousDoc: Option.none(),
							previousScheduleTag: Option.none(),
							suppressReply: req.headers.get("Schedule-Reply") === "no",
						})
					: Option.none<string>();

			const responseHeaders: Record<string, string> = { ETag: etag };
			if (Option.isSome(schedTagOpt)) {
				responseHeaders["Schedule-Tag"] = schedTagOpt.value;
			}
			return new Response(null, {
				status: HTTP_CREATED,
				headers: responseHeaders,
			});
		}

		// path.kind === "instance" — update existing resource.

		// ACL check: write-content on the instance.
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.instanceId,
			"instance",
			"DAV:write-content",
		);

		// existingInstance + preconditions were resolved in step 4 above.
		// Narrow the type for the remainder of this branch.
		if (existingInstance === null) {
			return yield* preconditionFailed();
		}
		const instanceSvc = yield* InstanceService;

		// UID uniqueness on UPDATE — RFC 4791 §5.3.2 / RFC 6352 §5.1. Changing
		// the UID to one that already belongs to another resource in this
		// collection must be rejected; same-UID overwrite is fine.
		if (logicalUid !== null) {
			const entityRepoUid = yield* EntityRepository;
			const currentEntityOpt = yield* entityRepoUid.findById(
				EntityId(existingInstance.entityId),
			);
			const currentUid = Option.match(currentEntityOpt, {
				onNone: () => null,
				onSome: (e) => e.logicalUid,
			});
			if (currentUid !== logicalUid) {
				const conflictExists = yield* entityRepoUid.existsByUid(
					CollectionId(existingInstance.collectionId),
					logicalUid,
				);
				if (conflictExists) {
					return yield* conflict(
						entityType === "icalendar"
							? "CALDAV:no-uid-conflict"
							: "CARDDAV:no-uid-conflict",
					);
				}
			}
		}

		// RFC 4791 §5.2.3: reject if the component type is not in the collection's
		// supported-calendar-component-set (applies to updates too).
		if (entityType === "icalendar") {
			const collSvc = yield* CollectionService;
			const collRow = yield* collSvc.findById(
				CollectionId(existingInstance.collectionId),
			);
			const supported = collRow.supportedComponents;
			if (supported !== null && supported.length > 0) {
				const docTypes = doc.root.components
					.filter((c) => c.name !== "VTIMEZONE")
					.map((c) => c.name);
				const allowedSet = new Set<string>(supported);
				if (docTypes.some((t) => !allowedSet.has(t))) {
					return yield* forbidden("CALDAV:supported-calendar-component");
				}
			}
		}

		// Load existing component tree (needed for scheduling validation and reply diffing).
		const componentRepo = yield* ComponentRepository;
		const prevTreeOpt = yield* componentRepo.loadTree(
			EntityId(existingInstance.entityId),
			"icalendar",
		);
		const prevDoc = Option.map(prevTreeOpt, (root) => ({
			kind: "icalendar" as const,
			root,
		}));

		// RFC 6638: validate attendee-only change rules before overwriting.
		if (entityType === "icalendar" && Option.isSome(prevDoc)) {
			const schedulingSvc = yield* SchedulingService;
			yield* schedulingSvc.validateSchedulingChange({
				actingPrincipalId: principal.principalId,
				oldDoc: prevDoc.value,
				newDoc: doc,
			});
		}

		// Replace component tree and update instance atomically.
		const entityRepo = yield* EntityRepository;
		yield* withTransaction(
			Effect.gen(function* () {
				yield* componentRepo.deleteByEntity(
					EntityId(existingInstance.entityId),
				);
				yield* entityRepo.updateLogicalUid(
					EntityId(existingInstance.entityId),
					logicalUid,
				);
				yield* componentRepo.insertTree(
					EntityId(existingInstance.entityId),
					doc.root,
				);
				yield* instanceSvc.put(
					{
						collectionId: CollectionId(existingInstance.collectionId),
						entityId: EntityId(existingInstance.entityId),
						contentType,
						etag,
						slug: existingInstance.slug as Slug,
						contentLength,
					},
					path.instanceId,
				);
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		if (entityType === "vcard") {
			yield* fireAndForgetBirthdayRegenerate(
				CollectionId(existingInstance.collectionId),
			);
		}

		// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
		const calIdx = yield* CalIndexRepository;
		yield* calIdx.indexRruleOccurrences(EntityId(existingInstance.entityId));

		// RFC 6638: process implicit scheduling after successful update.
		const schedulingSvcUpdate = yield* SchedulingService;
		const schedTagOptUpdate =
			entityType === "icalendar"
				? yield* schedulingSvcUpdate.processAfterPut({
						actingPrincipalId: principal.principalId,
						entityId: EntityId(existingInstance.entityId),
						instanceId: path.instanceId,
						collectionId: CollectionId(existingInstance.collectionId),
						doc,
						previousDoc: prevDoc,
						previousScheduleTag: Option.fromNullishOr(
							existingInstance.scheduleTag,
						),
						suppressReply: req.headers.get("Schedule-Reply") === "no",
					})
				: Option.none<string>();

		const updateHeaders: Record<string, string> = { ETag: etag };
		if (Option.isSome(schedTagOptUpdate)) {
			updateHeaders["Schedule-Tag"] = schedTagOptUpdate.value;
		}
		return new Response(null, {
			status: HTTP_NO_CONTENT,
			headers: updateHeaders,
		});
	});
