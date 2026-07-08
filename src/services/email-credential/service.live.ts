import { Effect, Layer, Option, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { SmtpSecurity } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import { UserEmailCredentialRepository } from "./repository.ts";
import { decryptSecret, encryptSecret } from "./secret-cipher.ts";
import { EmailCredentialService, type ResolvedSmtpCreds } from "./service.ts";

// ---------------------------------------------------------------------------
// Live EmailCredentialService — implements the chained resolver.
//
// Pattern matching: each profile pattern is treated as a JS regex; invalid
// regexes are silently skipped (logged at warn). First match wins, in
// declaration order.
// ---------------------------------------------------------------------------

interface MailProfile {
	readonly pattern: string;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password: string;
	readonly security?: SmtpSecurity;
}

const compileProfile = (
	profile: MailProfile,
): { readonly regex: RegExp; readonly profile: MailProfile } | null => {
	try {
		return { regex: new RegExp(profile.pattern), profile };
	} catch {
		return null;
	}
};

const matchProfile = (
	profiles: ReadonlyArray<MailProfile>,
	email: string,
): MailProfile | null => {
	for (const p of profiles) {
		const compiled = compileProfile(p);
		if (compiled?.regex.test(email)) {
			return compiled.profile;
		}
	}
	return null;
};

const fromUserCreds = (
	row: {
		readonly host: string;
		readonly port: number;
		readonly username: string;
		readonly fromAddress: string;
		readonly fromName: string | null;
		readonly security: SmtpSecurity;
	},
	password: Redacted.Redacted<string>,
): ResolvedSmtpCreds => ({
	kind: "user",
	host: row.host,
	port: row.port,
	username: row.username,
	password,
	security: row.security,
	fromAddress: row.fromAddress,
	fromName: row.fromName,
	replyTo: null,
});

const fromProfile = (
	profile: MailProfile,
	userEmail: string,
	userDisplayName: string | null,
): ResolvedSmtpCreds => ({
	kind: "profile",
	host: profile.host,
	port: profile.port,
	username: profile.username,
	password: Redacted.make(profile.password),
	security: profile.security ?? "starttls",
	fromAddress: userEmail,
	fromName: userDisplayName,
	replyTo: null,
});

const fromDefault = (
	conf: {
		readonly defaultHost: string;
		readonly defaultPort: number;
		readonly defaultUsername: string;
		readonly defaultPassword: string;
		readonly defaultSecurity: SmtpSecurity;
		readonly defaultFromAddress: string;
		readonly defaultFromName: string;
	},
	userEmail: string,
): ResolvedSmtpCreds | null => {
	if (conf.defaultHost === "" || conf.defaultFromAddress === "") {
		return null;
	}
	return {
		kind: "default",
		host: conf.defaultHost,
		port: conf.defaultPort,
		username: conf.defaultUsername,
		password: Redacted.make(conf.defaultPassword),
		security: conf.defaultSecurity,
		fromAddress: conf.defaultFromAddress,
		fromName: conf.defaultFromName !== "" ? conf.defaultFromName : null,
		// Default mailer sends as a generic system address → preserve user's
		// reachability via Reply-To.
		replyTo: userEmail,
	};
};

const resolveForUser = (
	userId: UserId,
	userEmail: string,
	userDisplayName: string | null,
): Effect.Effect<
	ResolvedSmtpCreds | null,
	DatabaseError | InternalError,
	AppConfigService | UserEmailCredentialRepository
> =>
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const repo = yield* UserEmailCredentialRepository;

		if (!config.mail.enabled) {
			return null;
		}

		// 1. Per-user creds.
		if (config.mail.credsKey !== "") {
			const rowOpt = yield* repo.findByUserId(userId);
			if (Option.isSome(rowOpt)) {
				const row = rowOpt.value;
				const password = yield* decryptSecret(
					Redacted.make(config.mail.credsKey),
					{ ciphertext: row.passwordEncrypted, iv: row.passwordIv },
				);
				return fromUserCreds(row, password);
			}
		}

		// 2. Server-wide profile match.
		const profileMatch = matchProfile(config.mail.profiles, userEmail);
		if (profileMatch !== null) {
			return fromProfile(profileMatch, userEmail, userDisplayName);
		}

		// 3. Default fallback.
		return fromDefault(config.mail, userEmail);
	});

const storeForUser = (input: {
	readonly userId: UserId;
	readonly fromAddress: string;
	readonly fromName?: string;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password: Redacted.Redacted<string>;
	readonly security: SmtpSecurity;
}): Effect.Effect<
	void,
	DatabaseError | InternalError,
	AppConfigService | UserEmailCredentialRepository
> =>
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const repo = yield* UserEmailCredentialRepository;
		const encrypted = yield* encryptSecret(
			Redacted.make(config.mail.credsKey),
			input.password,
		);
		yield* repo.upsert({
			userId: input.userId,
			fromAddress: input.fromAddress,
			fromName: input.fromName,
			host: input.host,
			port: input.port,
			username: input.username,
			passwordEncrypted: encrypted.ciphertext,
			passwordIv: encrypted.iv,
			security: input.security,
		});
	});

export const EmailCredentialServiceLive = Layer.effect(
	EmailCredentialService,
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const repo = yield* UserEmailCredentialRepository;
		return {
			resolveForUser: (...args) =>
				resolveForUser(...args).pipe(
					Effect.provideService(AppConfigService, config),
					Effect.provideService(UserEmailCredentialRepository, repo),
				),
			storeForUser: (input) =>
				storeForUser(input).pipe(
					Effect.provideService(AppConfigService, config),
					Effect.provideService(UserEmailCredentialRepository, repo),
				),
			clearForUser: (userId) => repo.delete(userId),
		};
	}),
);
