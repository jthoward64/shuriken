// ---------------------------------------------------------------------------
// REPORT method dispatcher — RFC 4918 §9.13
//
// Parses the request body to determine the report type, then dispatches to
// the appropriate sub-handler.
//
// Supported report types:
//   {DAV:}sync-collection                   — RFC 6578
//   {urn:...caldav}calendar-multiget        — RFC 4791 §7.9
//   {urn:...caldav}calendar-query           — RFC 4791 §7.8
//   {urn:...caldav}free-busy-query          — RFC 4791 §7.10
//   {urn:...carddav}addressbook-multiget    — RFC 6352 §8.7
//   {urn:...carddav}addressbook-query       — RFC 6352 §8.6
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CardIndexRepository } from "#src/services/card-index/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { TombstoneRepository } from "#src/services/tombstone/index.ts";
import { addressbookMultigetHandler } from "./report/addressbook-multiget.ts";
import { addressbookQueryHandler } from "./report/addressbook-query.ts";
import { calendarMultigetHandler } from "./report/calendar-multiget.ts";
import { calendarQueryHandler } from "./report/calendar-query.ts";
import { freeBusyQueryHandler } from "./report/free-busy-query.ts";
import { parseReportBody } from "./report/parse.ts";
import { syncCollectionHandler } from "./report/sync-collection.ts";

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

const SYNC_COLLECTION = `{${DAV_NS}}sync-collection`;
const CALENDAR_MULTIGET = `{${CALDAV_NS}}calendar-multiget`;
const CALENDAR_QUERY = `{${CALDAV_NS}}calendar-query`;
const FREE_BUSY_QUERY = `{${CALDAV_NS}}free-busy-query`;
const ADDRESSBOOK_MULTIGET = `{${CARDDAV_NS}}addressbook-multiget`;
const ADDRESSBOOK_QUERY = `{${CARDDAV_NS}}addressbook-query`;

export const reportHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	| CollectionService
	| InstanceService
	| InstanceRepository
	| TombstoneRepository
	| ComponentRepository
	| CalIndexRepository
	| CardIndexRepository
	| AclService
> =>
	Effect.gen(function* () {
		const { type, tree } = yield* parseReportBody(req);

		switch (type) {
			case SYNC_COLLECTION:
				return yield* syncCollectionHandler(path, ctx, tree);

			case CALENDAR_MULTIGET:
				return yield* calendarMultigetHandler(path, ctx, tree);

			case CALENDAR_QUERY:
				return yield* calendarQueryHandler(path, ctx, tree);

			case FREE_BUSY_QUERY:
				return yield* freeBusyQueryHandler(path, ctx, tree);

			case ADDRESSBOOK_MULTIGET:
				return yield* addressbookMultigetHandler(path, ctx, tree);

			case ADDRESSBOOK_QUERY:
				return yield* addressbookQueryHandler(path, ctx, tree);

			default:
				return yield* forbidden(
					"DAV:supported-report",
					`Unsupported REPORT type: ${type}`,
				);
		}
	});
