import { Effect } from "effect";
import type { ClarkName } from "#src/data/ir.ts";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, methodNotAllowed } from "#src/domain/errors.ts";
import { GroupId } from "#src/domain/ids.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	SHURIKEN_NS,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import type { GroupWithPrincipal } from "#src/services/group/repository.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";

// ---------------------------------------------------------------------------
// Property builders
// ---------------------------------------------------------------------------

const buildGroupProps = (
	row: GroupWithPrincipal,
	memberHrefs: ReadonlyArray<string>,
	origin: string,
): DavResponse => ({
	href: `${origin}/dav/groups/${row.principal.slug}/`,
	propstats: [
		{
			props: {
				[cn(DAV_NS, "displayname") as ClarkName]:
					row.principal.displayName ?? "",
				[cn(DAV_NS, "resourcetype") as ClarkName]: {
					[cn(DAV_NS, "collection") as ClarkName]: "",
				},
				[cn(DAV_NS, "group-member-set") as ClarkName]:
					memberHrefs.length > 0
						? {
								[cn(DAV_NS, "href") as ClarkName]:
									memberHrefs.length === 1 ? memberHrefs[0] : memberHrefs,
							}
						: "",
			},
			status: 200,
		},
	],
});

const buildMemberProps = (
	row: UserWithPrincipal,
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
			},
			status: 200,
		},
	],
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Handles PROPFIND /dav/groups/, /dav/groups/:slug, and /dav/groups/:slug/members/ */
export const groupPropfindHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | GroupService
> =>
	Effect.gen(function* () {
		if (
			path.kind !== "groupCollection" &&
			path.kind !== "group" &&
			path.kind !== "groupMembers"
		) {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const requester = ctx.auth.principal;
		const acl = yield* AclService;
		const groupSvc = yield* GroupService;
		const origin = ctx.url.origin;

		if (path.kind === "groupCollection") {
			yield* acl.check(
				requester.principalId,
				GROUPS_VIRTUAL_RESOURCE_ID,
				"virtual",
				"DAV:read",
			);

			const depth = ctx.headers.get("Depth") ?? "0";
			const collectionEntry: DavResponse = {
				href: `${origin}/dav/groups/`,
				propstats: [
					{
						props: {
							[cn(DAV_NS, "displayname") as ClarkName]: "Groups",
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

			const groups = yield* groupSvc.list();
			const memberResponses: Array<DavResponse> = [];
			for (const row of groups) {
				const members = yield* groupSvc.listMembers(GroupId(row.group.id));
				const memberHrefs = members.map(
					(m) => `${origin}/dav/users/${m.principal.slug}/`,
				);
				memberResponses.push(buildGroupProps(row, memberHrefs, origin));
			}
			return yield* multistatusResponse([collectionEntry, ...memberResponses]);
		}

		if (path.kind === "groupMembers") {
			yield* acl
				.check(requester.principalId, path.principalId, "principal", "DAV:read")
				.pipe(
					Effect.catchTag("DavError", () =>
						acl.check(
							requester.principalId,
							GROUPS_VIRTUAL_RESOURCE_ID,
							"virtual",
							"DAV:read",
						),
					),
				);

			const members = yield* groupSvc.listMembers(path.groupId);
			const responses = members.map((m) => buildMemberProps(m, origin));
			return yield* multistatusResponse(responses);
		}

		// path.kind === "group"
		yield* acl
			.check(requester.principalId, path.principalId, "principal", "DAV:read")
			.pipe(
				Effect.catchTag("DavError", () =>
					acl.check(
						requester.principalId,
						GROUPS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:read",
					),
				),
			);

		const row = yield* groupSvc.findById(path.groupId);
		const members = yield* groupSvc.listMembers(path.groupId);
		const memberHrefs = members.map(
			(m) => `${origin}/dav/users/${m.principal.slug}/`,
		);
		return yield* multistatusResponse([
			buildGroupProps(row, memberHrefs, origin),
		]);
	});
