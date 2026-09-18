import { Effect, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import { redactDocumentToBusyOnly } from "#src/data/icalendar/visibility.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
	methodNotAllowed,
	needPrivileges,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import { EntityId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import { parseAcceptVCardVersion } from "./accept-version.ts";
import { applyVersion } from "./report/address-data.ts";
import { stripKnownVtimezones } from "./report/calendar-data.ts";

const WEAK_ETAG_PREFIX = /^W\//u;
const ETAG_QUOTES = /^"|"$/gu;

// ---------------------------------------------------------------------------
// GET/HEAD handler — RFC 4918 §9.4
// ---------------------------------------------------------------------------

// RFC 1123 date formatter (required by Last-Modified header)
const RFC1123_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const RFC1123_MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const toRfc1123 = (instant: Temporal.Instant): string => {
	const zdt = instant.toZonedDateTimeISO("UTC");
	const daysInWeek = 7;
	const day = RFC1123_DAYS[zdt.dayOfWeek % daysInWeek];
	const month = RFC1123_MONTHS[zdt.month - 1];
	const dd = String(zdt.day).padStart(2, "0");
	const hh = String(zdt.hour).padStart(2, "0");
	const mm = String(zdt.minute).padStart(2, "0");
	const ss = String(zdt.second).padStart(2, "0");
	return `${day}, ${dd} ${month} ${zdt.year} ${hh}:${mm}:${ss} GMT`;
};

/** Strips the W/ prefix and quotes so ETags compare weakly (RFC 7232 §2.3.2) */
const normalizeEtag = (tag: string): string =>
	tag.trim().replace(WEAK_ETAG_PREFIX, "").replace(ETAG_QUOTES, "");

/** RFC 7232 §3 conditional GET: If-None-Match wins, else If-Modified-Since */
const isNotModified = (
	ctx: HttpRequestContext,
	instance: InstanceRow,
): boolean => {
	const ifNoneMatch = ctx.headers.get("If-None-Match");
	if (ifNoneMatch !== null) {
		const clientTags = ifNoneMatch.split(",").map((t) => normalizeEtag(t));
		return (
			clientTags.includes(normalizeEtag(instance.etag)) ||
			ifNoneMatch.trim() === "*"
		);
	}
	const ifModifiedSince = ctx.headers.get("If-Modified-Since");
	if (ifModifiedSince === null) {
		return false;
	}
	const sinceMs = Date.parse(ifModifiedSince);
	return (
		!Number.isNaN(sinceMs) && instance.lastModified.epochMilliseconds <= sinceMs
	);
};

/**
 * Builds the GET/HEAD response headers. A negotiated 3.0 downgrade is reflected
 * in Content-Type so the client sees the version it will actually parse.
 */
const buildHeaders = (
	instance: InstanceRow,
	vcardVersion: string | undefined,
	byteLength: number,
): Headers => {
	const headers = new Headers({
		"Content-Type":
			vcardVersion === "3.0"
				? `${instance.contentType}; charset=utf-8; version=3.0`
				: `${instance.contentType}; charset=utf-8`,
		ETag: instance.etag,
		"Last-Modified": toRfc1123(instance.lastModified),
		"Content-Length": String(byteLength),
		// DAV clients revalidate explicitly via If-None-Match/PROPFIND rather
		// than relying on opportunistic caching, and resources are
		// per-principal — keep intermediaries from serving stale/cross-user
		// data on heuristic freshness.
		"Cache-Control": "private, no-cache",
	});
	// RFC 6638 §8.2: scheduling object resources carry a Schedule-Tag. caldav
	// clients read it from the GET response header (alongside the
	// CALDAV:schedule-tag PROPFIND property) to drive If-Schedule-Tag-Match
	// conditional requests. Only SORs have a stored tag, so gate on its
	// presence.
	if (instance.scheduleTag) {
		headers.set("Schedule-Tag", instance.scheduleTag);
	}
	return headers;
};

/** Maps a stored content type to its entity type, ignoring parameters */
const entityTypeFor = (contentType: string): EntityType =>
	(contentType.split(";")[0]?.trim().toLowerCase() ?? "") === "text/vcard"
		? "vcard"
		: "icalendar";

/** Serialises a document in the format its kind names */
const encodeDocument = (
	doc: IrDocument,
): Effect.Effect<string, DavError | InternalError> =>
	doc.kind === "icalendar" ? encodeICalendar(doc) : encodeVCard(doc);

/** Loads the component tree a stored instance must have for GET to serve it */
const requireComponentTree = Effect.fn("dav.get.tree")(function* (
	instance: InstanceRow,
	entityType: EntityType,
) {
	const componentRepo = yield* ComponentRepository;
	const treeOpt = yield* componentRepo.loadTree(
		EntityId(instance.entityId),
		entityType,
	);
	return yield* Option.match(treeOpt, {
		onNone: () =>
			Effect.fail(
				new InternalError({
					cause: `Instance ${instance.id} has no component tree`,
				}),
			),
		onSome: Effect.succeed,
	});
});

/** What the response document is built from */
interface DocumentRequest {
	readonly root: IrComponent;
	readonly entityType: EntityType;
	readonly ctx: HttpRequestContext;
	readonly hasFullRead: boolean;
	readonly vcardVersion: string | undefined;
}

/**
 * Rebuilds a stored component tree into the document this request should see:
 * RFC 7809 §3.1.3 timezone-by-reference stripping, free-busy redaction for a
 * caller without DAV:read, and an RFC 6352 vCard 3.0 downgrade.
 */
const buildResponseDocument = Effect.fn("dav.get.document")(function* ({
	root,
	entityType,
	ctx,
	hasFullRead,
	vcardVersion,
}: DocumentRequest) {
	let doc: IrDocument =
		entityType === "icalendar"
			? { kind: "icalendar", root }
			: { kind: "vcard", root };

	if (entityType === "icalendar" && ctx.caldavTimezones === "F") {
		const ianaSvc = yield* IanaTimezoneService;
		doc = stripKnownVtimezones(doc, ianaSvc.isKnownTzid.bind(ianaSvc));
	}
	// A caller with only CALDAV:read-free-busy (not DAV:read) sees a redacted
	// "Busy" body instead of a 403 - keeps GET consistent with PROPFIND/REPORT
	// enumeration, which already succeeds for such callers.
	if (!hasFullRead) {
		doc = redactDocumentToBusyOnly(doc);
	}
	return vcardVersion === "3.0" ? applyVersion(doc, "3.0") : doc;
});

/** Handles GET and HEAD for CalDAV/CardDAV instances. */
export const getHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	InstanceService | ComponentRepository | AclService | IanaTimezoneService
> =>
	Effect.gen(function* () {
		// 1. Require an authenticated principal. Auth check must precede any
		// path-shape check so that anonymous probes cannot distinguish resource
		// kinds via 405 vs 404. The central davRouter gate already enforces this,
		// but check here as defense-in-depth.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const principal = ctx.auth.principal;

		// 2. Only instance paths accept GET/HEAD.
		// new-instance/new-collection means the path is structurally valid but
		// the resource does not exist → 404. Any other kind → 405.
		if (path.kind === "new-instance" || path.kind === "new-collection") {
			return yield* notFound("Resource not found");
		}
		if (path.kind !== "instance") {
			return yield* methodNotAllowed();
		}

		// 3. ACL check: at least free-busy-only read on the instance. DAV:read
		// (or DAV:all) also satisfies this via the privilege hierarchy.
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.instanceId,
			"instance",
			"CALDAV:read-free-busy",
		);
		const instancePrivileges = yield* acl.currentUserPrivileges(
			principal.principalId,
			path.instanceId,
			"instance",
		);
		const hasFullRead = instancePrivileges.includes("DAV:read");

		// 4. Load instance metadata.
		const instanceSvc = yield* InstanceService;
		const instance = yield* instanceSvc.findById(path.instanceId);

		// 5. Determine entity type from content type.
		const entityType = entityTypeFor(instance.contentType);

		// Free-busy-only access has no meaning for CardDAV contacts — require
		// full DAV:read for vcard resources.
		if (entityType === "vcard" && !hasFullRead) {
			return yield* needPrivileges();
		}

		// 6. Load component tree.
		const root = yield* requireComponentTree(instance, entityType);

		// 7. Negotiate vCard version from Accept (RFC 6352): downgrade the
		// canonical 4.0 body to 3.0 when the client asks for it.
		const vcardVersion =
			entityType === "vcard"
				? parseAcceptVCardVersion(ctx.headers.get("Accept"))
				: undefined;
		const doc = yield* buildResponseDocument({
			root,
			entityType,
			ctx,
			hasFullRead,
			vcardVersion,
		});

		// 8. Serialize to text.
		const bodyBytes = new TextEncoder().encode(yield* encodeDocument(doc));
		const headers = buildHeaders(instance, vcardVersion, bodyBytes.byteLength);

		if (isNotModified(ctx, instance)) {
			return new Response(null, { status: 304, headers });
		}

		// 9. HEAD returns headers only; GET includes body.
		const isHead = ctx.method.toUpperCase() === "HEAD";
		return new Response(isHead ? null : bodyBytes, {
			status: HTTP_OK,
			headers,
		});
	});
