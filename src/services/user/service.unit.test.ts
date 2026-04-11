import { describe, expect, it } from "bun:test";
import { Effect, Redacted } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { HTTP_CONFLICT, HTTP_NOT_FOUND } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import type { NewUser } from "./service.ts";
import { UserService } from "./service.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const newUser = (overrides: Partial<NewUser> = {}): NewUser => ({
	slug: Slug("alice"),
	email: Email("alice@example.com"),
	...overrides,
});

// ---------------------------------------------------------------------------
// UserService.create
// ---------------------------------------------------------------------------

describe("UserService.create", () => {
	it("returned user is immediately visible in the shared stores", async () => {
		// Tests that create writes to the shared principal + user stores so that
		// subsequent service operations on the same layer see the created data.
		const env = makeTestEnv();
		const created = await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) => s.create(newUser())),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(env.stores.users.get(created.user.id)?.email).toBe(
			"alice@example.com",
		);
		expect(env.stores.principals.get(created.principal.id)?.slug).toBe("alice");
	});

	it("hashes local credential password via CryptoService before storing", async () => {
		// Tests that the service delegates hashing to CryptoService, not raw storage.
		// TestCryptoLayer prepends "test:" — if the service bypassed crypto and stored
		// the raw password, this assertion would fail.
		const env = makeTestEnv();
		await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.create(
						newUser({
							credentials: [
								{
									source: "local",
									authId: "alice-local",
									password: Redacted.make("hunter2"),
								},
							],
						}),
					),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		const cred = env.stores.credentials.get("local:alice-local");
		expect(cred).toBeDefined();
		// Raw "hunter2" stored here would mean CryptoService was bypassed
		expect(Redacted.value(cred?.authCredential ?? Redacted.make(""))).toBe(
			"test:hunter2",
		);
	});

	it("stores proxy credential with authId as the credential value (no password)", async () => {
		// The service's hashCredential for proxy source stores authId wrapped in Some
		// (see service.live.ts). Proxy auth doesn't use a password; the proxy already
		// authenticated the user, so authId is treated as the credential token.
		const env = makeTestEnv();
		await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.create(
						newUser({
							credentials: [{ source: "proxy", authId: "alice@sso.corp" }],
						}),
					),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		const cred = env.stores.credentials.get("proxy:alice@sso.corp");
		expect(cred).toBeDefined();
		expect(Redacted.value(cred?.authCredential ?? Redacted.make(""))).toBe(
			"alice@sso.corp",
		);
	});
});

// ---------------------------------------------------------------------------
// UserService.update
// ---------------------------------------------------------------------------

describe("UserService.update", () => {
	it("updates only the specified fields; unspecified fields are unchanged", async () => {
		const userId = crypto.randomUUID();
		const env = makeTestEnv().withUser({
			id: userId,
			email: "alice@example.com",
			slug: "alice",
		});
		const result = await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.update(UserId(userId), { displayName: "Alice Smith" }),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result.principal.displayName).toBe("Alice Smith");
		// Email was not in the update payload — must be unchanged
		expect(result.user.email).toBe("alice@example.com");
	});

	it("allows updating email to the user's own current email (not a conflict)", async () => {
		// The duplicate-email check in service.live.ts skips when existing.user.id === id.
		// If this guard is broken, users cannot save their own profile without changing email.
		const userId = crypto.randomUUID();
		const env = makeTestEnv().withUser({
			id: userId,
			email: "alice@example.com",
			slug: "alice",
		});
		const result = await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.update(UserId(userId), { email: Email("alice@example.com") }),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result.user.email).toBe("alice@example.com");
	});

	it("fails with 404 for an unknown user id", async () => {
		const env = makeTestEnv();
		const err = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.update(UserId(crypto.randomUUID()), { displayName: "Ghost" }),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});

	it("fails with 409 when the new email is taken by a different user", async () => {
		const aliceId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ id: aliceId, email: "alice@example.com", slug: "alice" })
			.withUser({ email: "bob@example.com", slug: "bob" });

		const err = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.update(UserId(aliceId), { email: Email("bob@example.com") }),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_CONFLICT);
	});
});

// ---------------------------------------------------------------------------
// UserService.addCredential / removeCredential
// ---------------------------------------------------------------------------

describe("UserService.addCredential", () => {
	it("fails with 404 when the user does not exist", async () => {
		const env = makeTestEnv();
		const err = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.addCredential(UserId(crypto.randomUUID()), {
						source: "proxy",
						authId: "nobody",
					}),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});

	it("fails with 409 when the credential (authSource + authId) already exists", async () => {
		const userId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ id: userId, email: "alice@example.com", slug: "alice" })
			.withCredential({ userId, authSource: "local", authId: "alice" });

		const err = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.addCredential(UserId(userId), {
						source: "local",
						authId: "alice",
						password: Redacted.make("newpass"),
					}),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_CONFLICT);
	});

	it("add → conflict → remove → add again: full credential lifecycle", async () => {
		// Exercises the full add/remove cycle through the service contract,
		// verifying that remove actually unblocks a subsequent add.
		const userId = crypto.randomUUID();
		const env = makeTestEnv().withUser({
			id: userId,
			email: "alice@example.com",
			slug: "alice",
		});
		const layer = env.toLayer();

		await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.addCredential(UserId(userId), {
						source: "local",
						authId: "alice-tmp",
						password: Redacted.make("pass"),
					}),
				),
				Effect.orDie,
				Effect.provide(layer),
			),
		);

		// Duplicate add must conflict
		const addErr = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.addCredential(UserId(userId), {
						source: "local",
						authId: "alice-tmp",
						password: Redacted.make("pass2"),
					}),
				),
				Effect.provide(layer),
			),
		)) as DavError;
		expect(addErr.status).toBe(HTTP_CONFLICT);

		// Remove clears the credential
		await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.removeCredential(UserId(userId), "local", "alice-tmp"),
				),
				Effect.orDie,
				Effect.provide(layer),
			),
		);

		// Add again must succeed now that the credential is gone
		await runSuccess(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.addCredential(UserId(userId), {
						source: "local",
						authId: "alice-tmp",
						password: Redacted.make("pass3"),
					}),
				),
				Effect.orDie,
				Effect.provide(layer),
			),
		);
	});
});

describe("UserService.removeCredential", () => {
	it("fails with 404 when the user does not exist", async () => {
		const env = makeTestEnv();
		const err = (await runFailure(
			UserService.pipe(
				Effect.flatMap((s) =>
					s.removeCredential(UserId(crypto.randomUUID()), "local", "nobody"),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});
