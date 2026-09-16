import { Effect, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { type Email, parseEmail } from "#src/domain/types/strings.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";

const RANDOM_PASSWORD_BYTES = 16;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

const generateRandomPassword = (): string => {
	const bytes = new Uint8Array(RANDOM_PASSWORD_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) =>
		b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"),
	).join("");
};

// Local part of an email address, the default slug and display name for a
// user provisioned from a bare email in configuration
const emailLocalPart = (email: string): string => email.split("@")[0] ?? email;

// Find a user principal by email, treating "no such user" as None rather than
// a failure, since startup provisioning expects it on first boot
const findUserByEmail = (email: Email) =>
	Effect.gen(function* () {
		const principals = yield* PrincipalService;
		return yield* principals.findByEmail(email).pipe(
			Effect.asSome,
			Effect.catchTag("DavError", (e) =>
				e.status === HTTP_NOT_FOUND
					? Effect.succeed(Option.none())
					: Effect.fail(e),
			),
		);
	});

// Whether a live user principal already holds this slug. Startup looks the
// user up by email but provisions by slug, so a mismatch between the two (a
// renamed account, a stale config value) would otherwise only surface as a
// unique-index violation on `unique_principal_slug_per_type`
const slugTaken = (slug: Slug) =>
	Effect.gen(function* () {
		const principals = yield* PrincipalService;
		return yield* principals.findBySlug(slug).pipe(
			Effect.as(true),
			Effect.catchTag("DavError", (e) =>
				e.status === HTTP_NOT_FOUND ? Effect.succeed(false) : Effect.fail(e),
			),
		);
	});

// A conflict at this point means the email and slug pre-checks disagreed with
// the database (a concurrent boot, or an email collision). Provisioning is a
// convenience, so warn and let the server come up rather than aborting startup
const warnOnConflict = (context: string, field: string) =>
	Effect.logWarning(
		`${context}: user provisioning conflicted with an existing user; skipping`,
		{ field },
	);

// ---------------------------------------------------------------------------
// autoLoginStartup — runs at application boot when AUTO_LOGIN is set.
//
// Provisions the configured user if they do not already exist yet, deriving
// the user's slug and name from the local part of the email address
// (everything before the @). A newly-provisioned AUTO_LOGIN user is granted
// DAV:all on virtual resources so the web UI management functions work out
// of the box for the bootstrap case. If the user already exists, their
// existing role/ACEs are left untouched — AUTO_LOGIN can be pointed at any
// already-provisioned user (admin or not) to authenticate as exactly that
// user, without silently escalating their privileges. Idempotent.
//
// Never fails startup on a name clash: when the email matches no user but the
// derived slug is taken, it warns and steps aside. Auto-login auth itself
// falls back to the first user in that case (see `resolveAutoLoginPrincipal`).
// ---------------------------------------------------------------------------

const autoLoginBootstrap = (configuredEmail: string) =>
	Effect.gen(function* () {
		const provisioning = yield* ProvisioningService;
		const email = parseEmail(configuredEmail);
		const name = emailLocalPart(configuredEmail);
		const slug = Slug(name);

		yield* Option.match(yield* findUserByEmail(email), {
			onSome: () =>
				Effect.logDebug("auto-login user already provisioned", { email }),
			onNone: () =>
				Effect.gen(function* () {
					if (yield* slugTaken(slug)) {
						return yield* Effect.logWarning(
							"auto-login: AUTO_LOGIN matches no user and its derived slug belongs to another user; skipping provisioning",
							{ email, slug },
						);
					}
					const result = yield* provisioning.provisionUser({
						email,
						name,
						slug,
					});
					yield* provisioning.ensureAdminAces(
						result.user.principal.id as PrincipalId,
					);
				}),
		});
	});

export const autoLoginStartup: Effect.Effect<
	void,
	DavError | DatabaseError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;
	yield* Option.match(config.auth.autoLogin, {
		onNone: () => Effect.void,
		onSome: autoLoginBootstrap,
	});
}).pipe(
	Effect.catchTag("ConflictError", (e) =>
		warnOnConflict("auto-login", e.field),
	),
);

// ---------------------------------------------------------------------------
// oidcStartup — config sanity check when OIDC is enabled. Discovery itself is
// lazy (first login), so this only warns about missing required settings.
// ---------------------------------------------------------------------------

export const oidcStartup: Effect.Effect<void, never, AppConfigService> =
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		if (!config.auth.oidcEnabled) {
			return;
		}
		const missing: Array<string> = [];
		if (Option.isNone(config.auth.oidcIssuer)) {
			missing.push("OIDC_ISSUER");
		}
		if (Option.isNone(config.auth.oidcClientId)) {
			missing.push("OIDC_CLIENT_ID");
		}
		if (missing.length > 0) {
			yield* Effect.logWarning(
				"OIDC is enabled but required configuration is missing; web login will fail",
				{ missing },
			);
		} else {
			yield* Effect.logInfo("OIDC web login enabled", {
				issuer: Option.getOrUndefined(config.auth.oidcIssuer),
			});
		}
	});

// ---------------------------------------------------------------------------
// basicAuthStartup — runs when basic auth is enabled and ADMIN_EMAIL is set.
//
// If ADMIN_PASSWORD is not set, generates a random password and prints it
// to stdout — the operator must save it, as it will not be shown again.
// ADMIN_SLUG defaults to the local part of ADMIN_EMAIL.
// Idempotent: succeeds without action when the user already exists. Always
// ensures the admin user has DAV:all on virtual resources.
//
// When ADMIN_EMAIL matches no user but the admin slug is held by someone
// else, it warns and provisions nothing; the slug owner is left alone rather
// than being handed the admin ACEs.
// ---------------------------------------------------------------------------

const provisionAdminUser = (
	configuredEmail: string,
	slug: Slug,
	configuredPassword: Option.Option<Redacted.Redacted<string>>,
) =>
	Effect.gen(function* () {
		const provisioning = yield* ProvisioningService;
		const email = parseEmail(configuredEmail);

		// A generated password is the operator's only copy, so keep the plaintext
		// around to print; a configured one is never echoed
		const credential = Option.match(configuredPassword, {
			onSome: (password) => ({ password, generated: Option.none<string>() }),
			onNone: () => {
				const plain = generateRandomPassword();
				return {
					password: Redacted.make(plain),
					generated: Option.some(plain),
				};
			},
		});

		const result = yield* provisioning.provisionUser({
			email,
			name: emailLocalPart(configuredEmail),
			slug,
			credentials: [
				{
					source: "local",
					authId: configuredEmail,
					password: credential.password,
				},
			],
			// Preserve the pre-roles "admin = full power" expectation.
			// Operators who want a less-privileged admin can demote later via UI.
			role: "super_admin",
		});

		yield* Effect.logInfo("basic-auth: admin user provisioned", { email });

		Option.match(credential.generated, {
			onSome: (p) => {
				console.log(
					`\n*** shuriken-ts: default admin credentials ***\n  Email:    ${email}\n  Password: ${p}\n  Save this password — it will not be shown again.\n`,
				);
			},
			onNone: () => {},
		});

		return Option.some(result.user.principal.id as PrincipalId);
	});

const basicAuthBootstrap = (configuredEmail: string) =>
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const provisioning = yield* ProvisioningService;
		const email = parseEmail(configuredEmail);
		const slug = Slug(
			Option.getOrElse(config.auth.adminSlug, () =>
				emailLocalPart(configuredEmail),
			),
		);

		const principalId = yield* Option.match(yield* findUserByEmail(email), {
			onSome: (existing) =>
				Effect.logDebug("basic-auth: admin user already exists", {
					email,
				}).pipe(Effect.as(Option.some(existing.principal.id as PrincipalId))),
			onNone: () =>
				Effect.gen(function* () {
					if (yield* slugTaken(slug)) {
						yield* Effect.logWarning(
							"basic-auth: ADMIN_EMAIL matches no user and the admin slug belongs to another user; skipping provisioning",
							{ email, slug },
						);
						return Option.none<PrincipalId>();
					}
					return yield* provisionAdminUser(
						configuredEmail,
						slug,
						config.auth.adminPassword,
					);
				}),
		});

		yield* Option.match(principalId, {
			onSome: (id) => provisioning.ensureAdminAces(id),
			onNone: () => Effect.void,
		});
	});

export const basicAuthStartup: Effect.Effect<
	void,
	DavError | DatabaseError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;
	if (!config.auth.basicAuthEnabled) {
		return;
	}
	yield* Option.match(config.auth.adminEmail, {
		onNone: () => Effect.void,
		onSome: basicAuthBootstrap,
	});
}).pipe(
	Effect.catchTag("ConflictError", (e) =>
		warnOnConflict("basic-auth", e.field),
	),
);
