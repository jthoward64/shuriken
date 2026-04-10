import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { PrincipalId, RequestId } from "#src/domain/ids.ts";
import { Unauthenticated } from "#src/domain/types/dav.ts";
import { type ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK } from "#src/http/status.ts";
import { optionsHandler } from "./options.ts";

// ---------------------------------------------------------------------------
// OPTIONS handler — RFC 4918 §9.1 + RFC 4791 §5.1 + RFC 6352 §6.1
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000000");

const fakePath: ResolvedDavPath = {
	kind: "principal",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
};

const fakeCtx: HttpRequestContext = {
	requestId: RequestId("test-request-id"),
	method: "OPTIONS",
	url: new URL("http://localhost/dav/principals/alice/"),
	headers: new Headers(),
	auth: new Unauthenticated(),
	clientIp: Option.none(),
	caldavTimezones: null,
};

describe("optionsHandler", () => {
	it("returns status 200", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		expect(res.status).toBe(HTTP_OK);
	});

	it("includes DAV capability class 1 (RFC 4918 §10.1)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const dav = res.headers.get("DAV") ?? "";
		expect(dav.split(",").map((s) => s.trim())).toContain("1");
	});

	it("includes DAV capability class 3", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const dav = res.headers.get("DAV") ?? "";
		expect(dav.split(",").map((s) => s.trim())).toContain("3");
	});

	it("includes calendar-access capability (RFC 4791)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const dav = res.headers.get("DAV") ?? "";
		expect(dav.split(",").map((s) => s.trim())).toContain("calendar-access");
	});

	it("includes addressbook capability (RFC 6352)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const dav = res.headers.get("DAV") ?? "";
		expect(dav.split(",").map((s) => s.trim())).toContain("addressbook");
	});

	it("includes extended-mkcol capability (RFC 5689)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const dav = res.headers.get("DAV") ?? "";
		expect(dav.split(",").map((s) => s.trim())).toContain("extended-mkcol");
	});

	it("advertises required methods in the Allow header", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const allow = res.headers.get("Allow") ?? "";
		const methods = allow.split(",").map((m) => m.trim());
		for (const required of [
			"OPTIONS",
			"GET",
			"PUT",
			"DELETE",
			"PROPFIND",
			"PROPPATCH",
			"MKCOL",
			"REPORT",
		]) {
			expect(methods).toContain(required);
		}
	});

	// RFC 4918 §9.8/§9.9: COPY and MOVE are WebDAV methods and must be advertised.
	it("includes COPY and MOVE in the Allow header (RFC 4918 §9.8/§9.9)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const methods = (res.headers.get("Allow") ?? "")
			.split(",")
			.map((m) => m.trim());
		expect(methods).toContain("COPY");
		expect(methods).toContain("MOVE");
	});

	// RFC 3744 §8.1: ACL is a required method for WebDAV Access Control and
	// must be listed so that clients know they can set access control entries.
	it("includes ACL in the Allow header (RFC 3744 §8.1)", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const methods = (res.headers.get("Allow") ?? "")
			.split(",")
			.map((m) => m.trim());
		expect(methods).toContain("ACL");
	});

	it("includes MS-Author-Via: DAV for CalDAV client compatibility", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		expect(res.headers.get("MS-Author-Via")).toBe("DAV");
	});

	it("has an empty body", async () => {
		const res = await Effect.runPromise(optionsHandler(fakePath, fakeCtx));
		const text = await res.text();
		expect(text).toBe("");
	});

	// RFC 4918 §9.2: OPTIONS MUST succeed on any URL, including non-existent ones.
	it("returns 200 on a non-existent (new-collection) path", async () => {
		const newCollPath: ResolvedDavPath = {
			kind: "new-collection",
			principalId: TEST_PRINCIPAL_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
			namespace: "cal",
			slug: Slug("does-not-exist"),
		};
		const res = await Effect.runPromise(optionsHandler(newCollPath, fakeCtx));
		expect(res.status).toBe(HTTP_OK);
	});
});
