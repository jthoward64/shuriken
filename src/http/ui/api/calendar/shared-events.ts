import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	notModifiedPageResponse,
	PageCacheService,
	pageEtag,
	withPageCacheHeaders,
} from "#src/http/ui/page-cache/index.ts";
import { SHARED_READ_PRIVILEGES } from "#src/services/acl/read-privileges.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import {
	collectCalendarEventsForInstances,
	toFullCalendarEvent,
} from "./collect-events.ts";
import { parseInstantParam } from "./events.ts";
import {
	filterViewsByRange,
	findUncoveredSharedInstances,
} from "./shared-instances.ts";

// ---------------------------------------------------------------------------
// GET /ui/api/calendar/shared-events/events?start=…&end=…
//
// FullCalendar feed for the synthetic "Shared events" pseudo-calendar: VEVENT
// instances granted directly to the caller (or one of their groups) whose
// parent calendar is neither owned nor itself shared with the caller. The ACL
// check here is the join inside `listSharedWithPrincipals` itself — same
// pattern as the removed "Shared with me" page.
// ---------------------------------------------------------------------------

export const sharedCalendarEventsHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclRepository
	| CollectionRepository
	| ComponentRepository
	| InstanceRepository
	| PageCacheService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const collRepo = yield* CollectionRepository;
		const aclRepo = yield* AclRepository;

		const groupIds = yield* aclRepo.getGroupPrincipalIds(principal.principalId);
		const principalSet = [principal.principalId, ...groupIds];
		const [owned, shared] = yield* Effect.all(
			[
				collRepo.listByOwner(principal.principalId),
				collRepo.listSharedWithPrincipals(principalSet, SHARED_READ_PRIVILEGES),
			],
			{ concurrency: "unbounded" },
		);
		const coveredIds = new Set([...owned, ...shared].map((c) => c.id));

		// Conditional GET — findUncoveredSharedInstances is a cheap, component-
		// tree-free lookup (see shared-instances.ts), so it doubles as both the
		// fingerprint input and the actual data source; a match skips the
		// expensive collectCalendarEventsForInstances load below.
		const instances = yield* findUncoveredSharedInstances(
			principal,
			coveredIds,
		);
		const pageCache = yield* PageCacheService;
		const etag = yield* pageEtag(pageCache.startupToken, {
			endpoint: "shared-calendar-events",
			principal: principal.principalId,
			start: ctx.url.searchParams.get("start"),
			end: ctx.url.searchParams.get("end"),
			instances: instances.map((i) => [i.id, i.etag]),
		});
		const notModified = notModifiedPageResponse(ctx.headers, etag);
		if (notModified !== undefined) {
			return notModified;
		}

		const rangeStart = parseInstantParam(ctx.url.searchParams.get("start"));
		const rangeEnd = parseInstantParam(ctx.url.searchParams.get("end"));
		const views = yield* collectCalendarEventsForInstances(instances);
		const events = filterViewsByRange(views, rangeStart, rangeEnd).map((ev) =>
			toFullCalendarEvent(ev),
		);

		return withPageCacheHeaders(
			new Response(JSON.stringify(events), {
				status: 200,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			}),
			etag,
		);
	});
