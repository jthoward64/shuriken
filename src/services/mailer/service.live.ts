import { Effect, Layer, Redacted } from "effect";
import nodemailer from "nodemailer";
import { InternalError } from "#src/domain/errors.ts";
import type { ResolvedSmtpCreds } from "#src/services/email-credential/service.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";
import type {
	MailerServiceShape,
	MailMessage,
	SendOutcome,
} from "./service.ts";
import { MailerService } from "./service.ts";

// ---------------------------------------------------------------------------
// Live MailerService — wraps nodemailer.
//
// One transport per resolved profile, cached in a tiny LRU keyed by
// (host, port, username, security). Most servers will resolve only a handful
// of profiles, so a Map without eviction is sufficient — bounded by the
// number of distinct configs.
// ---------------------------------------------------------------------------

const cacheKeyOf = (creds: ResolvedSmtpCreds): string =>
	`${creds.host}:${creds.port}:${creds.username}:${creds.security}`;

const buildTransport = (creds: ResolvedSmtpCreds) =>
	nodemailer.createTransport({
		host: creds.host,
		port: creds.port,
		secure: creds.security === "tls",
		requireTLS: creds.security === "starttls",
		auth: {
			user: creds.username,
			pass: Redacted.value(creds.password),
		},
	});

const fromHeader = (creds: ResolvedSmtpCreds): string =>
	creds.fromName !== null && creds.fromName !== ""
		? `"${creds.fromName.replace(/"/g, '\\"')}" <${creds.fromAddress}>`
		: creds.fromAddress;

const headersFor = (
	creds: ResolvedSmtpCreds,
	message: MailMessage,
): Record<string, string> => {
	const out: Record<string, string> = {};
	if (creds.replyTo !== null) {
		out["Reply-To"] = creds.replyTo;
	}
	if (message.contentType !== undefined) {
		out["Content-Type"] = message.contentType;
	}
	for (const [k, v] of Object.entries(message.extraHeaders ?? {})) {
		out[k] = v;
	}
	return out;
};

const make = (
	emailCreds: ReturnType<typeof EmailCredentialService.of>,
): MailerServiceShape => {
	const transports = new Map<string, ReturnType<typeof buildTransport>>();

	const sendWithCreds = (
		creds: ResolvedSmtpCreds,
		message: MailMessage,
	): Effect.Effect<SendOutcome, InternalError> => {
		const key = cacheKeyOf(creds);
		let t = transports.get(key);
		if (t === undefined) {
			t = buildTransport(creds);
			transports.set(key, t);
		}
		const transport = t;
		return Effect.tryPromise({
			try: async () => {
				const info = await transport.sendMail({
					from: fromHeader(creds),
					to: [...message.to],
					subject: message.subject,
					text: message.text,
					...(message.html !== undefined ? { html: message.html } : {}),
					headers: headersFor(creds, message),
				});
				return {
					accepted: (info.accepted ?? []).map(
						(a: string | { address: string }) =>
							typeof a === "string" ? a : a.address,
					),
					rejected: (info.rejected ?? []).map(
						(a: string | { address: string }) =>
							typeof a === "string" ? a : a.address,
					),
					messageId: info.messageId ?? null,
				};
			},
			catch: (e) => new InternalError({ cause: e }),
		});
	};

	return {
		sendForUser: (userId, userEmail, userDisplayName, message) =>
			Effect.gen(function* () {
				const resolved = yield* emailCreds.resolveForUser(
					userId,
					userEmail,
					userDisplayName,
				);
				if (resolved === null) {
					return null;
				}
				return yield* sendWithCreds(resolved, message);
			}).pipe(
				Effect.catchTag("DatabaseError", (e) =>
					Effect.fail(new InternalError({ cause: e })),
				),
			),
	};
};

export const MailerServiceLive = Layer.effect(
	MailerService,
	Effect.gen(function* () {
		const emailCreds = yield* EmailCredentialService;
		return make(emailCreds);
	}),
);
