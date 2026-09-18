// ---------------------------------------------------------------------------
// Shared instance property utilities
//
// Extracted from propfind.ts so the REPORT sub-handlers (multiget, query)
// can build instance propstat responses without duplicating logic.
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import { type ClarkName, cn } from "#src/data/ir.ts";
import { readDeadProperties } from "#src/http/dav/methods/dead-properties.ts";
import type { Propstat } from "#src/http/dav/xml/multistatus.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";

// UUIDv7's first 48 bits (12 hex chars) encode Unix milliseconds.
const UUIDV7_TIMESTAMP_HEX_LENGTH = 12;
const HEX_RADIX = 16;

// Temporal.Instant is defined for ±10^8 days around the epoch; outside that
// range fromEpochMilliseconds rejects the value.
const MAX_INSTANT_EPOCH_MS = 8_640_000_000_000_000;

// ---------------------------------------------------------------------------
// RFC 1123 date formatter  (required by DAV:getlastmodified)
// ---------------------------------------------------------------------------

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

export const toRfc1123 = (instant: Temporal.Instant): string => {
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

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

const RESOURCETYPE = cn(DAV_NS, "resourcetype");
const GETETAG = cn(DAV_NS, "getetag");
const GETCONTENTTYPE = cn(DAV_NS, "getcontenttype");
const GETLASTMODIFIED = cn(DAV_NS, "getlastmodified");
const GETCONTENTLENGTH = cn(DAV_NS, "getcontentlength");
const LOCK_DISCOVERY = cn(DAV_NS, "lockdiscovery");
const SUPPORTED_LOCK = cn(DAV_NS, "supportedlock");
const ACL_RESTRICTIONS = cn(DAV_NS, "acl-restrictions");
const CREATIONDATE = cn(DAV_NS, "creationdate");
const SCHEDULE_TAG = cn(CALDAV_NS, "schedule-tag");

// ---------------------------------------------------------------------------
// ISO 8601 formatter for DAV:creationdate (RFC 4918 §15.1)
// ---------------------------------------------------------------------------

const ISO_YEAR_DIGITS = 4;
const ISO_FIELD_DIGITS = 2;

/** Format an Instant as the ISO 8601 datetime DAV:creationdate requires. */
export const toIso8601Utc = (instant: Temporal.Instant): string => {
	const zdt = instant.toZonedDateTimeISO("UTC");
	const p2 = (n: number): string => String(n).padStart(ISO_FIELD_DIGITS, "0");
	const p4 = (n: number): string => String(n).padStart(ISO_YEAR_DIGITS, "0");
	return `${p4(zdt.year)}-${p2(zdt.month)}-${p2(zdt.day)}T${p2(zdt.hour)}:${p2(zdt.minute)}:${p2(zdt.second)}Z`;
};

/**
 * Derive DAV:creationdate from a UUIDv7 row id. UUIDv7's leading 48 bits
 * encode Unix milliseconds (RFC 9562 §5.7), so we don't need a separate
 * `created_at` column. Inlined here (rather than calling
 * `extractInstantFromUuidV7` from `#src/domain/ids.ts`) because that helper
 * leans on the global Temporal namespace and we want the bundled
 * temporal-polyfill type the rest of this file uses. Returns undefined on
 * anything that doesn't look like a UUID (defensive — existing rows are
 * always UUIDv7).
 */
export const creationDateFromId = (id: string): string | undefined => {
	const hex = id.replaceAll("-", "").slice(0, UUIDV7_TIMESTAMP_HEX_LENGTH);
	if (hex.length !== UUIDV7_TIMESTAMP_HEX_LENGTH) {
		return undefined;
	}
	const ms = Number.parseInt(hex, HEX_RADIX);
	if (!Number.isFinite(ms)) {
		return undefined;
	}
	if (Math.abs(ms) > MAX_INSTANT_EPOCH_MS) {
		return undefined;
	}
	return toIso8601Utc(Temporal.Instant.fromEpochMilliseconds(ms));
};

// ---------------------------------------------------------------------------
// PropfindKind — shared type for prop request parsing results
// ---------------------------------------------------------------------------

export type PropfindKind =
	| { readonly type: "allprop"; readonly extra?: ReadonlySet<ClarkName> }
	| { readonly type: "propname" }
	| { readonly type: "prop"; readonly names: ReadonlySet<ClarkName> };

// ---------------------------------------------------------------------------
// splitPropstats — split a property map into 200/404 propstats
// ---------------------------------------------------------------------------

/** Appends a 404 propstat when any requested property was absent */
const withMissing = (
	found: Propstat,
	missing: Record<ClarkName, unknown>,
): ReadonlyArray<Propstat> =>
	Object.keys(missing).length > 0
		? [found, { props: missing, status: 404 }]
		: [found];

/** RFC 4918 §9.1: propname returns only property names as empty elements */
const propnamePropstats = (
	allProps: Readonly<Record<ClarkName, unknown>>,
): ReadonlyArray<Propstat> => {
	const names: Record<ClarkName, unknown> = {};
	for (const name of Object.keys(allProps) as Array<ClarkName>) {
		names[name] = "";
	}
	return [{ props: names, status: 200 }];
};

/**
 * RFC 4918 §9.1 allprop+include: everything goes in the 200 block, plus any
 * extra included property that is present; missing extras go to 404.
 */
const allpropPropstats = (
	allProps: Readonly<Record<ClarkName, unknown>>,
	extra: ReadonlySet<ClarkName> | undefined,
): ReadonlyArray<Propstat> => {
	const found: Propstat = { props: allProps, status: 200 };
	if (extra === undefined || extra.size === 0) {
		return [found];
	}
	const missing: Record<ClarkName, unknown> = {};
	for (const name of extra) {
		if (!(name in allProps)) {
			missing[name] = "";
		}
	}
	return withMissing(found, missing);
};

/** Named-property request: each name resolves to the 200 or the 404 block */
const namedPropstats = (
	allProps: Readonly<Record<ClarkName, unknown>>,
	names: ReadonlySet<ClarkName>,
): ReadonlyArray<Propstat> => {
	const found: Record<ClarkName, unknown> = {};
	const missing: Record<ClarkName, unknown> = {};
	for (const name of names) {
		if (name in allProps) {
			found[name] = allProps[name];
		} else {
			missing[name] = "";
		}
	}
	return withMissing({ props: found, status: 200 }, missing);
};

/**
 * Split a property map into found (200) and not-found (404) propstats.
 * For `allprop`/`propname`, all properties go into the found block.
 */
export const splitPropstats = (
	allProps: Readonly<Record<ClarkName, unknown>>,
	request: PropfindKind,
): ReadonlyArray<Propstat> => {
	if (request.type === "propname") {
		return propnamePropstats(allProps);
	}
	if (request.type === "allprop") {
		return allpropPropstats(allProps, request.extra);
	}
	return namedPropstats(allProps, request.names);
};

// ---------------------------------------------------------------------------
// buildInstanceProps — build property map for an instance row
// ---------------------------------------------------------------------------

/**
 * Property map for an instance row.
 *
 * `live` carries the per-caller properties a response also needs (owner,
 * current-user-privilege-set, body-data …); they are applied last so they win
 * over a dead property of the same name.
 */
export const buildInstanceProps = (
	row: InstanceRow,
	live: Readonly<Record<ClarkName, unknown>> = {},
): Readonly<Record<ClarkName, unknown>> => {
	const props: Record<ClarkName, unknown> = {
		[RESOURCETYPE]: {},
		[GETETAG]: row.etag,
		[GETCONTENTTYPE]: `${row.contentType}; charset=utf-8`,
		[GETLASTMODIFIED]: toRfc1123(row.lastModified),
		[LOCK_DISCOVERY]: "",
		[SUPPORTED_LOCK]: "",
		[ACL_RESTRICTIONS]: {
			[cn(DAV_NS, "grant-only")]: "",
			[cn(DAV_NS, "no-invert")]: "",
		},
	};

	// RFC 4918 §15.1 DAV:creationdate. UUIDv7 row ids encode the creation
	// instant in their leading 48 bits, so we derive it from the id rather
	// than carrying a separate column.
	const created = creationDateFromId(row.id);
	if (created !== undefined) {
		props[CREATIONDATE] = created;
	}

	if (row.contentLength !== null && row.contentLength !== undefined) {
		props[GETCONTENTLENGTH] = String(row.contentLength);
	}

	if (row.scheduleTag) {
		props[SCHEDULE_TAG] = row.scheduleTag;
	}

	for (const [clark, xmlValue] of Object.entries(
		readDeadProperties(row.clientProperties),
	)) {
		props[clark as ClarkName] = xmlValue;
	}
	for (const [clark, xmlValue] of Object.entries(live)) {
		props[clark as ClarkName] = xmlValue;
	}

	return props;
};
