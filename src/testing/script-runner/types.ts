// ---------------------------------------------------------------------------
// Script runner — type definitions
//
// A "script" is a sequence of ScriptStep values that are executed in order
// against a real handleRequest instance backed by an in-memory PGlite database.
// Steps within one script share the same database; each runScript call gets a
// fresh clone.
// ---------------------------------------------------------------------------

export type HttpMethod =
	| "COPY"
	| "DELETE"
	| "GET"
	| "MKCOL"
	| "MOVE"
	| "OPTIONS"
	| "PROPFIND"
	| "PROPPATCH"
	| "PUT"
	| "REPORT"
	| "MKCALENDAR"
	| "MKADDRESSBOOK"
	| "ACL"
	| "UNLOCK"
	| "LOCK";

// ---------------------------------------------------------------------------
// ScriptUser — a user to provision before executing the script's steps
//
// The `id` field serves double duty as the reference key in step `as` fields
// and as the Basic auth password. A user with id "alice" has password "alice".
// ---------------------------------------------------------------------------

export interface ScriptUser {
	/** Local reference key — also used as the Basic auth password for this user. */
	readonly id: string;
	readonly email: string;
	readonly slug: string;
	/** Defaults to the local part of email if omitted. */
	readonly name?: string;
}

// ---------------------------------------------------------------------------
// ScriptStep — a single HTTP action in a script
// ---------------------------------------------------------------------------

export interface ScriptStep {
	/** Human-readable label shown in failure messages. */
	readonly name?: string;
	readonly method: HttpMethod;
	/** URL path, e.g. "/dav/principals/test/cal/my-calendar/". */
	readonly path: string;
	/**
	 * Which user to run this step as.
	 * Must match a ScriptUser.id from ScriptOptions.users.
	 * Automatically adds an Authorization: Basic header.
	 * If omitted, the request is unauthenticated.
	 */
	readonly as?: string;
	/** Additional request headers. Do not set Authorization here; use `as` instead. */
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly expect?: ScriptExpectation;
}

// ---------------------------------------------------------------------------
// ScriptStepFactory — lazy step computed from prior results
//
// Use this when a step needs data from an earlier response (e.g. an ETag
// captured from a PUT response that must be used in a subsequent If-Match
// header). The factory receives all results collected so far and returns a
// fully-defined ScriptStep.
// ---------------------------------------------------------------------------

export type ScriptStepFactory = (
	prev: ReadonlyArray<ScriptStepResult>,
) => ScriptStep;

/**
 * A step can either be a static ScriptStep or a factory that produces one
 * from earlier results. Pass these to `runScript`.
 */
export type ScriptStepOrFactory = ScriptStep | ScriptStepFactory;

export interface ScriptExpectation {
	/** Assert the response status code equals this value. */
	readonly status?: number;
	/** Assert the response body contains each of these substrings. */
	readonly bodyContains?: string | ReadonlyArray<string>;
	/** Assert the response body does NOT contain any of these substrings. */
	readonly bodyNotContains?: string | ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// ScriptOptions — configuration for a runScript call
// ---------------------------------------------------------------------------

export interface ScriptOptions {
	/**
	 * Users to provision before the steps run.
	 * If omitted, a single default user is provisioned:
	 *   { id: "test", email: "test@example.com", slug: "test" }
	 */
	readonly users?: ReadonlyArray<ScriptUser>;
}

// ---------------------------------------------------------------------------
// ScriptStepResult — the outcome of executing one step
// ---------------------------------------------------------------------------

export interface ScriptStepResult {
	readonly step: ScriptStep;
	readonly status: number;
	readonly body: string;
	/** Response headers as a plain record for easy inspection in tests. */
	readonly headers: Readonly<Record<string, string>>;
	/** Empty array means the step passed all expectations. */
	readonly failures: ReadonlyArray<string>;
}
