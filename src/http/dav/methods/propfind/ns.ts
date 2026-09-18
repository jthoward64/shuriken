// ---------------------------------------------------------------------------
// Clark-name constants for every property PROPFIND can emit
// ---------------------------------------------------------------------------

import { type ClarkName, cn } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

export const DAV_NS = "DAV:";
export const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
export const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";

// Well-known Clark keys
export const RESOURCETYPE = cn(DAV_NS, "resourcetype");
export const DISPLAYNAME = cn(DAV_NS, "displayname");
export const GETLASTMODIFIED = cn(DAV_NS, "getlastmodified");
export const GETETAG = cn(DAV_NS, "getetag");
export const CREATIONDATE = cn(DAV_NS, "creationdate");
export const SYNC_TOKEN = cn(DAV_NS, "sync-token");
// calendarserver-org `getctag` — older change-detection token, equivalent to
// sync-token but widely required by Apple/Thunderbird/DAVx5 clients.
export const CALENDARSERVER_NS = "http://calendarserver.org/ns/";
export const GETCTAG = cn(CALENDARSERVER_NS, "getctag");
export const CURRENT_USER_PRINCIPAL = cn(DAV_NS, "current-user-principal");
export const CAL_DESCRIPTION = cn(CALDAV_NS, "calendar-description");
export const CAL_HOME_SET = cn(CALDAV_NS, "calendar-home-set");
export const CAL_SUPPORTED_COMPONENTS = cn(
	CALDAV_NS,
	"supported-calendar-component-set",
);
export const CAL_USER_ADDRESS_SET = cn(CALDAV_NS, "calendar-user-address-set");
export const CARD_DESCRIPTION = cn(CARDDAV_NS, "addressbook-description");
export const CARD_HOME_SET = cn(CARDDAV_NS, "addressbook-home-set");
export const LOCK_DISCOVERY = cn(DAV_NS, "lockdiscovery");
export const SUPPORTED_LOCK = cn(DAV_NS, "supportedlock");
export const ACL_RESTRICTIONS = cn(DAV_NS, "acl-restrictions");
export const SUPPORTED_REPORT_SET = cn(DAV_NS, "supported-report-set");
export const PRINCIPAL_URL = cn(DAV_NS, "principal-URL");
export const CURRENT_USER_PRIVILEGE_SET = cn(
	DAV_NS,
	"current-user-privilege-set",
);
export const DAV_ACL = cn(DAV_NS, "acl");
export const DAV_OWNER = cn(DAV_NS, "owner");
export const CALENDAR_TIMEZONE = cn(CALDAV_NS, "calendar-timezone");
// RFC 7809 §5.1 — timezone service URLs (on calendar home / principal)
export const TIMEZONE_SERVICE_SET = cn(CALDAV_NS, "timezone-service-set");
// RFC 7809 §5.2 — TZID shorthand for calendar-timezone (on calendar collection)
export const CALENDAR_TIMEZONE_ID = cn(CALDAV_NS, "calendar-timezone-id");
export const SCHEDULE_INBOX_URL = cn(CALDAV_NS, "schedule-inbox-URL");
export const SCHEDULE_OUTBOX_URL = cn(CALDAV_NS, "schedule-outbox-URL");
export const CAL_SUPPORTED_COLLATION_SET = cn(
	CALDAV_NS,
	"supported-collation-set",
);
export const CARD_SUPPORTED_COLLATION_SET = cn(
	CARDDAV_NS,
	"supported-collation-set",
);
// RFC 4791 §9.6 / RFC 6352 §10.4 — body-data live properties on instances
export const CALENDAR_DATA = cn(CALDAV_NS, "calendar-data");
export const ADDRESS_DATA = cn(CARDDAV_NS, "address-data");
export const DAV_GROUP_MEMBER_SET = cn(DAV_NS, "group-member-set");
export const DAV_GROUP_MEMBERSHIP = cn(DAV_NS, "group-membership");
export const DAV_ALTERNATE_URI_SET = cn(DAV_NS, "alternate-URI-set");
// RFC 6638 §9.1 — schedule-calendar-transp (opaque|transparent)
export const SCHEDULE_CALENDAR_TRANSP = cn(
	CALDAV_NS,
	"schedule-calendar-transp",
);
// RFC 6638 §9.2 — schedule-default-calendar-URL (inbox only)
export const SCHEDULE_DEFAULT_CAL_URL = cn(
	CALDAV_NS,
	"schedule-default-calendar-URL",
);
// RFC 6638 §2.4.2 — calendar-user-type (on principal resources)
export const CAL_USER_TYPE = cn(CALDAV_NS, "calendar-user-type");

// The two collation URIs the server supports for <text-match> filters.
// RFC 4791 §5.2.10 / RFC 6352 §6.2.3 — the property is a single element with
// one <collation> child per supported collation; on calendar collections the
// child is in the CalDAV namespace, on address-books it is in the CardDAV
// namespace (each spec defines its own child element).
export const COLLATION_NAMES: ReadonlyArray<string> = [
	"i;ascii-casemap",
	"i;octet",
	"i;unicode-casemap",
];
export const CAL_SUPPORTED_COLLATIONS: Record<ClarkName, unknown> = {
	[cn(CALDAV_NS, "collation")]: COLLATION_NAMES,
};
export const CARD_SUPPORTED_COLLATIONS: Record<ClarkName, unknown> = {
	[cn(CARDDAV_NS, "collation")]: COLLATION_NAMES,
};

// RFC 6352 §6.2.2 — the vCard media types + versions the server serializes.
// Storage is canonical 4.0; 3.0 is offered via downgrade-on-serve negotiation.
export const CARD_SUPPORTED_DATA = cn(CARDDAV_NS, "supported-address-data");
export const CARD_SUPPORTED_DATA_VALUE: Record<ClarkName, unknown> = {
	[cn(CARDDAV_NS, "address-data-type")]: [
		{ "@_content-type": "text/vcard", "@_version": "3.0" },
		{ "@_content-type": "text/vcard", "@_version": "4.0" },
	],
};
