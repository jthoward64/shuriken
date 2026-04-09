import { Effect } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, notFound, unauthorized } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import {
	SHURIKEN_NS,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { UserService } from "#src/services/user/index.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

// ---------------------------------------------------------------------------
// Property builder for a single user resource
// ---------------------------------------------------------------------------

const buildUserProps = (
	row: UserWithPrincipal,
	groupHrefs: ReadonlyArray<string>,
	origin: string,
): DavResponse => ({
	href: `${origin}/dav/users/${row.principal.slug}/`,
	propstats: [
		{
			props: {
				[cn(DAV_NS, "displayname") as ClarkName]:
					row.principal.displayName ?? "",
				[cn(SHURIKEN_NS, "name") as ClarkName]: row.user.name,
				[cn(SHURIKEN_NS, "email") as ClarkName]: row.user.email,
				[cn(DAV_NS, "group-membership") as ClarkName]:
					groupHrefs.length > 0
						? {
								[cn(DAV_NS, "href") as ClarkName]:
									groupHrefs.length === 1 ? groupHrefs[0] : groupHrefs,
							}
						: "",
			},
			status: 200,
		},
	],
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Handles PROPFIND /dav/users/ and /dav/users/:slug */
export const userPropfindHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | UserService | GroupService
> =>
	Effect.gen(function* () {
		if (path.kind === "newUser") {
			return yield* notFound();
		}
		if (path.kind !== "userCollection" && path.kind !== "user") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const requester = ctx.auth.principal;
		const acl = yield* AclService;
		const userSvc = yield* UserService;
		const groupSvc = yield* GroupService;
		const origin = ctx.url.origin;

		if (path.kind === "userCollection") {
			yield* acl.check(
				requester.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
				"DAV:read",
			);

			const depth = ctx.headers.get("Depth") ?? "0";
			const collectionEntry: DavResponse = {
				href: `${origin}/dav/users/`,
				propstats: [
					{
						props: {
							[cn(DAV_NS, "displayname") as ClarkName]: "Users",
							[cn(DAV_NS, "resourcetype") as ClarkName]: {
								[cn(DAV_NS, "collection") as ClarkName]: "",
							},
						},
						status: 200,
					},
				],
			};

			if (depth === "0") {
				return yield* multistatusResponse([collectionEntry]);
			}

			const users = yield* userSvc.list();
			const memberResponses: Array<DavResponse> = [];
			for (const row of users) {
				const groups = yield* groupSvc.listByMember(row.user.id as UserId);
				const groupHrefs = groups.map(
					(g) => `${origin}/dav/groups/${g.principal.slug}/`,
				);
				memberResponses.push(buildUserProps(row, groupHrefs, origin));
			}
			return yield* multistatusResponse([collectionEntry, ...memberResponses]);
		}

		// path.kind === "user"
		yield* acl
			.check(requester.principalId, path.principalId, "principal", "DAV:read")
			.pipe(
				Effect.catchTag("DavError", () =>
					acl.check(
						requester.principalId,
						USERS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:read",
					),
				),
			);

		const row = yield* userSvc.findById(path.userId);
		const groups = yield* groupSvc.listByMember(path.userId);
		const groupHrefs = groups.map(
			(g) => `${origin}/dav/groups/${g.principal.slug}/`,
		);
		return yield* multistatusResponse([
			buildUserProps(row, groupHrefs, origin),
		]);
	});
