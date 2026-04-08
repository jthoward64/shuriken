import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { PrincipalService } from "./service.ts";

// ---------------------------------------------------------------------------
// PrincipalService.findById
// ---------------------------------------------------------------------------

describe("PrincipalService.findById", () => {
	it("returns the principal+user when found", async () => {
		const env = makeTestEnv();
		const principalId = crypto.randomUUID();
		env.withUser({ principalId, slug: "alice", name: "Alice" });

		const result = await runSuccess(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findById(PrincipalId(principalId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.principal.id).toBe(principalId);
		expect(result.user.name).toBe("Alice");
	});

	it("fails with 404 for an unknown id", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findById(PrincipalId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// PrincipalService.findBySlug
// ---------------------------------------------------------------------------

describe("PrincipalService.findBySlug", () => {
	it("returns the principal+user when found", async () => {
		const env = makeTestEnv();
		env.withUser({ slug: "bob", name: "Bob" });

		const result = await runSuccess(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findBySlug(Slug("bob"))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.principal.slug).toBe("bob");
		expect(result.user.name).toBe("Bob");
	});

	it("fails with 404 for an unknown slug", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findBySlug(Slug("nobody"))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// PrincipalService.findByEmail
// ---------------------------------------------------------------------------

describe("PrincipalService.findByEmail", () => {
	it("returns the principal+user when found", async () => {
		const env = makeTestEnv();
		env.withUser({ email: "carol@example.com", name: "Carol" });

		const result = await runSuccess(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findByEmail(Email("carol@example.com"))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.user.email).toBe("carol@example.com");
		expect(result.user.name).toBe("Carol");
	});

	it("fails with 404 for an unknown email", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			PrincipalService.pipe(
				Effect.flatMap((s) => s.findByEmail(Email("ghost@example.com"))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});
