import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import { ensureDtstamp } from "#src/data/icalendar/ensure-dtstamp.ts";
import {
	getDtendInstant,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import { isUnboundedHighFrequencyRrule } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import { UTC } from "#src/data/icalendar/resolve-floating.ts";
import { extractVtimezones } from "#src/data/icalendar/timezone.ts";
import { extractUid as extractICalUid } from "#src/data/icalendar/uid.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { extractUid as extractVCardUid } from "#src/data/vcard/uid.ts";
import { upgradeToV4 } from "#src/data/vcard/upgrade-v4.ts";
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
import {
	CollectionId,
	EntityId,
	InstanceId,
	type PrincipalId,
} from "#src/domain/ids.ts";
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
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { SchedulingService } from "#src/services/scheduling/index.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";

// ---------------------------------------------------------------------------
// PUT handler — RFC 4918 §9.7, RFC 4791 §5.3.2, RFC 6352 §5.3.2
// ---------------------------------------------------------------------------

/** The media type a PUT body declares, and the entity kind it stores as */
interface PutContentType {
	readonly entityType: EntityType;
	readonly contentType: "text/calendar" | "text/vcard";
}

/**
 * Validate Content-Type against the collection namespace. RFC 4791 §5.3.2 and
 * RFC 6352 §5.3.2 each define their own precondition for a body the collection
 * cannot hold.
 */
const resolveContentType = (
	rawContentType: string,
	namespace: string,
): Effect.Effect<PutContentType, DavError> => {
	const baseContentType =
		rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
	if (baseContentType === "text/calendar") {
		return namespace === "card"
			? unsupportedMediaType("CARDDAV:supported-address-data")
			: Effect.succeed({
					entityType: "icalendar" as const,
					contentType: "text/calendar" as const,
				});
	}
	if (baseContentType === "text/vcard") {
		return namespace === "cal"
			? unsupportedMediaType("CALDAV:supported-calendar-data")
			: Effect.succeed({
					entityType: "vcard" as const,
					contentType: "text/vcard" as const,
				});
	}
	return unsupportedMediaType(
		namespace === "card"
			? "CARDDAV:supported-address-data"
			: "CALDAV:supported-calendar-data",
	);
};

/**
 * Reject a write the target collection cannot accept: RFC 6638 §3.2.3.1 forbids
 * PUT to the scheduling inbox or outbox, and an external-calendar subscription
 * is read-only for its members because the sync engine owns the event set and
 * the next sync would overwrite the write anyway. RFC 4918 §15 defines no
 * precondition for the latter, so `DAV:need-privileges` is used: it is the
 * conventional signal that the principal lacks `DAV:write-content`.
 */
const checkCollectionWritable = Effect.fn("dav.put.collectionWritable")(
	function* (namespace: string, collectionId: CollectionId) {
		if (namespace === "inbox" || namespace === "outbox") {
			return yield* forbidden("CALDAV:valid-calendar-object-resource");
		}
		if (yield* isReadOnlyCollection(collectionId)) {
			return yield* forbidden("DAV:need-privileges");
		}
	},
);

/**
 * RFC 7232 §6 preconditions, evaluated before the body is read so a large body
 * is not parsed only to be rejected for an ETag mismatch.
 */
const checkPreconditions = (
	req: Request,
	existingInstance: InstanceRow | null,
): Effect.Effect<void, DavError> => {
	const ifMatch = req.headers.get("If-Match");
	const ifNoneMatch = req.headers.get("If-None-Match");
	const ifScheduleTagMatch = req.headers.get("If-Schedule-Tag-Match");
	if (existingInstance === null) {
		// new-instance: any If-Match value is a precondition failure since
		// no current ETag exists; If-Schedule-Tag-Match likewise (no current tag).
		return ifMatch !== null || ifScheduleTagMatch !== null
			? preconditionFailed()
			: Effect.void;
	}
	const failed =
		(ifMatch !== null &&
			ifMatch !== "*" &&
			ifMatch !== existingInstance.etag) ||
		ifNoneMatch === "*" ||
		(ifScheduleTagMatch !== null &&
			ifScheduleTagMatch !== existingInstance.scheduleTag);
	return failed ? preconditionFailed() : Effect.void;
};

/**
 * Read the body as strict UTF-8. RFC 5545 §6 and RFC 6350 §3.1 both require it,
 * so an invalid byte sequence fails here rather than silently becoming U+FFFD
 * replacements that would later corrupt XML responses.
 */
const readUtf8Body = (
	req: Request,
	entityType: EntityType,
): Effect.Effect<string, DavError> =>
	Effect.promise(() => req.arrayBuffer()).pipe(
		Effect.flatMap((buffer) =>
			Effect.try({
				try: () =>
					new TextDecoder("utf-8", { fatal: true }).decode(
						new Uint8Array(buffer),
					),
				catch: () => undefined,
			}),
		),
		Effect.catch(() =>
			forbidden(
				entityType === "icalendar"
					? "CALDAV:valid-calendar-data"
					: "CARDDAV:valid-address-data",
			),
		),
	);

/**
 * Cache the body's VTIMEZONE definitions in cal_timezone. RFC 5545 §3.6.5
 * LAST-MODIFIED conflict resolution is handled by the repository.
 */
const cacheVtimezones = Effect.fn("dav.put.cacheVtimezones")(function* (
	doc: IrDocument,
) {
	const tzRepo = yield* CalTimezoneRepository;
	const vtimezones = yield* extractVtimezones(doc);
	yield* Effect.forEach(
		vtimezones,
		(tz) =>
			tzRepo.upsert(tz.tzid, tz.vtimezoneData, tz.ianaName, tz.lastModified),
		{ discard: true },
	);
});

/** The content components of a calendar object, which exclude VTIMEZONE */
const contentComponents = (doc: IrDocument): ReadonlyArray<IrComponent> =>
	doc.root.components.filter((c) => c.name !== "VTIMEZONE");

/** All distinct UIDs carried by a set of components */
const componentUids = (
	components: ReadonlyArray<IrComponent>,
): ReadonlySet<string> =>
	new Set(
		components.flatMap((c) => {
			const uidProp = c.properties.find((p) => p.name === "UID");
			return uidProp?.value.type === "TEXT" ? [uidProp.value.value] : [];
		}),
	);

/**
 * RFC 5545 §3.8.2.2/§3.8.2.3: DTEND/DUE must be later than DTSTART. Ordering
 * two endpoints of the same event is zone-independent, so UTC is used rather
 * than resolving the collection's zone: it cannot change the sign.
 */
const hasInvertedInterval = (c: IrComponent): boolean => {
	const dtstart = getDtstartInstant(c, UTC);
	const dtend = getDtendInstant(c, UTC);
	return (
		dtstart !== undefined &&
		dtend !== undefined &&
		Temporal.Instant.compare(dtend, dtstart) < 0
	);
};

/**
 * An RRULE dense enough to be pathological even under the query-time expansion
 * caps (FREQ=SECONDLY/MINUTELY with no COUNT/UNTIL bound) is better failed at
 * write time than left as a DoS trigger.
 */
const hasUnboundedDenseRrule = (c: IrComponent): boolean => {
	const rruleProp = c.properties.find((p) => p.name === "RRULE");
	return (
		rruleProp?.value.type === "RECUR" &&
		isUnboundedHighFrequencyRrule(rruleProp.value.value)
	);
};

/** CalDAV semantic validation for every iCalendar PUT - RFC 4791 §4.1, §5.3.2 */
const validateCalendarObject = (
	doc: IrDocument,
): Effect.Effect<void, DavError> => {
	const components = contentComponents(doc);
	const invalid =
		// Empty VCALENDAR (no content components other than VTIMEZONE)
		components.length === 0 ||
		// Mixed UIDs - all content components must share the same UID
		componentUids(components).size > 1 ||
		components.some(hasInvertedInterval) ||
		components.some(hasUnboundedDenseRrule);
	return invalid
		? forbidden("CALDAV:valid-calendar-object-resource")
		: Effect.void;
};

/**
 * RFC 4791 §5.2.3: reject a component type that is not in the collection's
 * supported-calendar-component-set. An unset or empty set allows everything.
 */
const checkSupportedComponents = Effect.fn("dav.put.supportedComponents")(
	function* (collectionId: CollectionId, doc: IrDocument) {
		const collSvc = yield* CollectionService;
		const collRow = yield* collSvc.findById(collectionId);
		const supported = collRow.supportedComponents;
		if (supported === null || supported.length === 0) {
			return;
		}
		const allowed = new Set<string>(supported);
		if (contentComponents(doc).some((c) => !allowed.has(c.name))) {
			return yield* forbidden("CALDAV:supported-calendar-component");
		}
	},
);

/** RFC 6638 §3.2.4.1: a scheduling object resource has both ORGANIZER and ATTENDEE */
const isSchedulingObject = (doc: IrDocument): boolean =>
	doc.root.components.some(
		(c) =>
			(c.name === "VEVENT" || c.name === "VTODO") &&
			c.properties.some((p) => p.name === "ORGANIZER") &&
			c.properties.some((p) => p.name === "ATTENDEE"),
	);

/** ETag plus the RFC 6638 Schedule-Tag, when scheduling produced one */
const putHeaders = (
	etag: ETag,
	scheduleTag: Option.Option<string>,
): Record<string, string> =>
	Option.match(scheduleTag, {
		onNone: () => ({ ETag: etag }),
		onSome: (tag) => ({ ETag: etag, "Schedule-Tag": tag }),
	});

/**
 * Read, normalise and validate a PUT body into the document to store.
 *
 * A missing DTSTAMP (required by RFC 5545 §3.6 on VEVENT/VTODO/VJOURNAL/
 * VFREEBUSY) is filled with the store time so we never persist or serve invalid
 * iCalendar; a client-supplied DTSTAMP is kept. vCard is normalized to canonical
 * 4.0 on ingest. The UID is REQUIRED by RFC 5545 §3.6.1 / RFC 6350 §6.7.6, and
 * CalDAV §4.1 / CardDAV §3.1 rely on it to enforce uniqueness, so its absence is
 * rejected with the corresponding "valid-*-data" precondition.
 */
const parsePutBody = Effect.fn("dav.put.parseBody")(function* (
	req: Request,
	entityType: EntityType,
) {
	const body = yield* readUtf8Body(req, entityType);
	const doc = ensureDtstamp(
		entityType === "icalendar"
			? yield* decodeICalendar(body)
			: upgradeToV4(yield* decodeVCard(body)),
	);

	if (entityType === "icalendar") {
		yield* cacheVtimezones(doc);
	}

	const logicalUid = Option.getOrNull(
		entityType === "icalendar" ? extractICalUid(doc) : extractVCardUid(doc),
	);
	if (logicalUid === null) {
		return yield* forbidden(
			entityType === "icalendar"
				? "CALDAV:valid-calendar-object-resource"
				: "CARDDAV:valid-address-data",
		);
	}

	if (entityType === "icalendar") {
		yield* validateCalendarObject(doc);
	}
	return { doc, logicalUid };
});

/** Canonically encodes the document and derives its ETag and byte length */
const encodeCanonical = Effect.fn("dav.put.encode")(function* (
	doc: IrDocument,
	entityType: EntityType,
) {
	const canonical =
		entityType === "icalendar"
			? yield* encodeICalendar(doc)
			: yield* encodeVCard(doc);
	return {
		etag: ETag(yield* makeEtag(canonical)),
		contentLength: new TextEncoder().encode(canonical).byteLength,
	};
});

/** The validated body a PUT branch stores */
interface PutPayload {
	readonly doc: IrDocument;
	readonly entityType: EntityType;
	readonly contentType: "text/calendar" | "text/vcard";
	readonly logicalUid: string;
	readonly etag: ETag;
	readonly contentLength: number;
	readonly actingPrincipalId: PrincipalId;
	readonly suppressReply: boolean;
}

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

		yield* checkCollectionWritable(path.namespace, path.collectionId);

		// 3. Validate Content-Type against the collection namespace.
		const { entityType, contentType } = yield* resolveContentType(
			req.headers.get("Content-Type") ?? "",
			path.namespace,
		);

		// 4. Preconditions, before the body is touched.
		const existingInstance =
			path.kind === "instance"
				? yield* (yield* InstanceService).findById(path.instanceId)
				: null;
		yield* checkPreconditions(req, existingInstance);

		// 5. Read, parse and validate the body.
		const { doc, logicalUid } = yield* parsePutBody(req, entityType);

		// 6. Serialize canonical form, then compute ETag and content length.
		const { etag, contentLength } = yield* encodeCanonical(doc, entityType);
		const payload: PutPayload = {
			doc,
			entityType,
			contentType,
			logicalUid,
			etag,
			contentLength,
			actingPrincipalId: principal.principalId,
			suppressReply: req.headers.get("Schedule-Reply") === "no",
		};

		// 7. Dispatch on path kind.
		if (path.kind === "new-instance") {
			return yield* createInstance(path, payload);
		}
		if (existingInstance === null) {
			return yield* preconditionFailed();
		}
		return yield* updateInstance(path, existingInstance, payload);
	});

// ---------------------------------------------------------------------------
// Create - PUT to a new-instance path
// ---------------------------------------------------------------------------

/** Inserts the entity, its component tree and the instance row for a new resource */
const insertNewResource = Effect.fn("dav.put.insertNew")(function* (
	collectionId: CollectionId,
	slug: Slug,
	payload: PutPayload,
) {
	const entityRepo = yield* EntityRepository;
	const componentRepo = yield* ComponentRepository;
	const instanceSvc = yield* InstanceService;
	const row = yield* entityRepo.insert({
		entityType: payload.entityType,
		logicalUid: payload.logicalUid,
	});
	yield* componentRepo.insertTree(EntityId(row.id), payload.doc.root);
	const inst = yield* instanceSvc.put({
		collectionId,
		entityId: EntityId(row.id),
		contentType: payload.contentType,
		etag: payload.etag,
		slug,
		contentLength: payload.contentLength,
	});
	return { entityRow: row, newInstance: inst };
});

/**
 * UID uniqueness for a new resource - RFC 4791 §5.3.2 / RFC 6352 §5.1 within the
 * target collection, plus RFC 6638 §3.2.4.1 across every calendar collection the
 * principal owns when the body is a scheduling object resource.
 */
const checkNewUidUniqueness = Effect.fn("dav.put.newUidUniqueness")(function* (
	collectionId: CollectionId,
	payload: PutPayload,
) {
	const entityRepo = yield* EntityRepository;
	if (yield* entityRepo.existsByUid(collectionId, payload.logicalUid)) {
		return yield* conflict(
			payload.entityType === "icalendar"
				? "CALDAV:no-uid-conflict"
				: "CARDDAV:no-uid-conflict",
		);
	}
	if (payload.entityType !== "icalendar" || !isSchedulingObject(payload.doc)) {
		return;
	}
	const crossConflict = yield* entityRepo.existsByUidForPrincipal(
		payload.actingPrincipalId,
		payload.logicalUid,
	);
	if (crossConflict) {
		return yield* conflict("CALDAV:unique-scheduling-object-resource");
	}
});

const createInstance = Effect.fn("dav.put.create")(function* (
	path: Extract<ResolvedDavPath, { kind: "new-instance" }>,
	payload: PutPayload,
) {
	// ACL check: bind on the parent collection (RFC 3744 §3.6 — creating a new member).
	const acl = yield* AclService;
	yield* acl.check(
		payload.actingPrincipalId,
		path.collectionId,
		"collection",
		"DAV:bind",
	);

	if (payload.entityType === "icalendar") {
		yield* checkSupportedComponents(path.collectionId, payload.doc);
	}
	yield* checkNewUidUniqueness(path.collectionId, payload);

	const db = yield* DatabaseClient;
	const { entityRow, newInstance } = yield* withTransaction(
		insertNewResource(path.collectionId, path.slug, payload),
	).pipe(Effect.provideService(DatabaseClient, db));

	if (payload.entityType === "vcard") {
		yield* fireAndForgetBirthdayRegenerate(path.collectionId);
	}

	// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
	const calIdx = yield* CalIndexRepository;
	yield* calIdx.indexRruleOccurrences(EntityId(entityRow.id));

	// RFC 6638: process implicit scheduling after successful write.
	const schedulingSvc = yield* SchedulingService;
	const scheduleTag =
		payload.entityType === "icalendar"
			? yield* schedulingSvc.processAfterPut({
					actingPrincipalId: payload.actingPrincipalId,
					entityId: EntityId(entityRow.id),
					instanceId: InstanceId(newInstance.id),
					collectionId: path.collectionId,
					doc: payload.doc,
					previousDoc: Option.none(),
					previousScheduleTag: Option.none(),
					suppressReply: payload.suppressReply,
				})
			: Option.none<string>();

	return new Response(null, {
		status: HTTP_CREATED,
		headers: putHeaders(payload.etag, scheduleTag),
	});
});

// ---------------------------------------------------------------------------
// Update - PUT over an existing instance
// ---------------------------------------------------------------------------

/**
 * UID uniqueness on update - RFC 4791 §5.3.2 / RFC 6352 §5.1. Changing the UID
 * to one that already belongs to another resource in this collection must be
 * rejected; a same-UID overwrite is fine.
 */
const checkUpdateUidUniqueness = Effect.fn("dav.put.updateUidUniqueness")(
	function* (existingInstance: InstanceRow, payload: PutPayload) {
		const entityRepo = yield* EntityRepository;
		const currentEntity = yield* entityRepo.findById(
			EntityId(existingInstance.entityId),
		);
		const currentUid = Option.match(currentEntity, {
			onNone: () => null,
			onSome: (e) => e.logicalUid,
		});
		if (currentUid === payload.logicalUid) {
			return;
		}
		const conflictExists = yield* entityRepo.existsByUid(
			CollectionId(existingInstance.collectionId),
			payload.logicalUid,
		);
		if (conflictExists) {
			return yield* conflict(
				payload.entityType === "icalendar"
					? "CALDAV:no-uid-conflict"
					: "CARDDAV:no-uid-conflict",
			);
		}
	},
);

/** Replaces the component tree of an existing entity and refreshes its instance row */
const replaceExistingResource = Effect.fn("dav.put.replace")(function* (
	existingInstance: InstanceRow,
	instanceId: InstanceId,
	payload: PutPayload,
) {
	const componentRepo = yield* ComponentRepository;
	const entityRepo = yield* EntityRepository;
	const instanceSvc = yield* InstanceService;
	const entityId = EntityId(existingInstance.entityId);
	yield* componentRepo.deleteByEntity(entityId);
	yield* entityRepo.updateLogicalUid(entityId, payload.logicalUid);
	yield* componentRepo.insertTree(entityId, payload.doc.root);
	yield* instanceSvc.put(
		{
			collectionId: CollectionId(existingInstance.collectionId),
			entityId,
			contentType: payload.contentType,
			etag: payload.etag,
			slug: existingInstance.slug as Slug,
			contentLength: payload.contentLength,
		},
		instanceId,
	);
});

const updateInstance = Effect.fn("dav.put.update")(function* (
	path: Extract<ResolvedDavPath, { kind: "instance" }>,
	existingInstance: InstanceRow,
	payload: PutPayload,
) {
	// ACL check: write-content on the instance.
	const acl = yield* AclService;
	yield* acl.check(
		payload.actingPrincipalId,
		path.instanceId,
		"instance",
		"DAV:write-content",
	);

	yield* checkUpdateUidUniqueness(existingInstance, payload);

	const collectionId = CollectionId(existingInstance.collectionId);
	if (payload.entityType === "icalendar") {
		yield* checkSupportedComponents(collectionId, payload.doc);
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
	if (payload.entityType === "icalendar" && Option.isSome(prevDoc)) {
		const schedulingSvc = yield* SchedulingService;
		yield* schedulingSvc.validateSchedulingChange({
			actingPrincipalId: payload.actingPrincipalId,
			oldDoc: prevDoc.value,
			newDoc: payload.doc,
		});
	}

	const db = yield* DatabaseClient;
	yield* withTransaction(
		replaceExistingResource(existingInstance, path.instanceId, payload),
	).pipe(Effect.provideService(DatabaseClient, db));

	if (payload.entityType === "vcard") {
		yield* fireAndForgetBirthdayRegenerate(collectionId);
	}

	// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
	const calIdx = yield* CalIndexRepository;
	yield* calIdx.indexRruleOccurrences(EntityId(existingInstance.entityId));

	// RFC 6638: process implicit scheduling after successful update.
	const schedulingSvc = yield* SchedulingService;
	const scheduleTag =
		payload.entityType === "icalendar"
			? yield* schedulingSvc.processAfterPut({
					actingPrincipalId: payload.actingPrincipalId,
					entityId: EntityId(existingInstance.entityId),
					instanceId: path.instanceId,
					collectionId,
					doc: payload.doc,
					previousDoc: prevDoc,
					previousScheduleTag: Option.fromNullishOr(
						existingInstance.scheduleTag,
					),
					suppressReply: payload.suppressReply,
				})
			: Option.none<string>();

	return new Response(null, {
		status: HTTP_NO_CONTENT,
		headers: putHeaders(payload.etag, scheduleTag),
	});
});
