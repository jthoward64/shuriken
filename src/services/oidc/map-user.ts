import { Effect, Option } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { isValidSlug, Slug } from "#src/domain/types/path.ts";
import { parseEmail } from "#src/domain/types/strings.ts";
import { GroupService } from "#src/services/group/index.ts";
import { resolveRoleFromGroups } from "#src/services/oidc/role-mapping.ts";
import type { OidcClaims } from "#src/services/oidc/service.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";
import { DEFAULT_ROLE } from "#src/services/role/policy.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";
import { UserRepository } from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// resolveOidcPrincipal — map verified OIDC claims to a local principal.
//
//   1. Existing identity: an auth_user row keyed by "<issuer>|<sub>" — the
//      stable link that survives the user's email changing at the provider.
//   2. Otherwise link by verified email to an existing user (and record the
//      issuer|sub link for next time).
//   3. Otherwise, when auto-provisioning is enabled, create a fresh user from
//      the email/name claims and link it.
//
// Returns None when there is no account and auto-provisioning is off, or when
// the token carries no email to link/provision by — the caller maps that to a
// friendly "no account" response.
// ---------------------------------------------------------------------------

const ISSUER_SUBJECT_SOURCE = "oidc";
const SLUG_SUFFIX_BYTES = 3;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

const oidcAuthId = (claims: OidcClaims): string =>
	`${claims.issuer}|${claims.subject}`;

const toPrincipal = (uwp: UserWithPrincipal): AuthenticatedPrincipal => ({
	principalId: PrincipalId(uwp.principal.id),
	userId: UserId(uwp.user.id),
	displayName: Option.fromNullishOr(uwp.principal.displayName),
});

const randomSlugSuffix = (): string => {
	const bytes = new Uint8Array(SLUG_SUFFIX_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
		.join("");
};

/** A valid, non-empty slug derived from the email local part (with fallback). */
const slugFromEmail = (email: string): string => {
	const local = email.split("@")[0]?.toLowerCase() ?? "";
	const sanitized = local
		.replace(/[^a-z0-9._-]/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	return sanitized.length > 0 && isValidSlug(sanitized)
		? sanitized
		: `user-${randomSlugSuffix()}`;
};

/**
 * The role the IdP says this user should have, or None when role syncing is off
 * (no groups claim / empty role map) or the token omits the groups claim.
 * Present-but-unmatched groups resolve to the default role (IdP is authoritative).
 */
const desiredRoleFromClaims = (
	claims: OidcClaims,
	roleMap: ReadonlyMap<string, string>,
): Option.Option<string> =>
	roleMap.size === 0
		? Option.none()
		: Option.map(claims.groups, (groups) =>
				Option.getOrElse(
					resolveRoleFromGroups(groups, roleMap),
					() => DEFAULT_ROLE,
				),
			);

export const resolveOidcPrincipal = (
	claims: OidcClaims,
	opts: {
		readonly autoProvision: boolean;
		readonly roleMap: ReadonlyMap<string, string>;
		readonly requireEmailVerified: boolean;
	},
): Effect.Effect<
	Option.Option<AuthenticatedPrincipal>,
	DatabaseError | ConflictError | DavError | InternalError,
	UserRepository | ProvisioningService | GroupService
> =>
	Effect.gen(function* () {
		const repo = yield* UserRepository;
		const groupService = yield* GroupService;
		const authId = oidcAuthId(claims);
		const desiredRole = desiredRoleFromClaims(claims, opts.roleMap);

		// Re-sync an existing user's role from the IdP when it differs.
		const syncRole = (uwp: UserWithPrincipal) =>
			Option.match(desiredRole, {
				onNone: () => Effect.void,
				onSome: (role) =>
					uwp.user.role === role
						? Effect.void
						: repo.update(UserId(uwp.user.id), { role }).pipe(
								Effect.asVoid,
								Effect.tap(() =>
									Effect.logDebug("auth.oidc: synced role from IdP", {
										userId: uwp.user.id,
										role,
									}),
								),
							),
			});

		// Reconcile auto-assigned group membership against the IdP's groups
		// claim. Only runs when the claim is present — an absent claim means
		// "this token doesn't carry group info," not "member of no groups,"
		// so leaving auto-assigned memberships untouched avoids wiping them
		// out on a provider/token that simply omits the claim.
		const syncGroups = (uwp: UserWithPrincipal) =>
			Option.match(claims.groups, {
				onNone: () => Effect.void,
				onSome: (groups) =>
					groupService.syncOidcMembership(UserId(uwp.user.id), groups),
			});

		// 1. Existing OIDC identity.
		const existing = yield* repo.findCredential(ISSUER_SUBJECT_SOURCE, authId);
		if (Option.isSome(existing)) {
			const uwp = yield* repo.findById(UserId(existing.value.userId));
			if (Option.isSome(uwp)) {
				yield* syncRole(uwp.value);
				yield* syncGroups(uwp.value);
				return Option.some(toPrincipal(uwp.value));
			}
		}

		// Email is required to link or provision.
		if (Option.isNone(claims.email)) {
			yield* Effect.logWarning("auth.oidc: token carries no email claim");
			return Option.none();
		}
		const emailValue = claims.email.value;
		const email = parseEmail(emailValue);

		// 2. Link to an existing user by email. Refuse to link an unverified
		// email to an existing account — otherwise an attacker who can get the
		// IdP to assert a victim's (unverified) email takes over their account.
		const byEmail = yield* repo.findByEmail(email);
		if (Option.isSome(byEmail)) {
			if (opts.requireEmailVerified && !claims.emailVerified) {
				yield* Effect.logWarning(
					"auth.oidc: refusing to link unverified email to existing user",
					{ email: emailValue },
				);
				return Option.none();
			}
			yield* repo.insertCredential({
				userId: UserId(byEmail.value.user.id),
				authSource: ISSUER_SUBJECT_SOURCE,
				authId,
				authCredential: Option.none(),
			});
			yield* syncRole(byEmail.value);
			yield* syncGroups(byEmail.value);
			yield* Effect.logDebug("auth.oidc: linked to existing user by email", {
				email: emailValue,
			});
			return Option.some(toPrincipal(byEmail.value));
		}

		// 3. Auto-provision a new user.
		if (!opts.autoProvision) {
			yield* Effect.logDebug(
				"auth.oidc: unknown user, auto-provision disabled",
				{
					email: emailValue,
				},
			);
			return Option.none();
		}

		const provisioning = yield* ProvisioningService;
		const name = Option.getOrElse(claims.name, () => emailValue);
		const baseSlug = slugFromEmail(emailValue);

		const provision = (
			slug: string,
		): Effect.Effect<
			UserWithPrincipal,
			ConflictError | DatabaseError | DavError | InternalError
		> =>
			provisioning
				.provisionUser({
					email,
					name,
					slug: Slug(slug),
					role: Option.getOrUndefined(desiredRole),
				})
				.pipe(Effect.map((p) => p.user));

		// One retry with a random suffix in case the derived slug collides.
		const provisioned = yield* provision(baseSlug).pipe(
			Effect.catchTag("ConflictError", () =>
				provision(`${baseSlug}-${randomSlugSuffix()}`),
			),
		);

		yield* repo.insertCredential({
			userId: UserId(provisioned.user.id),
			authSource: ISSUER_SUBJECT_SOURCE,
			authId,
			authCredential: Option.none(),
		});
		yield* syncGroups(provisioned);
		yield* Effect.logDebug("auth.oidc: auto-provisioned user", {
			email: emailValue,
			slug: provisioned.principal.slug,
		});
		return Option.some(toPrincipal(provisioned));
	});
