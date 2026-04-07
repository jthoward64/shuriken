import { Effect, ManagedRuntime, Redacted } from "effect";
import { UserId } from "#src/domain/ids.ts";
import { Email } from "#src/domain/types/strings.ts";
import { Slug } from "#src/domain/types/path.ts";
import { handleRequest } from "#src/http/router.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "./layer.ts";
import type {
	ScriptOptions,
	ScriptStep,
	ScriptStepResult,
	ScriptUser,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Default test user — used when ScriptOptions.users is not specified
// ---------------------------------------------------------------------------

const DEFAULT_USER: ScriptUser = {
	id: "test",
	email: "test@example.com",
	slug: "test",
};

// ---------------------------------------------------------------------------
// Mock Bun.Server
//
// handleRequest calls server.requestIP(req)?.address to get the client IP.
// Returning null here makes the auth layer receive Option.none() for clientIp,
// which is valid (trusted-proxy checks are skipped for basic auth anyway).
// ---------------------------------------------------------------------------

const mockServer = {
	requestIP: (_req: Request) => null,
} as unknown as import("bun").Server<unknown>;

// ---------------------------------------------------------------------------
// provisionUsers — set up users in a fresh DB before running steps
//
// For each user:
//  1. provisionUser creates the user row, principal, default calendar,
//     and address book (idempotent operation, but DB is fresh per script).
//  2. addCredential registers a "local" Basic auth credential.
//     The password stored is `test:<user.id>` (TestCryptoLayer format), so
//     when BasicAuthLayer verifies `password=id` it succeeds.
// ---------------------------------------------------------------------------

const provisionUsers = (
	users: ReadonlyArray<ScriptUser>,
): Effect.Effect<
	ReadonlyMap<string, ScriptUser>,
	never,
	ProvisioningService | UserService
> =>
	Effect.gen(function* () {
		const provisioningSvc = yield* ProvisioningService;
		const userSvc = yield* UserService;

		for (const scriptUser of users) {
			const localPart = scriptUser.email.split("@")[0] ?? scriptUser.id;
			const provisioned = yield* provisioningSvc
				.provisionUser({
					email: Email(scriptUser.email),
					name: scriptUser.name ?? localPart,
					slug: Slug(scriptUser.slug),
				})
				.pipe(Effect.orDie);

			yield* userSvc
				.addCredential(UserId(provisioned.user.user.id), {
					source: "local",
					authId: scriptUser.email,
					password: Redacted.make(scriptUser.id),
				})
				.pipe(Effect.orDie);
		}

		return new Map(users.map((u) => [u.id, u]));
	});

// ---------------------------------------------------------------------------
// buildRequest — construct a Request from a step definition
// ---------------------------------------------------------------------------

const buildRequest = (
	step: ScriptStep,
	userMap: ReadonlyMap<string, ScriptUser>,
): Request => {
	const headers = new Headers(step.headers ?? {});

	if (step.as !== undefined) {
		const user = userMap.get(step.as);
		if (!user) {
			throw new Error(
				`Script step "${step.name ?? step.path}" references unknown user id "${step.as}". ` +
					`Available user ids: ${[...userMap.keys()].join(", ")}`,
			);
		}
		headers.set("Authorization", `Basic ${btoa(`${user.email}:${user.id}`)}`);
	}

	return new Request(`http://localhost${step.path}`, {
		method: step.method,
		headers,
		body: step.body ?? null,
	});
};

// ---------------------------------------------------------------------------
// checkExpectations — compare response against step.expect
// ---------------------------------------------------------------------------

const checkExpectations = (
	step: ScriptStep,
	status: number,
	body: string,
): ReadonlyArray<string> => {
	const failures: Array<string> = [];
	const expect = step.expect;

	if (!expect) {
		return failures;
	}

	if (expect.status !== undefined && status !== expect.status) {
		failures.push(`expected status ${expect.status}, got ${status}`);
	}

	const contains: ReadonlyArray<string> =
		expect.bodyContains === undefined
			? []
			: typeof expect.bodyContains === "string"
				? [expect.bodyContains]
				: expect.bodyContains;

	for (const substr of contains) {
		if (!body.includes(substr)) {
			failures.push(`expected body to contain ${JSON.stringify(substr)}`);
		}
	}

	const notContains: ReadonlyArray<string> =
		expect.bodyNotContains === undefined
			? []
			: typeof expect.bodyNotContains === "string"
				? [expect.bodyNotContains]
				: expect.bodyNotContains;

	for (const substr of notContains) {
		if (body.includes(substr)) {
			failures.push(`expected body NOT to contain ${JSON.stringify(substr)}`);
		}
	}

	return failures;
};

// ---------------------------------------------------------------------------
// runScript — execute a sequence of DAV actions against handleRequest
//
// Each call gets a fresh PGlite database clone. Steps within a script share
// the same database, so earlier steps' side effects are visible to later ones.
//
// Returns one ScriptStepResult per step. Check result.failures for assertion
// outcomes; an empty array means the step passed all expectations.
//
// @example
// const results = await runScript([
//   { method: "MKCOL", path: "/dav/principals/test/cal/my-cal/",
//     as: "test", expect: { status: 201 } },
//   { method: "PROPFIND", path: "/dav/principals/test/cal/my-cal/",
//     as: "test", headers: { Depth: "0" }, body: propfindBody,
//     expect: { status: 207, bodyContains: "<D:multistatus" } },
// ])
// for (const result of results) {
//   expect(result.failures, result.step.name).toEqual([])
// }
// ---------------------------------------------------------------------------

export const runScript = async (
	steps: ReadonlyArray<ScriptStep>,
	options?: ScriptOptions,
): Promise<ReadonlyArray<ScriptStepResult>> => {
	const users = options?.users ?? [DEFAULT_USER];
	const runtime = ManagedRuntime.make(makeScriptRunnerLayer());

	try {
		// Provision users — this runs as a single Effect so errors surface early
		const userMap = await runtime.runPromise(provisionUsers(users));

		const results: Array<ScriptStepResult> = [];

		for (const step of steps) {
			const req = buildRequest(step, userMap);
			const response = await runtime.runPromise(handleRequest(req, mockServer));
			const body = await response.text();
			const failures = checkExpectations(step, response.status, body);

			results.push({ step, status: response.status, body, failures });
		}

		return results;
	} finally {
		await runtime.dispose();
	}
};
