import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Shared field-redaction primitives for iCalendar components. Two independent
// callers apply this: the public "Feeds" share-link mechanism (via
// src/services/share-link/visibility-policy.ts, a thin adapter over the
// FieldVisibility levels below) and the authenticated DAV read path for the
// "CALDAV:read-free-busy" ACL privilege (src/http/dav/methods/*.ts). Kept
// here rather than under src/services/share-link/ so src/http/dav/ never has
// to depend on an unrelated feature's service directory.
// ---------------------------------------------------------------------------

export type FieldVisibility = "full" | "titled" | "busy_only";

export const BUSY_SUMMARY = "Busy";

const PRIVATE_PROPS: ReadonlySet<string> = new Set([
	"DESCRIPTION",
	"LOCATION",
	"ATTENDEE",
	"ORGANIZER",
	"URL",
	"CONTACT",
	"X-APPLE-STRUCTURED-LOCATION",
]);

const isPrivate = (prop: IrProperty): boolean =>
	PRIVATE_PROPS.has(prop.name.toUpperCase());

const isSummary = (prop: IrProperty): boolean =>
	prop.name.toUpperCase() === "SUMMARY";

const busySummary = (): IrProperty => ({
	name: "SUMMARY",
	parameters: [],
	value: { type: "TEXT", value: BUSY_SUMMARY },
	isKnown: true,
});

/**
 * Applies a redaction level to one VEVENT/VTODO/VJOURNAL sub-component.
 *   - full      — verbatim.
 *   - titled    — keep SUMMARY, strip DESCRIPTION/LOCATION/ATTENDEE/ORGANIZER.
 *   - busy_only — same stripping as `titled`, plus SUMMARY replaced with "Busy".
 */
export const applyFieldVisibility = (
	component: IrComponent,
	visibility: FieldVisibility,
): IrComponent => {
	if (visibility === "full") {
		return component;
	}
	const stripped = component.properties.filter((p) => !isPrivate(p));
	if (visibility === "titled") {
		return { ...component, properties: stripped };
	}
	const withoutSummary = stripped.filter((p) => !isSummary(p));
	return {
		...component,
		properties: [...withoutSummary, busySummary()],
	};
};

/**
 * Redacts every non-VTIMEZONE sub-component of a document to "busy_only".
 * Used by the DAV read path (GET, calendar-query/multiget REPORTs) when the
 * caller holds only CALDAV:read-free-busy, not DAV:read, on the resource.
 */
export const redactDocumentToBusyOnly = (doc: IrDocument): IrDocument => ({
	...doc,
	root: {
		...doc.root,
		components: doc.root.components.map((c) =>
			c.name === "VTIMEZONE" ? c : applyFieldVisibility(c, "busy_only"),
		),
	},
});
