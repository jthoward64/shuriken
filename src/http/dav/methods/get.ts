import { Effect, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import {
	type DatabaseError,
	type DavError,
	forbidden,
	InternalError,
	methodNotAllowed,
	notFound,
} from "#src/domain/errors.ts";
import { EntityId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

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

/** Handles GET and HEAD for CalDAV/CardDAV instances. */
export const getHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	InstanceService | ComponentRepository | AclService
> =>
	Effect.gen(function* () {
		// 1. Only instance paths accept GET/HEAD.
		// new-instance/new-collection means the path is structurally valid but
		// the resource does not exist → 404. Any other kind → 405.
		if (path.kind === "new-instance" || path.kind === "new-collection") {
			return yield* notFound("Resource not found");
		}
		if (path.kind !== "instance") {
			return yield* methodNotAllowed();
		}

		// 2. Require an authenticated principal.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const principal = ctx.auth.principal;

		// 3. ACL check: read on the instance.
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			path.instanceId,
			"instance",
			"DAV:read",
		);

		// 4. Load instance metadata.
		const instanceSvc = yield* InstanceService;
		const instance = yield* instanceSvc.findById(path.instanceId);

		// 5. Determine entity type from content type.
		const baseContentType =
			instance.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
		const entityType: "icalendar" | "vcard" =
			baseContentType === "text/vcard" ? "vcard" : "icalendar";

		// 6. Load component tree.
		const componentRepo = yield* ComponentRepository;
		const treeOpt = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			entityType,
		);

		const root = yield* Option.match(treeOpt, {
			onNone: () =>
				Effect.fail(
					new InternalError({
						cause: `Instance ${path.instanceId} has no component tree`,
					}),
				),
			onSome: Effect.succeed,
		});

		// 7. Reconstruct IrDocument.
		const doc: IrDocument =
			entityType === "icalendar"
				? { kind: "icalendar", root }
				: { kind: "vcard", root };

		// 8. Serialize to text.
		const body =
			entityType === "icalendar"
				? yield* encodeICalendar(doc)
				: yield* encodeVCard(doc);

		// 9. Build response headers.
		const headers = new Headers({
			"Content-Type": `${instance.contentType}; charset=utf-8`,
			ETag: instance.etag,
			"Last-Modified": toRfc1123(instance.lastModified),
		});

		// 10. HEAD returns headers only; GET includes body.
		const isHead = ctx.method.toUpperCase() === "HEAD";

		return new Response(isHead ? null : body, {
			status: HTTP_OK,
			headers,
		});
	});
