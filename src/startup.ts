import { Effect, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	ConfigError,
	type ConflictError,
	type DatabaseError,
	type DavError,
	type InternalError,
} from "#src/domain/errors.ts";
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
// Requires SINGLE_USER_EMAIL to be set; fails with ConfigError if absent.
// Derives the user's slug and name from the local part of the email address
// (everything before the @). Idempotent: succeeds without action when the
// user already exists.
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

	const emailOpt = config.auth.singleUserEmail;
	if (Option.isNone(emailOpt)) {
		return yield* Effect.fail(new ConfigError({ key: "singleUserEmail" }));
	}

	const email = Email(emailOpt.value);

	const principalSvc = yield* PrincipalService;
	const alreadyExists = yield* principalSvc.findByEmail(email).pipe(
		Effect.as(true),
		Effect.catchTag("DavError", (e) =>
			e.status === HTTP_NOT_FOUND ? Effect.succeed(false) : Effect.fail(e),
		),
	);

	if (alreadyExists) {
		yield* Effect.logDebug("single-user already provisioned", { email });
		return;
	}

	const localPart = emailOpt.value.split("@")[0] ?? emailOpt.value;
	const provisioningSvc = yield* ProvisioningService;

	yield* provisioningSvc.provisionUser({
		email,
		name: localPart,
		slug: Slug(localPart),
	});
});

// ---------------------------------------------------------------------------
// basicAuthStartup — runs at application boot when AUTH_MODE=basic.
//
// Requires ADMIN_EMAIL to be set; fails with ConfigError if absent.
// If ADMIN_PASSWORD is not set, generates a random password and prints it
// to stdout — the operator must save it, as it will not be shown again.
// ADMIN_SLUG defaults to the local part of ADMIN_EMAIL.
// Idempotent: succeeds without action when the user already exists.
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
	const alreadyExists = yield* principalSvc.findByEmail(email).pipe(
		Effect.as(true),
		Effect.catchTag("DavError", (e) =>
			e.status === HTTP_NOT_FOUND ? Effect.succeed(false) : Effect.fail(e),
		),
	);

	if (alreadyExists) {
		yield* Effect.logDebug("basic-auth: admin user already exists", { email });
		return;
	}

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

	const provisioningSvc = yield* ProvisioningService;
	yield* provisioningSvc.provisionUser({
		email,
		name: localPart,
		slug,
		credentials: [{ source: "local", authId: adminEmailStr, password }],
	});

	yield* Effect.logInfo("basic-auth: admin user provisioned", { email });

	Option.match(plainPassword, {
		onSome: (p) => {
			console.log(
				`\n*** shuriken-ts: default admin credentials ***\n  Email:    ${email}\n  Password: ${p}\n  Save this password — it will not be shown again.\n`,
			);
		},
		onNone: () => {},
	});
});
