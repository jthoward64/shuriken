// ---------------------------------------------------------------------------
// Test data builders — iCalendar and vCard string factories
//
// All functions produce strings with CRLF line endings (RFC 5545 / RFC 6350).
// The `extra` parameter on each builder accepts raw pre-joined CRLF lines,
// letting tests inject any property without a dedicated parameter.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// iCalendar
// ---------------------------------------------------------------------------

const CRLF = "\r\n";

/** Build a VEVENT component string (no enclosing VCALENDAR). */
export const makeVEvent = (opts: {
	uid: string;
	summary: string;
	/** e.g. "20260115T100000Z" */
	dtstart: string;
	dtend: string;
	/** Defaults to "20260101T000000Z" */
	dtstamp?: string;
	/** e.g. "FREQ=WEEKLY;BYDAY=MO" */
	rrule?: string;
	description?: string;
	location?: string;
	/** e.g. "CONFIRMED", "CANCELLED" */
	status?: string;
	/** Raw CRLF-delimited lines appended before END:VEVENT */
	extra?: string;
}): string => {
	const lines: Array<string> = [
		"BEGIN:VEVENT",
		`UID:${opts.uid}`,
		`DTSTAMP:${opts.dtstamp ?? "20260101T000000Z"}`,
		`DTSTART:${opts.dtstart}`,
		`DTEND:${opts.dtend}`,
		`SUMMARY:${opts.summary}`,
	];
	if (opts.rrule !== undefined) lines.push(`RRULE:${opts.rrule}`);
	if (opts.description !== undefined) lines.push(`DESCRIPTION:${opts.description}`);
	if (opts.location !== undefined) lines.push(`LOCATION:${opts.location}`);
	if (opts.status !== undefined) lines.push(`STATUS:${opts.status}`);
	if (opts.extra !== undefined) lines.push(opts.extra);
	lines.push("END:VEVENT");
	return lines.join(CRLF);
};

/**
 * Wrap one or more component strings in a VCALENDAR.
 * Each component string is already CRLF-delimited; they are joined
 * with a single CRLF separator.
 */
export const makeVCalendar = (
	components: string | ReadonlyArray<string>,
	prodid = "-//Test//Test//EN",
): string => {
	const body = Array.isArray(components)
		? components.join(CRLF)
		: (components as string);
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`PRODID:${prodid}`,
		body,
		"END:VCALENDAR",
		"",
	].join(CRLF);
};

/** Convenience: one VEVENT wrapped in a VCALENDAR. */
export const makeCalEvent = (
	opts: Parameters<typeof makeVEvent>[0] & { prodid?: string },
): string => makeVCalendar(makeVEvent(opts), opts.prodid);

// ---------------------------------------------------------------------------
// vCard
// ---------------------------------------------------------------------------

/** Build a VERSION:4.0 VCARD string. */
export const makeVCard = (opts: {
	uid: string;
	fn: string;
	/** Raw CRLF-delimited lines appended before END:VCARD */
	extra?: string;
}): string => {
	const lines: Array<string> = [
		"BEGIN:VCARD",
		"VERSION:4.0",
		`UID:${opts.uid}`,
		`FN:${opts.fn}`,
	];
	if (opts.extra !== undefined) lines.push(opts.extra);
	lines.push("END:VCARD");
	lines.push("");
	return lines.join(CRLF);
};
