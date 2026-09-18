import { Effect, Layer, Option, Redacted, SynchronizedRef } from "effect";
// biome-ignore lint/performance/noNamespaceImport: openid-client is used as a protocol namespace across a dozen calls
import * as client from "openid-client";
import { AppConfigService } from "#src/config.ts";
import { OidcError } from "#src/services/oidc/error.ts";
import {
	type OidcClaims,
	type OidcCompleteInput,
	type OidcLoginStart,
	OidcService,
} from "#src/services/oidc/service.ts";

// ---------------------------------------------------------------------------
// Live OIDC implementation backed by openid-client v6 (PKCE, S256).
//
// Provider metadata is discovered once and memoized in a SynchronizedRef so a
// transient discovery failure isn't cached (unlike Effect.cached); the next
// call retries. All openid-client calls run inside Effect.tryPromise and map
// rejections to OidcError, keeping provider internals out of the failure type.
// ---------------------------------------------------------------------------

const PKCE_METHOD = "S256";

/** The OIDC slice of the app config, read once when the layer is built */
interface OidcSettings {
	readonly issuer: Option.Option<string>;
	readonly clientId: Option.Option<string>;
	readonly clientSecret: Option.Option<Redacted.Redacted<string>>;
	readonly scopes: string;
	readonly groupsClaim: Option.Option<string>;
}

/** The settings plus the memoized provider Configuration every call shares */
interface OidcContext {
	readonly settings: OidcSettings;
	readonly configRef: SynchronizedRef.SynchronizedRef<
		Option.Option<client.Configuration>
	>;
}

type UserInfo = Awaited<ReturnType<typeof client.fetchUserInfo>>;

const requireConfigValue = (
	value: Option.Option<string>,
	key: string,
): Effect.Effect<string, OidcError> =>
	Option.match(value, {
		onNone: () =>
			Effect.fail(new OidcError({ reason: `${key} is not configured` })),
		onSome: (v) => Effect.succeed(v),
	});

/** Extract a string claim, returning None for missing/non-string values. */
const stringClaim = (value: unknown): Option.Option<string> =>
	typeof value === "string" && value.length > 0
		? Option.some(value)
		: Option.none();

/**
 * Extract the groups/roles claim named `claimName` from the ID-token claims.
 * Returns None when no claim name is configured or the claim is absent (role
 * sync is then skipped); Some (possibly empty) when the claim is present. A
 * lone string is treated as a single-element list.
 */
const groupsClaim = (
	claims: Record<string, unknown>,
	claimName: Option.Option<string>,
): Option.Option<ReadonlyArray<string>> =>
	Option.flatMap(claimName, (name) => {
		if (!(name in claims)) {
			return Option.none();
		}
		const value = claims[name];
		if (Array.isArray(value)) {
			return Option.some(
				value.filter((v): v is string => typeof v === "string"),
			);
		}
		return typeof value === "string"
			? Option.some([value])
			: Option.some<ReadonlyArray<string>>([]);
	});

/** Fetch the provider's metadata document */
const discover = Effect.fn("auth.oidc.discover")(function* (
	settings: OidcSettings,
) {
	const issuer = yield* requireConfigValue(settings.issuer, "OIDC_ISSUER");
	const clientId = yield* requireConfigValue(
		settings.clientId,
		"OIDC_CLIENT_ID",
	);
	const server = yield* Effect.try({
		try: () => new URL(issuer),
		catch: (e) =>
			new OidcError({ reason: "OIDC_ISSUER is not a valid URL", cause: e }),
	});
	const secret = Option.getOrUndefined(
		Option.map(settings.clientSecret, Redacted.value),
	);
	return yield* Effect.tryPromise({
		try: () =>
			secret === undefined
				? client.discovery(server, clientId)
				: client.discovery(server, clientId, secret),
		catch: (e) =>
			new OidcError({ reason: "provider discovery failed", cause: e }),
	});
});

/** The discovered Configuration, memoized after the first success */
const getConfig = Effect.fn("auth.oidc.getConfig")(function* (
	ctx: OidcContext,
) {
	return yield* SynchronizedRef.modifyEffect(ctx.configRef, (current) =>
		Effect.map(
			Option.match(current, {
				onSome: Effect.succeed,
				onNone: () => discover(ctx.settings),
			}),
			(cfg) => [cfg, Option.some(cfg)] as const,
		),
	);
});

/** Build the provider authorization URL plus the PKCE/nonce/state secrets */
const beginLogin = Effect.fn("auth.oidc.beginLogin")(function* (
	ctx: OidcContext,
	redirectUri: string,
) {
	const config = yield* getConfig(ctx);
	const pkceVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = yield* Effect.tryPromise({
		try: () => client.calculatePKCECodeChallenge(pkceVerifier),
		catch: (e) =>
			new OidcError({ reason: "failed to derive PKCE challenge", cause: e }),
	});
	const state = client.randomState();
	const nonce = client.randomNonce();
	const url = yield* Effect.try({
		try: () =>
			client.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				scope: ctx.settings.scopes,
				code_challenge: codeChallenge,
				code_challenge_method: PKCE_METHOD,
				state,
				nonce,
			}),
		catch: (e) =>
			new OidcError({ reason: "failed to build authorization URL", cause: e }),
	});
	return {
		authorizationUrl: url.href,
		state,
		nonce: Redacted.make(nonce),
		pkceVerifier: Redacted.make(pkceVerifier),
	} satisfies OidcLoginStart;
});

/** Identity claims as read from the ID token, before the userinfo top-up */
interface PartialClaims {
	readonly email: Option.Option<string>;
	readonly emailVerified: boolean;
	readonly name: Option.Option<string>;
	readonly groups: Option.Option<ReadonlyArray<string>>;
}

/** A userinfo failure is logged and ignored rather than blocking login */
const logUserInfoFailure = Effect.fn("auth.oidc.logUserInfoFailure")(function* (
	error: OidcError,
) {
	yield* Effect.logWarning("auth.oidc: userinfo fetch failed", {
		reason: error.reason,
	});
	return Option.none<UserInfo>();
});

/** Call the userinfo endpoint, reporting a failure as absence */
const fetchUserInfo = Effect.fn("auth.oidc.fetchUserInfo")(function* (
	config: client.Configuration,
	accessToken: string,
	subject: string,
) {
	return yield* Effect.tryPromise({
		try: () => client.fetchUserInfo(config, accessToken, subject),
		catch: (e) => new OidcError({ reason: "userinfo fetch failed", cause: e }),
	}).pipe(
		Effect.map(Option.some<UserInfo>),
		Effect.catchTag("OidcError", logUserInfoFailure),
	);
});

/** Overlay the userinfo response onto whatever the ID token left out */
const mergeUserInfo = (
	fromIdToken: PartialClaims,
	userInfo: UserInfo,
	groupsClaimName: Option.Option<string>,
	needGroups: boolean,
): PartialClaims => ({
	email: Option.isNone(fromIdToken.email)
		? stringClaim(userInfo.email)
		: fromIdToken.email,
	emailVerified: Option.isNone(fromIdToken.email)
		? fromIdToken.emailVerified || userInfo.email_verified === true
		: fromIdToken.emailVerified,
	name: Option.isNone(fromIdToken.name)
		? stringClaim(userInfo.name)
		: fromIdToken.name,
	groups: needGroups
		? groupsClaim(userInfo, groupsClaimName)
		: fromIdToken.groups,
});

/**
 * Some providers (e.g. Authentik with "Include claims in id_token" off) surface
 * email / name / groups only via the userinfo endpoint. Fetch it once to fill
 * anything the ID token omitted.
 */
const completeFromUserInfo = Effect.fn("auth.oidc.completeFromUserInfo")(
	function* (
		ctx: OidcContext,
		config: client.Configuration,
		token: { readonly accessToken: string; readonly subject: string },
		fromIdToken: PartialClaims,
	) {
		const needGroups =
			Option.isSome(ctx.settings.groupsClaim) &&
			Option.isNone(fromIdToken.groups);
		if (
			Option.isSome(fromIdToken.email) &&
			Option.isSome(fromIdToken.name) &&
			!needGroups
		) {
			return fromIdToken;
		}
		const userInfo = yield* fetchUserInfo(
			config,
			token.accessToken,
			token.subject,
		);
		return Option.match(userInfo, {
			onNone: () => fromIdToken,
			onSome: (info) =>
				mergeUserInfo(fromIdToken, info, ctx.settings.groupsClaim, needGroups),
		});
	},
);

/** Exchange the authorization code and return the verified identity claims */
const completeLogin = Effect.fn("auth.oidc.completeLogin")(function* (
	ctx: OidcContext,
	input: OidcCompleteInput,
) {
	const config = yield* getConfig(ctx);
	const tokens = yield* Effect.tryPromise({
		try: () =>
			client.authorizationCodeGrant(config, input.currentUrl, {
				pkceCodeVerifier: Redacted.value(input.pkceVerifier),
				expectedNonce: Redacted.value(input.nonce),
				expectedState: input.state,
				idTokenExpected: true,
			}),
		catch: (e) =>
			new OidcError({
				reason: "authorization code exchange failed",
				cause: e,
			}),
	});
	const claims = tokens.claims();
	if (claims === undefined) {
		return yield* Effect.fail(
			new OidcError({ reason: "ID token missing from token response" }),
		);
	}

	const resolved = yield* completeFromUserInfo(
		ctx,
		config,
		{ accessToken: tokens.access_token, subject: claims.sub },
		{
			email: stringClaim(claims.email),
			emailVerified: claims.email_verified === true,
			name: stringClaim(claims.name),
			groups: groupsClaim(claims, ctx.settings.groupsClaim),
		},
	);

	return {
		issuer: claims.iss,
		subject: claims.sub,
		email: resolved.email,
		emailVerified: resolved.emailVerified,
		name: resolved.name,
		groups: resolved.groups,
	} satisfies OidcClaims;
});

export const OidcServiceLive = Layer.effect(
	OidcService,
	Effect.gen(function* () {
		const { auth } = yield* AppConfigService;
		const ctx: OidcContext = {
			settings: {
				issuer: auth.oidcIssuer,
				clientId: auth.oidcClientId,
				clientSecret: auth.oidcClientSecret,
				scopes: auth.oidcScopes,
				groupsClaim: auth.oidcGroupsClaim,
			},
			configRef: yield* SynchronizedRef.make(
				Option.none<client.Configuration>(),
			),
		};

		return {
			beginLogin: (input) => beginLogin(ctx, input.redirectUri),
			completeLogin: (input) => completeLogin(ctx, input),
		};
	}),
);
