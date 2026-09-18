// ---------------------------------------------------------------------------
// Collection property map and its multistatus response
// ---------------------------------------------------------------------------

import { type ClarkName, cn } from "#src/data/ir.ts";
import {
	CALENDAR_COLOR,
	defaultCalendarColor,
} from "#src/domain/calendar-color.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import {
	creationDateFromId,
	type PropfindKind,
	splitPropstats,
	toRfc1123,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { readDeadProperties } from "../dead-properties.ts";
import {
	ACL_RESTRICTIONS_VALUE,
	buildPrivilegeSet,
	buildSupportedReportSet,
} from "./acl-props.ts";
import { toICalDatetime } from "./href.ts";
import {
	ACL_RESTRICTIONS,
	CAL_DESCRIPTION,
	CAL_SUPPORTED_COMPONENTS,
	CALDAV_NS,
	CARD_DESCRIPTION,
	CARD_SUPPORTED_DATA,
	CARD_SUPPORTED_DATA_VALUE,
	CARDDAV_NS,
	CREATIONDATE,
	CURRENT_USER_PRINCIPAL,
	CURRENT_USER_PRIVILEGE_SET,
	DAV_NS,
	DAV_OWNER,
	DISPLAYNAME,
	GETCTAG,
	GETETAG,
	GETLASTMODIFIED,
	LOCK_DISCOVERY,
	RESOURCETYPE,
	SCHEDULE_CALENDAR_TRANSP,
	SCHEDULE_DEFAULT_CAL_URL,
	SUPPORTED_LOCK,
	SUPPORTED_REPORT_SET,
	SYNC_TOKEN,
} from "./ns.ts";

// ---------------------------------------------------------------------------
// Collection → DavResponse
// ---------------------------------------------------------------------------

// DAV:resourcetype children for each collection type (RFC 4791 §4.2,
// RFC 6352 §5.2, RFC 6638 §2.1/§2.2)
const RESOURCETYPE_CHILD: Record<string, string | undefined> = {
	calendar: `{${CALDAV_NS}}calendar`,
	addressbook: `{${CARDDAV_NS}}addressbook`,
	inbox: `{${CALDAV_NS}}schedule-inbox`,
	outbox: `{${CALDAV_NS}}schedule-outbox`,
};

/** The DAV:resourcetype value for a collection: DAV:collection plus its own type */
const resourcetypeFor = (collectionType: string): Record<string, unknown> => {
	const child = RESOURCETYPE_CHILD[collectionType];
	return child === undefined
		? { "{DAV:}collection": "" }
		: { "{DAV:}collection": "", [child]: "" };
};

/** Wraps component names as the `<C:comp name="…"/>` children the property takes */
const compSet = (names: ReadonlyArray<string>): Record<string, unknown> => ({
	[`{${CALDAV_NS}}comp`]: names.map((c) => ({ "@_name": c })),
});

/**
 * RFC 4791 §5.2.5-5.2.9 capacity limits for calendars, RFC 6352 §6.2.3
 * max-resource-size plus the supported vCard media types for address books.
 */
const addCapacityProps = (
	props: Record<ClarkName, unknown>,
	row: CollectionRow,
): void => {
	if (row.collectionType === "addressbook") {
		if (row.maxResourceSize !== null) {
			props[cn(CARDDAV_NS, "max-resource-size")] = String(row.maxResourceSize);
		}
		props[CARD_SUPPORTED_DATA] = CARD_SUPPORTED_DATA_VALUE;
		return;
	}
	if (row.collectionType !== "calendar") {
		return;
	}
	if (row.maxResourceSize !== null) {
		props[cn(CALDAV_NS, "max-resource-size")] = String(row.maxResourceSize);
	}
	if (row.minDateTime !== null) {
		props[cn(CALDAV_NS, "min-date-time")] = toICalDatetime(row.minDateTime);
	}
	if (row.maxDateTime !== null) {
		props[cn(CALDAV_NS, "max-date-time")] = toICalDatetime(row.maxDateTime);
	}
	if (row.maxInstances !== null) {
		props[cn(CALDAV_NS, "max-instances")] = String(row.maxInstances);
	}
	if (row.maxAttendeesPerInstance !== null) {
		props[cn(CALDAV_NS, "max-attendees-per-instance")] = String(
			row.maxAttendeesPerInstance,
		);
	}
};

/** Display name and description, each named by the collection's own spec */
const addDescriptiveProps = (
	props: Record<ClarkName, unknown>,
	row: CollectionRow,
): void => {
	if (row.displayName !== null) {
		props[DISPLAYNAME] = row.displayName;
	}
	if (row.description === null) {
		return;
	}
	if (row.collectionType === "calendar") {
		props[CAL_DESCRIPTION] = row.description;
	} else if (row.collectionType === "addressbook") {
		props[CARD_DESCRIPTION] = row.description;
	}
};

/**
 * RFC 4791 §5.2.3 supported-calendar-component-set. RFC 6638 §2.3 requires the
 * scheduling inbox and outbox to advertise the components they accept: VEVENT
 * and VTODO requests plus VFREEBUSY for free-busy lookups, so clients know to
 * route invitations and free-busy POSTs there.
 */
const addComponentSetProps = (
	props: Record<ClarkName, unknown>,
	row: CollectionRow,
): void => {
	if (row.collectionType === "inbox" || row.collectionType === "outbox") {
		props[CAL_SUPPORTED_COMPONENTS] = compSet(["VEVENT", "VTODO", "VFREEBUSY"]);
	} else if (
		row.collectionType === "calendar" &&
		row.supportedComponents !== null &&
		row.supportedComponents.length > 0
	) {
		props[CAL_SUPPORTED_COMPONENTS] = compSet(row.supportedComponents);
	}
};

/** RFC 6638 §9.1 schedule-calendar-transp and §9.2 schedule-default-calendar-URL */
const addSchedulingProps = (
	props: Record<ClarkName, unknown>,
	row: CollectionRow,
	origin: string,
): void => {
	if (
		row.collectionType === "calendar" ||
		row.collectionType === "inbox" ||
		row.collectionType === "outbox"
	) {
		props[SCHEDULE_CALENDAR_TRANSP] = {
			[cn(CALDAV_NS, row.scheduleTransp ?? "opaque")]: "",
		};
	}
	if (
		origin !== "" &&
		row.collectionType === "inbox" &&
		row.scheduleDefaultCalendarId !== null
	) {
		props[SCHEDULE_DEFAULT_CAL_URL] = {
			[cn(DAV_NS, "href")]:
				`${origin}/dav/principals/${row.ownerPrincipalId}/cal/${row.scheduleDefaultCalendarId}/`,
		};
	}
};

/** The per-caller live properties every collection response carries */
export interface CollectionLiveProps {
	readonly origin: string;
	// Member enumerations (depth:1) need the same live, per-caller properties a
	// direct depth:0 request returns — most importantly current-user-privilege-set,
	// which clients like iOS read on each calendar/addressbook to decide whether
	// it's usable. This map is synchronous, so the privileges are computed by the
	// caller and threaded in here.
	readonly privileges: ReadonlyArray<DavPrivilege>;
	readonly actingPrincipalHref: string;
}

/**
 * The full property map for a collection row: its live properties, its stored
 * dead properties, and the per-caller properties in `live`, which are applied
 * last so they win over a dead property of the same name.
 */
export const buildCollectionProps = (
	row: CollectionRow,
	live: CollectionLiveProps,
): Record<ClarkName, unknown> => {
	const { origin } = live;
	const props: Record<ClarkName, unknown> = {
		[RESOURCETYPE]: resourcetypeFor(row.collectionType),
		[GETLASTMODIFIED]: toRfc1123(row.updatedAt),
		[SYNC_TOKEN]: `urn:ietf:params:xml:ns:sync:${row.synctoken}`,
		// CalendarServer `getctag` — alias for sync-token, kept for compatibility
		// with clients that pre-date RFC 6578 (Apple/Thunderbird/DAVx5).
		[GETCTAG]: String(row.synctoken),
		// RFC 4918 §15.7 DAV:getetag on a collection — represents the collection
		// resource itself. We surface the sync_token as a weak etag: it changes
		// whenever any member is added/modified/removed, which is the practical
		// "has this collection changed?" signal clients care about.
		[GETETAG]: `W/"${row.synctoken}"`,
		[LOCK_DISCOVERY]: "",
		[SUPPORTED_LOCK]: "",
		[ACL_RESTRICTIONS]: ACL_RESTRICTIONS_VALUE,
		[SUPPORTED_REPORT_SET]: buildSupportedReportSet(row.collectionType),
	};

	// RFC 4918 §15.1 DAV:creationdate — derive from the UUIDv7 row id.
	const createdAt = creationDateFromId(row.id);
	if (createdAt !== undefined) {
		props[CREATIONDATE] = createdAt;
	}

	addDescriptiveProps(props, row);
	addComponentSetProps(props, row);
	addCapacityProps(props, row);
	addSchedulingProps(props, row, origin);

	// Default calendar-color (Apple ns) for calendar collections — picked
	// deterministically from the row id so the same calendar always renders
	// with the same colour. Set BEFORE the dead-props loop so a value the
	// client persisted via PROPPATCH/MKCALENDAR overrides the default.
	if (row.collectionType === "calendar") {
		props[CALENDAR_COLOR] = defaultCalendarColor(row.id);
	}

	for (const [clark, xmlValue] of Object.entries(
		readDeadProperties(row.clientProperties),
	)) {
		props[clark as ClarkName] = xmlValue;
	}

	props[CURRENT_USER_PRINCIPAL] = {
		[cn(DAV_NS, "href")]: live.actingPrincipalHref,
	};
	props[CURRENT_USER_PRIVILEGE_SET] = buildPrivilegeSet(live.privileges);
	if (origin !== "") {
		// RFC 3744 §5.1: owner of this resource
		props[DAV_OWNER] = {
			[cn(DAV_NS, "href")]: `${origin}/dav/principals/${row.ownerPrincipalId}/`,
		};
	}

	return props;
};

export interface CollectionResponseContext extends CollectionLiveProps {
	readonly request: PropfindKind;
}

export const collectionResponse = (
	href: string,
	row: CollectionRow,
	ctx: CollectionResponseContext,
): DavResponse => ({
	href,
	propstats: splitPropstats(buildCollectionProps(row, ctx), ctx.request),
});
