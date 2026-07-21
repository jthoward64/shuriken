import { expect } from "@std/expect";
import { beforeAll, describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option, Redacted } from "effect";
import { CompositeAuthLayer } from "#src/auth/layers/composite.ts";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CryptoServiceLive } from "#src/platform/crypto.ts";
import { AppPasswordRepositoryLive } from "#src/services/app-password/repository.live.ts";
import { AppPasswordServiceLive } from "#src/services/app-password/service.live.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";
import { SessionService } from "#src/services/session/service.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { makeTestConfig, testAppConfig } from "#src/testing/config.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";

// ---------------------------------------------------------------------------
// Integration: CompositeAuthLayer failed-attempt rate limiting.
//
// The rate limiter must only count requests that actually carry Basic
// credentials. Challenge-based clients (browsers, python-caldav, many DAV
// clients) always send an unauthenticated probe before retrying with a
// password; those probes must never accumulate toward the limit, or such a
// client locks its own IP out before it ever authenticates.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3;

const basicHeaders = (username: string, password: string): Headers => {
	const h = new Headers();
	h.set("Authorization", `Basic ${btoa(`${username}:${password}`)}`);
	return h;
};

// A stub session layer: the composite only calls `validate`, and only when a
// session cookie is present. These tests never send one, so None suffices.
const StubSessionLayer = Layer.succeed(SessionService, {
	create: () => Effect.die("not used"),
	validate: () => Effect.succeed(Option.none()),
	revoke: () => Effect.void,
});

const makeLayer = () => {
	const config = makeTestConfig({
		auth: { ...testAppConfig.auth, authRateLimitMaxAttempts: MAX_ATTEMPTS },
	});
	const infra = Layer.mergeAll(makePgliteDatabaseLayer(), CryptoServiceLive);
	const appPasswords = AppPasswordServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				infra,
				AppPasswordRepositoryLive.pipe(Layer.provide(infra)),
			),
		),
	);
	const auth = CompositeAuthLayer.pipe(
		Layer.provide(
			Layer.mergeAll(
				infra,
				StubSessionLayer,
				Layer.succeed(AppConfigService, config),
			),
		),
	);
	return Layer.mergeAll(
		infra,
		auth,
		UserRepositoryLive.pipe(Layer.provide(infra)),
		appPasswords,
	);
};

// Provisions a user with a working app password and returns its credentials.
const provisionAppPassword = Effect.gen(function* () {
	const users = yield* UserRepository;
	const created = yield* users.create({
		slug: Slug("dave"),
		email: Email("dave@example.com"),
		credentials: [],
	});
	const appPasswords = yield* AppPasswordService;
	const generated = yield* appPasswords.generate({
		userId: UserId(created.user.id),
		label: Option.some("phone"),
	});
	return {
		username: generated.username,
		secret: Redacted.value(generated.password),
	};
});

describe("CompositeAuthLayer rate limiting (integration)", () => {
	let layer: ReturnType<typeof makeLayer>;

	beforeAll(() => {
		layer = makeLayer();
	});

	it("does not count credential-less probes toward the rate limit", async () => {
		const clientIp = Option.some("203.0.113.7");
		const result = await runSuccess(
			Effect.gen(function* () {
				const { username, secret } = yield* provisionAppPassword;
				const auth = yield* AuthService;

				// Far more unauthenticated probes than the limit — a challenge-based
				// client hammering the endpoint before it has been challenged.
				for (let i = 0; i < MAX_ATTEMPTS * 3; i++) {
					const probe = yield* auth.authenticate(new Headers(), clientIp);
					expect(probe._tag).toBe("Unauthenticated");
				}

				// The valid credential must still authenticate from the same IP.
				return yield* auth.authenticate(
					basicHeaders(username, secret),
					clientIp,
				);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(result._tag).toBe("Authenticated");
	});

	it("locks out an IP after too many wrong-password attempts", async () => {
		const clientIp = Option.some("203.0.113.99");
		const result = await runSuccess(
			Effect.gen(function* () {
				const { username, secret } = yield* provisionAppPassword;
				const auth = yield* AuthService;

				// Exhaust the limit with genuine wrong-password attempts.
				for (let i = 0; i < MAX_ATTEMPTS; i++) {
					const bad = yield* auth.authenticate(
						basicHeaders(username, "wrong-password"),
						clientIp,
					);
					expect(bad._tag).toBe("Unauthenticated");
				}

				// Even the correct password is now rejected without being checked.
				return yield* auth.authenticate(
					basicHeaders(username, secret),
					clientIp,
				);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(result._tag).toBe("Unauthenticated");
	});
});
