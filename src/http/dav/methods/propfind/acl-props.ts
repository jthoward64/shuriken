// ---------------------------------------------------------------------------
// ACL and privilege property builders (RFC 3744)
// ---------------------------------------------------------------------------

import { type ClarkName, cn } from "#src/data/ir.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AceRow } from "#src/services/acl/repository.ts";
import { CALDAV_NS, CARDDAV_NS, DAV_NS } from "./ns.ts";

// ---------------------------------------------------------------------------
// ACL helpers
// ---------------------------------------------------------------------------

/**
 * Convert a DavPrivilege string ("DAV:read", "CALDAV:schedule-deliver", …)
 * to Clark notation so the multistatus builder can translate it to a prefix.
 */
export const DAV_PREFIX = "DAV:";
export const CALDAV_PREFIX = "CALDAV:";
export const CARDDAV_PREFIX = "CARDDAV:";

export const privilegeToClark = (p: DavPrivilege): ClarkName => {
	if (p.startsWith(DAV_PREFIX)) {
		return cn(DAV_NS, p.slice(DAV_PREFIX.length));
	}
	if (p.startsWith(CALDAV_PREFIX)) {
		return cn(CALDAV_NS, p.slice(CALDAV_PREFIX.length));
	}
	if (p.startsWith(CARDDAV_PREFIX)) {
		return cn(CARDDAV_NS, p.slice(CARDDAV_PREFIX.length));
	}
	return cn(DAV_NS, p);
};

/**
 * Build the DAV:current-user-privilege-set value from a privilege list.
 * RFC 3744 §5.4: a single property with one <D:privilege> child per privilege.
 * Returning an array of `{ "{DAV:}privilege": ... }` objects would cause
 * fast-xml-builder to emit one wrapper per element, so we return a single
 * object whose `"{DAV:}privilege"` value is an array — that lets the builder
 * render a single wrapper containing repeated <D:privilege> children.
 */
export const buildPrivilegeSet = (
	privileges: ReadonlyArray<DavPrivilege>,
): Record<ClarkName, unknown> => ({
	[cn(DAV_NS, "privilege")]: privileges.map((p) => ({
		[privilegeToClark(p)]: "",
	})),
});

/**
 * Build the DAV:supported-report-set value for a given collection type.
 * RFC 3253 §3.1.5: single property with one <D:supported-report> child per
 * supported report. Returns an object whose `"{DAV:}supported-report"` value
 * is an array so fast-xml-builder emits a single wrapper containing repeated
 * <D:supported-report> children.
 */
export const buildSupportedReportSet = (
	collectionType: string,
): Record<ClarkName, unknown> => {
	const makeEntry = (name: ClarkName): Record<ClarkName, unknown> => ({
		[cn(DAV_NS, "report")]: { [name]: "" },
	});

	const names: ReadonlyArray<ClarkName> =
		collectionType === "calendar"
			? [
					cn(CALDAV_NS, "calendar-query"),
					cn(CALDAV_NS, "calendar-multiget"),
					cn(DAV_NS, "sync-collection"),
				]
			: collectionType === "addressbook"
				? [
						cn(CARDDAV_NS, "addressbook-query"),
						cn(CARDDAV_NS, "addressbook-multiget"),
						cn(DAV_NS, "sync-collection"),
					]
				: collectionType === "inbox" || collectionType === "outbox"
					? [
							// RFC 6638 §2.3: inbox/outbox MUST support calendar-query and calendar-multiget
							cn(CALDAV_NS, "calendar-query"),
							cn(CALDAV_NS, "calendar-multiget"),
							cn(DAV_NS, "sync-collection"),
						]
					: [cn(DAV_NS, "sync-collection")];

	return {
		[cn(DAV_NS, "supported-report")]: names.map(makeEntry),
	};
};

/** Shared ACL restrictions value (grant-only, no-invert per RFC 3744 §5.6). */
export const ACL_RESTRICTIONS_VALUE: Readonly<Record<ClarkName, unknown>> = {
	[cn(DAV_NS, "grant-only")]: "",
	[cn(DAV_NS, "no-invert")]: "",
};

/**
 * Build the DAV:acl property value from a list of ACE rows.
 *
 * RFC 3744 §5.5 — each ACE specifies a principal, a grant/deny, and
 * optionally the protected marker. We surface the full ACL to any
 * caller that holds DAV:read-acl (callers must gate on that privilege).
 */
export const buildAclValue = (
	aces: ReadonlyArray<AceRow>,
	origin: string,
): Record<ClarkName, unknown> => ({
	[cn(DAV_NS, "ace")]: aces.map((ace) => {
		const principal: Record<ClarkName, unknown> =
			ace.principalType === "all"
				? { [cn(DAV_NS, "all")]: "" }
				: ace.principalType === "authenticated"
					? { [cn(DAV_NS, "authenticated")]: "" }
					: ace.principalType === "unauthenticated"
						? { [cn(DAV_NS, "unauthenticated")]: "" }
						: ace.principalType === "self"
							? { [cn(DAV_NS, "self")]: "" }
							: ({
									[cn(DAV_NS, "href")]:
										`${origin}/dav/principals/${ace.principalId}/`,
								} as Record<ClarkName, unknown>);

		const aceObj: Record<ClarkName, unknown> = {
			[cn(DAV_NS, "principal")]: principal,
		};
		if (ace.grantDeny === "grant") {
			aceObj[cn(DAV_NS, "grant")] = {
				[cn(DAV_NS, "privilege")]: {
					[privilegeToClark(ace.privilege as DavPrivilege)]: "",
				},
			};
		} else {
			aceObj[cn(DAV_NS, "deny")] = {
				[cn(DAV_NS, "privilege")]: {
					[privilegeToClark(ace.privilege as DavPrivilege)]: "",
				},
			};
		}
		if (ace.protected) {
			aceObj[cn(DAV_NS, "protected")] = "";
		}
		return aceObj;
	}),
});
