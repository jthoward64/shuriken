import { Effect, Layer, Option, Redacted, SynchronizedRef } from "effect";
import * as client from "openid-client";
import { AppConfigService } from "#src/config.ts";
import { OidcError } from "#src/services/oidc/error.ts";
import {
	type OidcClaims,
	type OidcLoginStart,
	OidcService,
	type OidcServiceShape,
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

export const OidcServiceLive = Layer.effect(
	OidcService,
	Effect.gen(function* () {
		const {
			auth: {
				oidcIssuer,
				oidcClientId,
				oidcClientSecret,
				oidcScopes,
				oidcGroupsClaim,
			},
		} = yield* AppConfigService;

		const configRef = yield* SynchronizedRef.make(
			Option.none<client.Configuration>(),
		);

		const discover: Effect.Effect<client.Configuration, OidcError> = Effect.gen(
			function* () {
				const issuer = yield* requireConfigValue(oidcIssuer, "OIDC_ISSUER");
				const clientId = yield* requireConfigValue(
					oidcClientId,
					"OIDC_CLIENT_ID",
				);
				const server = yield* Effect.try({
					try: () => new URL(issuer),
					catch: (e) =>
						new OidcError({
							reason: "OIDC_ISSUER is not a valid URL",
							cause: e,
						}),
				});
				const secret = Option.getOrUndefined(
					Option.map(oidcClientSecret, Redacted.value),
				);
				return yield* Effect.tryPromise({
					try: () =>
						secret === undefined
							? client.discovery(server, clientId)
							: client.discovery(server, clientId, secret),
					catch: (e) =>
						new OidcError({ reason: "provider discovery failed", cause: e }),
				});
			},
		);

		// Memoize the discovered Configuration; only successes are stored.
		const getConfig: Effect.Effect<client.Configuration, OidcError> =
			SynchronizedRef.modifyEffect(configRef, (current) =>
				Option.match(current, {
					onSome: (cfg) => Effect.succeed([cfg, Option.some(cfg)] as const),
					onNone: () =>
						discover.pipe(
							Effect.map((cfg) => [cfg, Option.some(cfg)] as const),
						),
				}),
			);

		const beginLogin: OidcServiceShape["beginLogin"] = ({ redirectUri }) =>
			Effect.gen(function* () {
				const config = yield* getConfig;
				const pkceVerifier = client.randomPKCECodeVerifier();
				const codeChallenge = yield* Effect.tryPromise({
					try: () => client.calculatePKCECodeChallenge(pkceVerifier),
					catch: (e) =>
						new OidcError({
							reason: "failed to derive PKCE challenge",
							cause: e,
						}),
				});
				const state = client.randomState();
				const nonce = client.randomNonce();
				const url = yield* Effect.try({
					try: () =>
						client.buildAuthorizationUrl(config, {
							redirect_uri: redirectUri,
							scope: oidcScopes,
							code_challenge: codeChallenge,
							code_challenge_method: PKCE_METHOD,
							state,
							nonce,
						}),
					catch: (e) =>
						new OidcError({
							reason: "failed to build authorization URL",
							cause: e,
						}),
				});
				return {
					authorizationUrl: url.href,
					state,
					nonce: Redacted.make(nonce),
					pkceVerifier: Redacted.make(pkceVerifier),
				} satisfies OidcLoginStart;
			});

		const completeLogin: OidcServiceShape["completeLogin"] = (input) =>
			Effect.gen(function* () {
				const config = yield* getConfig;
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

				let email = stringClaim(claims.email);
				let name = stringClaim(claims.name);
				let emailVerified = claims.email_verified === true;
				let groups = groupsClaim(claims, oidcGroupsClaim);

				// Some providers (e.g. Authentik with "Include claims in id_token"
				// off) surface email / name / groups only via the userinfo endpoint.
				// Fetch it once to fill anything the ID token omitted; a userinfo
				// failure is logged and ignored rather than blocking login.
				const needGroups =
					Option.isSome(oidcGroupsClaim) && Option.isNone(groups);
				if (Option.isNone(email) || Option.isNone(name) || needGroups) {
					const userInfo = yield* Effect.tryPromise({
						try: () =>
							client.fetchUserInfo(config, tokens.access_token, claims.sub),
						catch: (e) =>
							new OidcError({ reason: "userinfo fetch failed", cause: e }),
					}).pipe(
						Effect.catchTag("OidcError", (e) =>
							Effect.as(
								Effect.logWarning("auth.oidc: userinfo fetch failed", {
									reason: e.reason,
								}),
								null,
							),
						),
					);
					if (userInfo !== null) {
						if (Option.isNone(email)) {
							email = stringClaim(userInfo.email);
							emailVerified = emailVerified || userInfo.email_verified === true;
						}
						if (Option.isNone(name)) {
							name = stringClaim(userInfo.name);
						}
						if (needGroups) {
							groups = groupsClaim(userInfo, oidcGroupsClaim);
						}
					}
				}

				return {
					issuer: claims.iss,
					subject: claims.sub,
					email,
					emailVerified,
					name,
					groups,
				} satisfies OidcClaims;
			});

		return { beginLogin, completeLogin };
	}),
);
