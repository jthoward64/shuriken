import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option, Redacted } from "effect";
import { authenticateBasic } from "#src/auth/layers/basic.ts";
import { UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CryptoServiceLive } from "#src/platform/crypto.ts";
import { AppPasswordRepositoryLive } from "#src/services/app-password/repository.live.ts";
import { AppPasswordServiceLive } from "#src/services/app-password/service.live.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";

// ---------------------------------------------------------------------------
// Integration: app-password Basic auth (real argon2id over PGlite).
//
// Verifies that a generated app password authenticates under either the owner's
// principal slug or the credential's generated username, and that a wrong
// password is rejected.
// ---------------------------------------------------------------------------

const basicHeaders = (username: string, password: string): Headers => {
	const h = new Headers();
	h.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
	return h;
};

const makeLayer = () => {
	const infra = Layer.mergeAll(makePgliteDatabaseLayer(), CryptoServiceLive);
	const appPasswords = AppPasswordServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				infra,
				AppPasswordRepositoryLive.pipe(Layer.provide(infra)),
			),
		),
	);
	return Layer.mergeAll(
		infra,
		UserRepositoryLive.pipe(Layer.provide(infra)),
		appPasswords,
	);
};

describe("app-password Basic auth (integration)", () => {
	let layer: ReturnType<typeof makeLayer>;

	beforeAll(() => {
		layer = makeLayer();
	});

	it("authenticates by slug or generated username, rejects a wrong password", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const users = yield* UserRepository;
				const created = yield* users.create({
					slug: Slug("dave"),
					email: Email("dave@example.com"),
					credentials: [],
				});
				const userId = UserId(created.user.id);

				const appPasswords = yield* AppPasswordService;
				const generated = yield* appPasswords.generate({
					userId,
					label: Option.some("phone"),
				});
				const secret = Redacted.value(generated.password);

				const bySlug = yield* authenticateBasic(basicHeaders("dave", secret));
				const byUsername = yield* authenticateBasic(
					basicHeaders(generated.username, secret),
				);
				const wrong = yield* authenticateBasic(
					basicHeaders("dave", "not-the-password"),
				);

				return { userId, bySlug, byUsername, wrong };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(result.bySlug._tag).toBe("Authenticated");
		expect(result.byUsername._tag).toBe("Authenticated");
		expect(result.wrong._tag).toBe("Unauthenticated");
		if (result.bySlug._tag === "Authenticated") {
			expect(result.bySlug.principal.userId).toBe(result.userId);
		}
		if (result.byUsername._tag === "Authenticated") {
			expect(result.byUsername.principal.userId).toBe(result.userId);
		}
	});
});
