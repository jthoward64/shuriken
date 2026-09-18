// ---------------------------------------------------------------------------
// Resource URL builders and the iCalendar DATETIME formatter
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { CollectionNamespace } from "#src/domain/types/collection-namespace.ts";
import { encodeSegment } from "#src/http/dav/encode-segment.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// Resource URL builders
// ---------------------------------------------------------------------------

/**
 * Href for a directly-accessed collection: mirrors the URL segments the client
 * used (slug or UUID) so that response hrefs match the request URL.
 */
export const collectionHref = (
	origin: string,
	principalSeg: string,
	ns: string,
	collectionSeg: string,
): string => `${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/`;

/** Human-readable DAV:displayname for each per-type home collection. */
export const COLLECTION_HOME_DISPLAYNAME: Record<CollectionNamespace, string> =
	{
		cal: "Calendars",
		card: "Address Books",
		inbox: "Scheduling Inbox",
		outbox: "Scheduling Outbox",
		col: "Collections",
	};

/** The collection an href is built under, as the client addressed it. */
export interface CollectionLocation {
	readonly origin: string;
	readonly principalSeg: string;
	readonly ns: string;
	readonly collectionSeg: string;
}

/**
 * Href for a directly-accessed instance: mirrors the URL segments the client
 * used. The instance segment is percent-encoded because object names may now
 * contain `@` and other UID characters (see isValidInstanceSlug); the parent
 * segments use the tighter collection-slug charset and need no encoding.
 */
export const instanceHref = (
	at: CollectionLocation,
	instanceSeg: string,
): string => {
	const { origin, principalSeg, ns, collectionSeg } = at;
	return `${origin}/dav/principals/${principalSeg}/${ns}/${collectionSeg}/${encodeSegment(instanceSeg)}`;
};

/**
 * Href for a depth:1 member instance. Uses the instance's stored slug so the
 * href matches the URL the client created the object at (clients such as
 * python-caldav match list/search/sync results against that URL). The slug is
 * percent-encoded because object names may contain `@` etc.; it falls back to
 * the UUID only if the slug is somehow empty. Both forms resolve on input.
 */
export const memberInstanceHref = (
	at: CollectionLocation,
	instanceRow: InstanceRow,
): string => instanceHref(at, instanceRow.slug || instanceRow.id);

// ---------------------------------------------------------------------------
// Property builders
// ---------------------------------------------------------------------------

/**
 * Convert a Temporal.Instant (from the DB) to an iCalendar DATETIME string
 * (e.g. "20240115T120000Z").
 */
export const toICalDatetime = (instant: {
	epochMilliseconds: number;
}): string => {
	const d = Temporal.Instant.fromEpochMilliseconds(
		instant.epochMilliseconds,
	).toZonedDateTimeISO("UTC");
	const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
	return (
		`${d.year}${pad(d.month)}${pad(d.day)}` +
		`T${pad(d.hour)}${pad(d.minute)}${pad(d.second)}Z`
	);
};
