// ---------------------------------------------------------------------------
// REPORT method dispatcher — RFC 4918 §9.13
//
// Parses the request body to determine the report type, then dispatches to
// the appropriate sub-handler.
//
// Supported report types:
//   {DAV:}sync-collection                        — RFC 6578
//   {DAV:}principal-match                        — RFC 3744 §9.3
//   {DAV:}principal-property-search              — RFC 3744 §9.4
//   {urn:...caldav}calendar-multiget             — RFC 4791 §7.9
//   {urn:...caldav}calendar-query                — RFC 4791 §7.8
//   {urn:...caldav}free-busy-query               — RFC 4791 §7.10
//   {urn:...carddav}addressbook-multiget         — RFC 6352 §8.7
//   {urn:...carddav}addressbook-query            — RFC 6352 §8.6
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { AppConfigService } from "#src/config.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CardIndexRepository } from "#src/services/card-index/index.ts";
import type {
	CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { PrincipalRepository } from "#src/services/principal/index.ts";
import type { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import type { TombstoneRepository } from "#src/services/tombstone/index.ts";
import { addressbookMultigetHandler } from "./report/addressbook-multiget.ts";
import { addressbookQueryHandler } from "./report/addressbook-query.ts";
import { calendarMultigetHandler } from "./report/calendar-multiget.ts";
import { calendarQueryHandler } from "./report/calendar-query.ts";
import { freeBusyQueryHandler } from "./report/free-busy-query.ts";
import { parseReportBody } from "./report/parse.ts";
import { principalMatchHandler } from "./report/principal-match.ts";
import { principalPropertySearchHandler } from "./report/principal-property-search.ts";
import { syncCollectionHandler } from "./report/sync-collection.ts";

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

const SYNC_COLLECTION = `{${DAV_NS}}sync-collection`;
const PRINCIPAL_MATCH = `{${DAV_NS}}principal-match`;
const PRINCIPAL_PROPERTY_SEARCH = `{${DAV_NS}}principal-property-search`;
const CALENDAR_MULTIGET = `{${CALDAV_NS}}calendar-multiget`;
const CALENDAR_QUERY = `{${CALDAV_NS}}calendar-query`;
const FREE_BUSY_QUERY = `{${CALDAV_NS}}free-busy-query`;
const ADDRESSBOOK_MULTIGET = `{${CARDDAV_NS}}addressbook-multiget`;
const ADDRESSBOOK_QUERY = `{${CARDDAV_NS}}addressbook-query`;

// Every service any REPORT sub-handler can reach for
type ReportServices =
	| CollectionService
	| InstanceService
	| InstanceRepository
	| TombstoneRepository
	| ComponentRepository
	| CalIndexRepository
	| CardIndexRepository
	| CollectionRepository
	| IanaTimezoneService
	| PrincipalRepository
	| AclService
	| AppConfigService;

// Report document root (Clark name) → the sub-handler that answers it. Every
// sub-handler takes the parsed request tree and answers a Response.
const REPORT_HANDLERS: Record<
	string,
	| ((
			path: ResolvedDavPath,
			ctx: HttpRequestContext,
			tree: unknown,
	  ) => Effect.Effect<Response, DavError | DatabaseError, ReportServices>)
	| undefined
> = {
	[SYNC_COLLECTION]: syncCollectionHandler,
	[PRINCIPAL_MATCH]: principalMatchHandler,
	[PRINCIPAL_PROPERTY_SEARCH]: principalPropertySearchHandler,
	[CALENDAR_MULTIGET]: calendarMultigetHandler,
	[CALENDAR_QUERY]: calendarQueryHandler,
	[FREE_BUSY_QUERY]: freeBusyQueryHandler,
	[ADDRESSBOOK_MULTIGET]: addressbookMultigetHandler,
	[ADDRESSBOOK_QUERY]: addressbookQueryHandler,
};

export const reportHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<Response, DavError | DatabaseError, ReportServices> =>
	Effect.gen(function* () {
		const { type, tree } = yield* parseReportBody(req);
		const handler = REPORT_HANDLERS[type];
		if (handler === undefined) {
			return yield* forbidden(
				"DAV:supported-report",
				`Unsupported REPORT type: ${type}`,
			);
		}
		return yield* handler(path, ctx, tree);
	});
