import { Effect, Option } from "effect";
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
