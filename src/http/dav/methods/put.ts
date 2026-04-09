import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { decodeICalendar, encodeICalendar } from "#src/data/icalendar/codec.ts";
import { extractVtimezones } from "#src/data/icalendar/timezone.ts";
import { extractUid as extractICalUid } from "#src/data/icalendar/uid.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { extractUid as extractVCardUid } from "#src/data/vcard/uid.ts";
import {
	type DatabaseError,
	type DavError,
	forbidden,
	methodNotAllowed,
	preconditionFailed,
	unauthorized,
	unsupportedMediaType,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId } from "#src/domain/ids.ts";
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
> =>
	Effect.gen(function* () {
		// 1. Only new-instance and instance paths accept PUT.
		if (path.kind !== "new-instance" && path.kind !== "instance") {
			return yield* methodNotAllowed();
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

		let entityType: "icalendar" | "vcard";
		let contentType: string;

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

		// 7. Serialize canonical form.
		const canonical =
			entityType === "icalendar"
				? yield* encodeICalendar(doc)
				: yield* encodeVCard(doc);

		// 8. Compute ETag.
		const etag = ETag(yield* makeEtag(canonical));

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

			// Create entity row.
			const entityRepo = yield* EntityRepository;
			const entityRow = yield* entityRepo.insert({ entityType, logicalUid });

			// Persist component tree.
			const componentRepo = yield* ComponentRepository;
			yield* componentRepo.insertTree(EntityId(entityRow.id), doc.root);

			// Create instance row.
			const instanceSvc = yield* InstanceService;
			yield* instanceSvc.put({
				collectionId: path.collectionId,
				entityId: EntityId(entityRow.id),
				contentType,
				etag,
				slug: path.slug,
			});

			// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
			const calIdx = yield* CalIndexRepository;
			yield* calIdx.indexRruleOccurrences(EntityId(entityRow.id));

			return new Response(null, {
				status: HTTP_CREATED,
				headers: { ETag: etag },
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

		// Replace component tree.
		const componentRepo = yield* ComponentRepository;
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
			},
			path.instanceId,
		);

		// Populate precomputed RRULE shape columns used by the week-bucket SQL filter.
		const calIdx = yield* CalIndexRepository;
		yield* calIdx.indexRruleOccurrences(EntityId(existingInstance.entityId));

		return new Response(null, {
			status: HTTP_NO_CONTENT,
			headers: { ETag: etag },
		});
	});
