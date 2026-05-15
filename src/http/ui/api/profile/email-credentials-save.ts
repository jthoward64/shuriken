import { Effect, Redacted } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import type { SmtpSecurity } from "#src/db/drizzle/schema/index.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/profile/email-credentials/save
//
// Saves the per-user SMTP creds. The password is sent in the form (over
// HTTPS) and encrypted server-side via EMAIL_CREDS_KEY before storage.
// Empty password = "leave existing password unchanged" — the form blanks
// the field on every render so admins/users don't accidentally re-submit
// it round-trip.
// ---------------------------------------------------------------------------

const ALLOWED_SECURITY = new Set<SmtpSecurity>(["none", "starttls", "tls"]);

const PORT_MIN = 1;
const PORT_MAX = 65535;

export const emailCredentialsSaveHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	EmailCredentialService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* EmailCredentialService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const single = (key: string) =>
			(form.get(key)?.toString() ?? "").trim();
		const fromAddress = single("fromAddress");
		const fromName = single("fromName");
		const host = single("host");
		const portRaw = single("port");
		const username = single("username");
		const password = single("password");
		const securityRaw = single("security");

		const port = Number.parseInt(portRaw, 10);
		const security = securityRaw as SmtpSecurity;

		if (
			fromAddress === "" ||
			host === "" ||
			username === "" ||
			password === "" ||
			!Number.isFinite(port) ||
			port < PORT_MIN ||
			port > PORT_MAX ||
			!ALLOWED_SECURITY.has(security)
		) {
			return new Response("Invalid form", { status: 400 });
		}

		yield* svc.storeForUser({
			userId: principal.userId,
			fromAddress,
			fromName: fromName === "" ? undefined : fromName,
			host,
			port,
			username,
			password: Redacted.make(password),
			security,
		});

		const redirect = "/ui/profile/email-credentials";
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
