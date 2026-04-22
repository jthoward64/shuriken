import { Effect, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	ConfigError,
	type ConflictError,
	type DatabaseError,
	type DavError,
	type InternalError,
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
// singleUserStartup — runs at application boot when AUTH_MODE=single-user.
//
// Requires ADMIN_EMAIL to be set; fails with ConfigError if absent.
// Derives the user's slug and name from the local part of the email address
// (everything before the @). Idempotent: succeeds without action when the
// user already exists. Always ensures the admin user has DAV:all on virtual
// resources so that the web UI management functions work correctly.
// ---------------------------------------------------------------------------

export const singleUserStartup: Effect.Effect<
	void,
	ConfigError | DavError | DatabaseError | ConflictError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;

	if (config.auth.mode !== "single-user") {
		return;
	}

	if (Option.isNone(config.auth.adminEmail)) {
		return yield* Effect.fail(new ConfigError({ key: "adminEmail" }));
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
		yield* Effect.logDebug("single-user already provisioned", { email });
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
// basicAuthStartup — runs at application boot when AUTH_MODE=basic.
//
// Requires ADMIN_EMAIL to be set; fails with ConfigError if absent.
// If ADMIN_PASSWORD is not set, generates a random password and prints it
// to stdout — the operator must save it, as it will not be shown again.
// ADMIN_SLUG defaults to the local part of ADMIN_EMAIL.
// Idempotent: succeeds without action when the user already exists. Always
// ensures the admin user has DAV:all on virtual resources.
// ---------------------------------------------------------------------------

export const basicAuthStartup: Effect.Effect<
	void,
	ConfigError | DavError | DatabaseError | ConflictError | InternalError,
	AppConfigService | PrincipalService | ProvisioningService
> = Effect.gen(function* () {
	const config = yield* AppConfigService;

	if (config.auth.mode !== "basic") {
		return;
	}

	if (Option.isNone(config.auth.adminEmail)) {
		return yield* Effect.fail(new ConfigError({ key: "adminEmail" }));
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
