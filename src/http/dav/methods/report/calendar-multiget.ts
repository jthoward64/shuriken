// ---------------------------------------------------------------------------
// CALDAV:calendar-multiget REPORT — RFC 4791 §7.9
//
// Fetches specific calendar objects by href, applying optional calendar-data
// subsetting per the <C:calendar-data> element in the request body.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import { parseCalendarDataSpec, subsetIrDocument } from "./calendar-data.ts";
import { multigetHandler } from "./multiget.ts";
import { extractHrefs, extractPropNames } from "./parse.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): ClarkName => `{${CALDAV_NS}}${local}` as ClarkName;

const CALENDAR_DATA = cn("calendar-data");

export const calendarMultigetHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	tree: unknown,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	InstanceService | ComponentRepository | AclService
> =>
	Effect.gen(function* () {
		if (path.kind !== "collection") {
			return yield* methodNotAllowed(
				"CALDAV:calendar-multiget REPORT requires a collection URL",
			);
		}

		const actingPrincipalId =
			ctx.auth._tag === "Authenticated"
				? ctx.auth.principal.principalId
				: path.principalId;

		const hrefs = extractHrefs(tree);
		const propNames = extractPropNames(tree);
		// <C:calendar-data> is nested inside <D:prop>, not at the top level
		const propEl =
			typeof tree === "object" && tree !== null
				? (tree as Record<string, unknown>)["{DAV:}prop"]
				: undefined;
		const dataTree =
			typeof propEl === "object" && propEl !== null
				? (propEl as Record<string, unknown>)[CALENDAR_DATA]
				: undefined;
		const spec = parseCalendarDataSpec(dataTree);

		return yield* multigetHandler({
			hrefs,
			collectionId: path.collectionId,
			actingPrincipalId,
			propNames,
			entityType: "icalendar",
			origin: ctx.url.origin,
			dataClarkName: CALENDAR_DATA,
			dataTree,
			serializeData: (doc: IrDocument) =>
				encodeICalendar(subsetIrDocument(doc, spec)),
		});
	});
