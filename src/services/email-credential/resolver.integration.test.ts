import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime, Option, Redacted } from "effect";
import { UserId as makeUserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";

// ---------------------------------------------------------------------------
// EmailCredentialService.resolveForUser end-to-end across the four scenarios
// the chained resolver supports. Each `it` builds its own runtime with the
// specific mail config it cares about — overrides are not in-flight on a
// single shared runtime because AppConfigService is layer-baked.
// ---------------------------------------------------------------------------

const MAIL_KEY = "test-mail-creds-key";

interface MailOverride {
	readonly enabled?: boolean;
	readonly defaultHost?: string;
	readonly defaultFromAddress?: string;
	readonly defaultFromName?: string;
	readonly profiles?: ReadonlyArray<{
		pattern: string;
		host: string;
		port: number;
		username: string;
		password: string;
		security?: "none" | "starttls" | "tls";
	}>;
	readonly credsKey?: string;
}

const buildMail = (mail: MailOverride) => ({
	enabled: mail.enabled ?? false,
	defaultFromAddress: mail.defaultFromAddress ?? "",
	defaultFromName: mail.defaultFromName ?? "",
	defaultHost: mail.defaultHost ?? "",
	defaultPort: 587,
	defaultUsername: "",
	defaultPassword: "",
	defaultSecurity: "starttls" as const,
	credsKey: mail.credsKey ?? "",
	lmtpEnabled: false,
	lmtpPort: 2400,
	lmtpHost: "127.0.0.1",
	profiles: mail.profiles ?? [],
	proxyUsernameHeader: Option.none<string>(),
	proxyPasswordHeader: Option.none<string>(),
	proxyHostHeader: Option.none<string>(),
	proxyPortHeader: Option.none<string>(),
	proxySecurityHeader: Option.none<string>(),
});

const provisionAlice = Effect.gen(function* () {
	const prov = yield* ProvisioningService;
	const alice = yield* prov
		.provisionUser({
			email: Email("alice@example.com"),
			name: "Alice",
			slug: Slug("alice"),
		})
		.pipe(Effect.orDie);
	return makeUserId(alice.user.user.id);
});

describe("EmailCredentialService resolver (integration)", () => {
	it("returns null when mail is disabled", async () => {
		const runtime = ManagedRuntime.make(
			makeScriptRunnerLayer({ mail: buildMail({ enabled: false }) }),
		);
		try {
			const userId = await runtime.runPromise(provisionAlice);
			const result = await runtime.runPromise(
				Effect.flatMap(EmailCredentialService, (s) =>
					s.resolveForUser(userId, "alice@example.com", "Alice"),
				),
			);
			expect(result).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it("falls back to the default mailer with Reply-To set", async () => {
		const runtime = ManagedRuntime.make(
			makeScriptRunnerLayer({
				mail: buildMail({
					enabled: true,
					defaultHost: "mail.shuriken",
					defaultFromAddress: "noreply@shuriken",
					defaultFromName: "Shuriken Mailer",
				}),
			}),
		);
		try {
			const userId = await runtime.runPromise(provisionAlice);
			const result = await runtime.runPromise(
				Effect.flatMap(EmailCredentialService, (s) =>
					s.resolveForUser(userId, "alice@example.com", "Alice"),
				),
			);
			expect(result?.kind).toBe("default");
			expect(result?.fromAddress).toBe("noreply@shuriken");
			expect(result?.replyTo).toBe("alice@example.com");
		} finally {
			await runtime.dispose();
		}
	});

	it("matches a server-wide profile and sends as the user", async () => {
		const runtime = ManagedRuntime.make(
			makeScriptRunnerLayer({
				mail: buildMail({
					enabled: true,
					defaultHost: "fallback",
					defaultFromAddress: "noreply@shuriken",
					profiles: [
						{
							pattern: "^.*@example\\.com$",
							host: "smtp.example.com",
							port: 587,
							username: "relay",
							password: "p",
							security: "starttls",
						},
					],
				}),
			}),
		);
		try {
			const userId = await runtime.runPromise(provisionAlice);
			const result = await runtime.runPromise(
				Effect.flatMap(EmailCredentialService, (s) =>
					s.resolveForUser(userId, "alice@example.com", "Alice"),
				),
			);
			expect(result?.kind).toBe("profile");
			expect(result?.host).toBe("smtp.example.com");
			expect(result?.fromAddress).toBe("alice@example.com");
			expect(result?.replyTo).toBeNull();
		} finally {
			await runtime.dispose();
		}
	});

	it("prefers per-user creds when stored", async () => {
		const runtime = ManagedRuntime.make(
			makeScriptRunnerLayer({
				mail: buildMail({
					enabled: true,
					defaultHost: "fallback",
					defaultFromAddress: "noreply@shuriken",
					credsKey: MAIL_KEY,
				}),
			}),
		);
		try {
			const userId = await runtime.runPromise(provisionAlice);
			await runtime.runPromise(
				Effect.flatMap(EmailCredentialService, (s) =>
					s.storeForUser({
						userId,
						fromAddress: "alice@my-isp.example",
						fromName: "Alice from ISP",
						host: "smtp.my-isp.example",
						port: 465,
						username: "alice@my-isp.example",
						password: Redacted.make("isp-password"),
						security: "tls",
					}),
				),
			);

			const result = await runtime.runPromise(
				Effect.flatMap(EmailCredentialService, (s) =>
					s.resolveForUser(userId, "alice@example.com", "Alice"),
				),
			);
			expect(result?.kind).toBe("user");
			expect(result?.host).toBe("smtp.my-isp.example");
			expect(result?.port).toBe(465);
			expect(result?.fromAddress).toBe("alice@my-isp.example");
			expect(result?.replyTo).toBeNull();
			expect(result?.password ? Redacted.value(result.password) : null).toBe(
				"isp-password",
			);
		} finally {
			await runtime.dispose();
		}
	});
});
