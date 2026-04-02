import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import {
	HTTP_BAD_REQUEST,
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
} from "#src/http/status.ts";
import {
	DavError,
	conflict,
	davError,
	forbidden,
	methodNotAllowed,
	needPrivileges,
	noneOrConflict,
	notFound,
	someOrNotFound,
	validAddressData,
	validCalendarData,
} from "./errors.ts";

// ---------------------------------------------------------------------------
// davError constructors
// ---------------------------------------------------------------------------

describe("davError", () => {
	it("sets status and optional precondition", () => {
		const err = davError(HTTP_CONFLICT, "CALDAV:no-uid-conflict", "already exists");
		expect(err).toBeInstanceOf(DavError);
		expect(err.status).toBe(HTTP_CONFLICT);
		expect(err.precondition).toBe("CALDAV:no-uid-conflict");
		expect(err.message).toBe("already exists");
	});

	it("omits precondition when not provided", () => {
		const err = davError(HTTP_NOT_FOUND);
		expect(err.precondition).toBeUndefined();
		expect(err.message).toBeUndefined();
	});
});

describe("notFound", () => {
	it("produces a 404 DavError with no precondition", () => {
		const err = notFound("thing not found");
		expect(err.status).toBe(HTTP_NOT_FOUND);
		expect(err.precondition).toBeUndefined();
		expect(err.message).toBe("thing not found");
	});

	it("works without a message", () => {
		const err = notFound();
		expect(err.status).toBe(HTTP_NOT_FOUND);
		expect(err.message).toBeUndefined();
	});
});

describe("methodNotAllowed", () => {
	it("produces a 405 DavError", () => {
		const err = methodNotAllowed();
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
		expect(err.precondition).toBeUndefined();
	});
});

describe("forbidden", () => {
	it("produces a 403 DavError with optional precondition", () => {
		expect(forbidden("DAV:no-external-entities").status).toBe(HTTP_FORBIDDEN);
		expect(forbidden("DAV:no-external-entities").precondition).toBe(
			"DAV:no-external-entities",
		);
	});

	it("works without a precondition", () => {
		expect(forbidden().status).toBe(HTTP_FORBIDDEN);
		expect(forbidden().precondition).toBeUndefined();
	});
});

describe("conflict", () => {
	it("produces a 409 DavError", () => {
		const err = conflict("CALDAV:no-uid-conflict");
		expect(err.status).toBe(HTTP_CONFLICT);
		expect(err.precondition).toBe("CALDAV:no-uid-conflict");
	});
});

describe("needPrivileges", () => {
	it("produces a 403 with DAV:need-privileges precondition", () => {
		const err = needPrivileges();
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:need-privileges");
	});
});

describe("validCalendarData", () => {
	it("produces a 400 with CALDAV:valid-calendar-data precondition", () => {
		const err = validCalendarData();
		expect(err.status).toBe(HTTP_BAD_REQUEST);
		expect(err.precondition).toBe("CALDAV:valid-calendar-data");
	});
});

describe("validAddressData", () => {
	it("produces a 400 with CARDDAV:valid-address-data precondition", () => {
		const err = validAddressData();
		expect(err.status).toBe(HTTP_BAD_REQUEST);
		expect(err.precondition).toBe("CARDDAV:valid-address-data");
	});
});

// ---------------------------------------------------------------------------
// someOrNotFound
// ---------------------------------------------------------------------------

describe("someOrNotFound", () => {
	it("unwraps Some and returns the inner value", async () => {
		const innerValue = 42;
		const result = await Effect.runPromise(
			someOrNotFound("not found")(Option.some(innerValue)),
		);
		expect(result).toBe(innerValue);
	});

	it("fails with a 404 DavError when Option is None", async () => {
		const exit = await Effect.runPromiseExit(
			someOrNotFound("resource not found")(Option.none()),
		);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const err = (exit.cause as { _tag: string; error: DavError }).error;
			expect(err._tag).toBe("DavError");
			expect(err.status).toBe(HTTP_NOT_FOUND);
			expect(err.message).toBe("resource not found");
		}
	});

	it("works without a message", async () => {
		const exit = await Effect.runPromiseExit(
			someOrNotFound()(Option.none()),
		);
		expect(exit._tag).toBe("Failure");
	});
});

// ---------------------------------------------------------------------------
// noneOrConflict
// ---------------------------------------------------------------------------

describe("noneOrConflict", () => {
	it("succeeds with void when Option is None", async () => {
		const result = await Effect.runPromise(
			noneOrConflict()(Option.none<string>()),
		);
		expect(result).toBeUndefined();
	});

	it("fails with a 409 DavError when Option is Some", async () => {
		const exit = await Effect.runPromiseExit(
			noneOrConflict(undefined, "already exists")(Option.some("existing")),
		);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const err = (exit.cause as { _tag: string; error: DavError }).error;
			expect(err._tag).toBe("DavError");
			expect(err.status).toBe(HTTP_CONFLICT);
			expect(err.message).toBe("already exists");
		}
	});

	it("includes the precondition in the conflict error", async () => {
		const exit = await Effect.runPromiseExit(
			noneOrConflict("CALDAV:no-uid-conflict")(Option.some("uid")),
		);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const err = (exit.cause as { _tag: string; error: DavError }).error;
			expect(err.precondition).toBe("CALDAV:no-uid-conflict");
		}
	});
});
