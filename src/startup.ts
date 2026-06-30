import { Effect, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
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

// ---------------------------------------------------------------------------
// autoLoginStartup — runs at application boot when AUTO_LOGIN is set.
//
// Provisions the configured user if they do not already exist, derives the
// user's slug and name from the local part of the email address (everything
// before the @), and ensures they have DAV:all on virtual resources so the
// web UI management functions work correctly. Idempotent.
// ---------------------------------------------------------------------------

export const autoLoginStartup: Effect.Effect<
	void,
	DavError | DatabaseError | ConflictError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;

	if (
		Option.isNone(config.auth.autoLogin) ||
		config.auth.autoLogin.value === ""
	) {
		return;
	}

	const adminEmailStr = config.auth.autoLogin.value;
	const email = Email(adminEmailStr);
	const principalSvc = yield* PrincipalService;
	const provisioningSvc = yield* ProvisioningService;

	const existing = yield* principalSvc.findByEmail(email).pipe(
		Effect.map((p) => Option.some(p)),
		Effect.catchTag("DavError", (e) =>
			e.status === HTTP_NOT_FOUND
				? Effect.succeed(Option.none())
				: Effect.fail(e),
		),
	);

	let principalId: PrincipalId;

	if (Option.isSome(existing)) {
		yield* Effect.logDebug("auto-login user already provisioned", { email });
		principalId = existing.value.principal.id as PrincipalId;
	} else {
		const localPart = adminEmailStr.split("@")[0] ?? adminEmailStr;
		const result = yield* provisioningSvc.provisionUser({
			email,
			name: localPart,
			slug: Slug(localPart),
		});
		principalId = result.user.principal.id as PrincipalId;
	}

	yield* provisioningSvc.ensureAdminAces(principalId);
});

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
// ---------------------------------------------------------------------------

export const basicAuthStartup: Effect.Effect<
	void,
	DavError | DatabaseError | ConflictError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;

	if (!config.auth.basicAuthEnabled || Option.isNone(config.auth.adminEmail)) {
		return;
	}

	const adminEmailStr = config.auth.adminEmail.value;
	const email = Email(adminEmailStr);
	const principalSvc = yield* PrincipalService;
	const provisioningSvc = yield* ProvisioningService;

	const existing = yield* principalSvc.findByEmail(email).pipe(
		Effect.map((p) => Option.some(p)),
		Effect.catchTag("DavError", (e) =>
			e.status === HTTP_NOT_FOUND
				? Effect.succeed(Option.none())
				: Effect.fail(e),
		),
	);

	let principalId: PrincipalId;

	if (Option.isSome(existing)) {
		yield* Effect.logDebug("basic-auth: admin user already exists", { email });
		principalId = existing.value.principal.id as PrincipalId;
	} else {
		const localPart = adminEmailStr.split("@")[0] ?? adminEmailStr;
		const slug = Slug(Option.getOrElse(config.auth.adminSlug, () => localPart));

		// Generate a random password if ADMIN_PASSWORD is not configured.
		const plainPassword = Option.isNone(config.auth.adminPassword)
			? Option.some(generateRandomPassword())
			: Option.none<string>();
		const password = Option.match(plainPassword, {
			onSome: Redacted.make,
			onNone: () => Option.getOrThrow(config.auth.adminPassword),
		});

		const result = yield* provisioningSvc.provisionUser({
			email,
			name: localPart,
			slug,
			credentials: [{ source: "local", authId: adminEmailStr, password }],
			// Preserve the pre-roles "admin = full power" expectation.
			// Operators who want a less-privileged admin can demote later via UI.
			role: "super_admin",
		});
		principalId = result.user.principal.id as PrincipalId;

		yield* Effect.logInfo("basic-auth: admin user provisioned", { email });

		Option.match(plainPassword, {
			onSome: (p) => {
				console.log(
					`\n*** shuriken-ts: default admin credentials ***\n  Email:    ${email}\n  Password: ${p}\n  Save this password — it will not be shown again.\n`,
				);
			},
			onNone: () => {},
		});
	}

	yield* provisioningSvc.ensureAdminAces(principalId);
});
