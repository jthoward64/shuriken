import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/profile/email-credentials — form for managing per-user SMTP creds.
//
// Shows the saved configuration (without revealing the encrypted password)
// plus a description of which layer would currently be used to send mail
// for this user (per-user / profile / default / disabled).
// ---------------------------------------------------------------------------

export const emailCredentialsPageHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| TemplateService
	| UserEmailCredentialRepository
	| UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const userService = yield* UserService;
		const repo = yield* UserEmailCredentialRepository;

		const { user } = yield* userService.findById(principal.userId);
		const existingOpt = yield* repo.findByUserId(principal.userId);
		const existing = Option.getOrUndefined(existingOpt);

		// Reproduce the resolution chain for display purposes (read-only).
		let activeKind: "user" | "profile" | "default" | "disabled" = "disabled";
		let activeFromAddress = "";
		if (config.mail.enabled) {
			if (existing && config.mail.credsKey !== "") {
				activeKind = "user";
				activeFromAddress = existing.fromAddress;
			} else {
				const matched = config.mail.profiles.find((p) => {
					try {
						return new RegExp(p.pattern).test(user.email);
					} catch {
						return false;
					}
				});
				if (matched) {
					activeKind = "profile";
					activeFromAddress = user.email;
				} else if (
					config.mail.defaultHost !== "" &&
					config.mail.defaultFromAddress !== ""
				) {
					activeKind = "default";
					activeFromAddress = config.mail.defaultFromAddress;
				}
			}
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/profile/email-credentials",
			{
				...nav,
				pageTitle: "Email credentials",
				userEmail: user.email,
				existing: existing
					? {
							fromAddress: existing.fromAddress,
							fromName: existing.fromName ?? "",
							host: existing.host,
							port: existing.port,
							username: existing.username,
							security: existing.security,
						}
					: null,
				mailEnabled: config.mail.enabled,
				credsKeyConfigured: config.mail.credsKey !== "",
				activeKind,
				activeFromAddress,
			},
			ctx.headers,
		);
	});
