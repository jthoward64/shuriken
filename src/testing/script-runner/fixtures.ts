import type {
	ScriptExpectation,
	ScriptOptions,
	ScriptStep,
	ScriptUser,
} from "./types.ts";

// ---------------------------------------------------------------------------
// User presets
//
// Convenience factories for ScriptOptions.users. Use these as the options
// argument to runScript for the most common test scenarios.
// ---------------------------------------------------------------------------

/** Single test user with id/slug "test" and email "test@example.com". */
export const singleUser = (): ScriptOptions => ({
	users: [{ id: "test", email: "test@example.com", slug: "test" }],
});

/** Two independent users — no shared groups. */
export const twoUsers = (): ScriptOptions => ({
	users: [
		{ id: "alice", email: "alice@example.com", slug: "alice" },
		{ id: "bob", email: "bob@example.com", slug: "bob" },
	],
});

// ---------------------------------------------------------------------------
// ScriptUser factory
//
// Construct a ScriptUser from just the id, deriving email and slug from it.
// Useful for building custom ScriptOptions.users arrays.
// ---------------------------------------------------------------------------

/** Make a ScriptUser whose email is `${id}@example.com` and slug is `${id}`. */
export const makeUser = (
	id: string,
	overrides?: Partial<ScriptUser>,
): ScriptUser => ({
	id,
	email: `${id}@example.com`,
	slug: id,
	...overrides,
});

// ---------------------------------------------------------------------------
// Step options — common fields that can be passed to any step helper
// ---------------------------------------------------------------------------

export interface StepOptions {
	readonly name?: string;
	readonly as?: string;
	/** Merged into the step's headers (step-helper defaults take lower priority). */
	readonly headers?: Readonly<Record<string, string>>;
	/** Overrides the default expectation for this helper. */
	readonly expect?: ScriptExpectation;
}

// ---------------------------------------------------------------------------
// DAV step helpers
//
// Each helper returns a ScriptStep with sensible defaults (status code, Content-Type,
// etc.) that can be overridden via StepOptions.expect or StepOptions.headers.
// ---------------------------------------------------------------------------

/** MKCOL — create a new DAV collection. Expects 201 by default. */
export const mkcol = (path: string, options?: StepOptions): ScriptStep => ({
	name: options?.name ?? `MKCOL ${path}`,
	method: "MKCOL",
	path,
	as: options?.as,
	headers: options?.headers,
	expect: options?.expect ?? { status: 201 },
});

/** PROPFIND — query properties on a resource. Expects 207 by default. */
export const propfind = (
	path: string,
	body: string,
	options?: StepOptions,
): ScriptStep => ({
	name: options?.name ?? `PROPFIND ${path}`,
	method: "PROPFIND",
	path,
	as: options?.as,
	headers: {
		"Content-Type": "application/xml; charset=utf-8",
		...options?.headers,
	},
	body,
	expect: options?.expect ?? { status: 207 },
});

/** PUT — create or replace a resource. No default status (201 or 204 both valid). */
export const put = (
	path: string,
	body: string,
	contentType: string,
	options?: StepOptions,
): ScriptStep => ({
	name: options?.name ?? `PUT ${path}`,
	method: "PUT",
	path,
	as: options?.as,
	headers: {
		"Content-Type": contentType,
		...options?.headers,
	},
	body,
	expect: options?.expect,
});

/** DELETE — delete a resource. Expects 204 by default. */
export const del = (path: string, options?: StepOptions): ScriptStep => ({
	name: options?.name ?? `DELETE ${path}`,
	method: "DELETE",
	path,
	as: options?.as,
	headers: options?.headers,
	expect: options?.expect ?? { status: 204 },
});

/** GET — retrieve a resource. Expects 200 by default. */
export const get = (path: string, options?: StepOptions): ScriptStep => ({
	name: options?.name ?? `GET ${path}`,
	method: "GET",
	path,
	as: options?.as,
	headers: options?.headers,
	expect: options?.expect ?? { status: 200 },
});

// ---------------------------------------------------------------------------
// Common PROPFIND XML bodies
// ---------------------------------------------------------------------------

/** Minimal PROPFIND requesting all properties. */
export const PROPFIND_ALLPROP = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:allprop/>
</D:propfind>`;

/** PROPFIND requesting only displayname. */
export const PROPFIND_DISPLAYNAME = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
  </D:prop>
</D:propfind>`;

/** PROPFIND requesting resourcetype and displayname — useful for collection listings. */
export const PROPFIND_RESOURCETYPE = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:displayname/>
  </D:prop>
</D:propfind>`;
