import { Effect, Option, Redacted } from "effect";
import type { AppConfigService } from "#src/config.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { renderAppPasswordsPage } from "#src/http/ui/handlers/profile/app-passwords.tsx";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/profile/app-passwords/create
//
// Generates a new app password and re-renders the page with the plaintext
// secret shown once (it is never recoverable afterwards).
// ---------------------------------------------------------------------------

const MAX_LABEL_LENGTH = 100;

export const appPasswordsCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | AppPasswordService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* AppPasswordService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});
		const rawLabel = (form.get("label")?.toString() ?? "")
			.trim()
			.slice(0, MAX_LABEL_LENGTH);
		const label =
			rawLabel.length === 0 ? Option.none<string>() : Option.some(rawLabel);

		const generated = yield* svc.generate({ userId: principal.userId, label });

		return yield* renderAppPasswordsPage(
			ctx,
			principal,
			Option.some({
				username: generated.username,
				password: Redacted.value(generated.password),
			}),
		);
	});
