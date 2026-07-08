// ---------------------------------------------------------------------------
// RFC 4918 §9.1 — 207 Multi-Status XML response builder
//
// Accepts property maps keyed by Clark notation ({uri}localname) and produces
// a well-formed 207 Multi-Status XML body.  All namespace prefix assignments
// are resolved once via a shared NsRegistry so declarations appear exactly
// once on D:multistatus.
//
// Dead properties stored in clientProperties JSONB are already in Clark form;
// they flow through this module without any extra conversion.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { buildXml } from "#src/http/dav/xml/builder.ts";
import { makeNsRegistry, type NsRegistry } from "#src/http/dav/xml/ns.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single propstat block: a map of Clark-keyed properties and an HTTP status.
 *
 * For found properties (200) include the property values.
 * For not-found properties (404) only the Clark keys are needed; values are
 * ignored — the spec requires an empty <D:prop> in the 404 propstat.
 */
export interface Propstat {
	/** Clark-keyed property map.  Values are emitted verbatim by buildXml. */
	readonly props: Readonly<Record<ClarkName, unknown>>;
	/** HTTP status code for this propstat block. */
	readonly status: number;
}

/**
 * A single <D:response> entry in the multistatus body.
 */
export interface DavResponse {
	/** Absolute URL path for this resource (the <D:href> value). */
	readonly href: string;
	readonly propstats: ReadonlyArray<Propstat>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const STATUS_REASONS: Readonly<Record<number, string>> = {
	200: "OK",
	201: "Created",
	204: "No Content",
	207: "Multi-Status",
	400: "Bad Request",
	401: "Unauthorized",
	403: "Forbidden",
	404: "Not Found",
	405: "Method Not Allowed",
	409: "Conflict",
	412: "Precondition Failed",
	413: "Request Entity Too Large",
	415: "Unsupported Media Type",
	423: "Locked",
	424: "Failed Dependency",
	500: "Internal Server Error",
	501: "Not Implemented",
};

/** Format an HTTP status as the string required in <D:status>. */
const statusLine = (status: number): string =>
	`HTTP/1.1 ${status} ${STATUS_REASONS[status] ?? String(status)}`;

/**
 * Recursively translate Clark-notation keys (`{uri}localname`) in a value
 * tree through the given NsRegistry.  Attribute keys (`@_...`) and keys that
 * are already in prefix:localname form pass through unchanged.
 */
const translateClarkKeysInValue = (value: unknown, ns: NsRegistry): unknown => {
	if (Array.isArray(value)) {
		return value.map((item) => translateClarkKeysInValue(item, ns));
	}
	if (typeof value === "object" && value !== null) {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			const xmlKey = k.startsWith("{") ? ns.toXmlKey(k as ClarkName) : k;
			result[xmlKey] = translateClarkKeysInValue(v, ns);
		}
		return result;
	}
	return value;
};

/**
 * Build a 207 Multi-Status XML string from an array of DavResponse entries.
 *
 * All Clark-notation property keys are converted to prefix:localname using a
 * shared NsRegistry; all xmlns:* declarations appear once on D:multistatus.
 *
 * When `syncToken` is provided (RFC 6578 DAV:sync-collection), it is emitted
 * as `<D:sync-token>` inside `<D:multistatus>`.
 */
export const buildMultistatus = (
	responses: ReadonlyArray<DavResponse>,
	syncToken?: string,
): Effect.Effect<string, never> => {
	const ns = makeNsRegistry();

	// Force "D" prefix first so it's always present on the root element
	ns.toXmlKey("{DAV:}multistatus" as ClarkName);

	const xmlResponses = responses.map((resp) => {
		const propstats = resp.propstats.map((ps) => {
			// Convert Clark keys → prefix:localname using the shared registry,
			// and recursively translate Clark keys inside property values too.
			const xmlProps: Record<string, unknown> = {};
			for (const [clark, value] of Object.entries(ps.props)) {
				xmlProps[ns.toXmlKey(clark as ClarkName)] = translateClarkKeysInValue(
					value,
					ns,
				);
			}

			return {
				"D:propstat": {
					"D:prop": xmlProps,
					"D:status": statusLine(ps.status),
				},
			};
		});

		return {
			"D:href": resp.href,
			// Multiple propstats → array; single → unwrap for compactness
			...(propstats.length === 1
				? propstats[0]
				: { "D:propstat": propstats.map((p) => p["D:propstat"]) }),
		};
	});

	const multistatusObj =
		xmlResponses.length === 1
			? { "D:response": xmlResponses[0] }
			: { "D:response": xmlResponses };

	const root = {
		"D:multistatus": {
			...ns.declarations(),
			...multistatusObj,
			...(syncToken !== undefined ? { "D:sync-token": syncToken } : {}),
		},
	};

	return buildXml(root);
};

/**
 * Wrap a buildMultistatus result in a 207 Response.
 *
 * When `syncToken` is provided (RFC 6578 DAV:sync-collection), it is emitted
 * as `<D:sync-token>` inside `<D:multistatus>`.
 */
export const multistatusResponse = (
	responses: ReadonlyArray<DavResponse>,
	syncToken?: string,
): Effect.Effect<Response, never> =>
	buildMultistatus(responses, syncToken).pipe(
		Effect.map(
			(body) =>
				new Response(body, {
					status: 207,
					headers: { "Content-Type": "application/xml; charset=utf-8" },
				}),
		),
	);
