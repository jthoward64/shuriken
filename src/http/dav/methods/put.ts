import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import { extractVtimezones } from "#src/data/icalendar/timezone.ts";
import { extractUid as extractICalUid } from "#src/data/icalendar/uid.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { extractUid as extractVCardUid } from "#src/data/vcard/uid.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
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
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_CREATED, HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
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
	| CalIndexRepository
	| CollectionService
	| SchedulingService
> =>
	Effect.gen(function* () {
		// 1. Only new-instance and instance paths accept PUT.
		if (path.kind !== "new-instance" && path.kind !== "instance") {
			return yield* methodNotAllowed();
		}

		// RFC 6638 §3.2.3.1: PUT to scheduling inbox or outbox is not allowed.
		if (path.namespace === "inbox" || path.namespace === "outbox") {
			return yield* forbidden("CALDAV:valid-calendar-object-resource");
		}

		// 2. Require an authenticated principal.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

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

		// 4. Read body.
		const body = yield* Effect.promise(() => req.text());

		// 5. Parse into IrDocument.
		const doc =
			entityType === "icalendar"
				? yield* decodeICalendar(body)
				: yield* decodeVCard(body);

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

			// If-Match on a non-existent resource is always a precondition failure.
			const ifMatch = req.headers.get("If-Match");
			if (ifMatch !== null) {
				return yield* preconditionFailed();
			}

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

			// Create entity row.
			const entityRow = yield* entityRepo.insert({ entityType, logicalUid });

			// Persist component tree.
			const componentRepo = yield* ComponentRepository;
			yield* componentRepo.insertTree(EntityId(entityRow.id), doc.root);

			// Create instance row.
			const instanceSvc = yield* InstanceService;
			const newInstance = yield* instanceSvc.put({
				collectionId: path.collectionId,
				entityId: EntityId(entityRow.id),
				contentType,
				etag,
				slug: path.slug,
				contentLength,
			});

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

		// Fetch existing instance to validate conditional headers and get entityId.
		const instanceSvc = yield* InstanceService;
		const existingInstance = yield* instanceSvc.findById(path.instanceId);

		// If-Match: must match the current ETag (or be "*").
		const ifMatch = req.headers.get("If-Match");
		if (
			ifMatch !== null &&
			ifMatch !== "*" &&
			ifMatch !== existingInstance.etag
		) {
			return yield* preconditionFailed();
		}

		// If-None-Match: "*" fails when the resource already exists.
		const ifNoneMatch = req.headers.get("If-None-Match");
		if (ifNoneMatch === "*") {
			return yield* preconditionFailed();
		}

		// If-Schedule-Tag-Match: RFC 6638 §3.2.1 — must match the current schedule-tag.
		const ifScheduleTagMatch = req.headers.get("If-Schedule-Tag-Match");
		if (
			ifScheduleTagMatch !== null &&
			ifScheduleTagMatch !== existingInstance.scheduleTag
		) {
			return yield* preconditionFailed();
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

		// Replace component tree.
		yield* componentRepo.deleteByEntity(EntityId(existingInstance.entityId));

		const entityRepo = yield* EntityRepository;
		yield* entityRepo.updateLogicalUid(
			EntityId(existingInstance.entityId),
			logicalUid,
		);

		yield* componentRepo.insertTree(
			EntityId(existingInstance.entityId),
			doc.root,
		);

		// Update instance ETag and sync revision.
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
