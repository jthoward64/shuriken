import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime, Redacted } from "effect";
import { type PrincipalId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { GroupService } from "#src/services/group/service.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/service.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockServer } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Group-admin integration:
//   * Alice provisions a "team" group
//   * Alice grants Bob DAV:all on the group principal (the group-admins flow)
//   * Bob's PROPFIND on /dav/groups/team/ now returns 207 instead of 403
// ---------------------------------------------------------------------------

const BOB_AUTH = `Basic ${btoa("bob@example.com:bob")}`;

describe("Group admin grant (integration)", () => {
	it("grants Bob DAV:all on team principal → 207 PROPFIND", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { teamSlug } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const groupSvc = yield* GroupService;
					const aclRepo = yield* AclRepository;

					yield* prov
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);

					const bob = yield* prov
						.provisionUser({
							email: Email("bob@example.com"),
							name: "Bob",
							slug: Slug("bob"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(bob.user.user.id), {
							source: "local",
							authId: "bob@example.com",
							password: Redacted.make("bob"),
						})
						.pipe(Effect.orDie);

					const team = yield* groupSvc
						.create({ slug: Slug("team"), displayName: "Team" })
						.pipe(Effect.orDie);

					yield* aclRepo.grantAce({
						resourceType: "principal",
						resourceId: team.principal.id as PrincipalId,
						principalType: "principal",
						principalId: bob.user.principal.id as PrincipalId,
						privilege: "DAV:all",
						grantDeny: "grant",
						protected: false,
						ordinal: 100,
					});

					return { teamSlug: team.principal.slug };
				}),
			);

			const res = await runtime.runPromise(
				handleRequest(
					new Request(`http://localhost/dav/groups/${teamSlug}/`, {
						method: "PROPFIND",
						headers: {
							Authorization: BOB_AUTH,
							Depth: "0",
							"Content-Type": "application/xml",
						},
						body: `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>`,
					}),
					mockServer,
				),
			);
			expect(res.status).toBe(207);
		} finally {
			await runtime.dispose();
		}
	});
});
