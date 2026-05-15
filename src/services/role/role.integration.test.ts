import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime, Redacted } from "effect";
import { type CollectionId, type PrincipalId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockServer } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Three-tier roles end-to-end:
//   * normal user A and B → A cannot PROPFIND B's primary calendar
//   * super_admin user S → can PROPFIND B's primary calendar even without
//     any direct ACE (short-circuit in AclService).
//   * UserService.update changes role → next request reflects it.
// ---------------------------------------------------------------------------

const auth = (email: string, id: string): string =>
	`Basic ${btoa(`${email}:${id}`)}`;

describe("Three-tier roles (integration)", () => {
	it("super_admin bypasses ACL on other users' resources; normal cannot", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const setup = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const a = yield* prov
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					const b = yield* prov
						.provisionUser({
							email: Email("bob@example.com"),
							name: "Bob",
							slug: Slug("bob"),
						})
						.pipe(Effect.orDie);
					const s = yield* prov
						.provisionUser({
							email: Email("root@example.com"),
							name: "Root",
							slug: Slug("root"),
							role: "super_admin",
						})
						.pipe(Effect.orDie);
					for (const u of [a, b, s]) {
						const local = u.user.user.email.split("@")[0] ?? "";
						yield* userSvc
							.addCredential(UserId(u.user.user.id), {
								source: "local",
								authId: u.user.user.email,
								password: Redacted.make(local),
							})
							.pipe(Effect.orDie);
					}
					return {
						aId: a.user.principal.id as PrincipalId,
						bId: b.user.principal.id as PrincipalId,
						sId: s.user.principal.id as PrincipalId,
						bCalId: b.calendar.id as CollectionId,
					};
				}),
			);

			// Alice (normal) tries to PROPFIND Bob's calendar — should be denied.
			const aRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/bob/cal/primary/", {
						method: "PROPFIND",
						headers: { Authorization: auth("alice@example.com", "alice") },
					}),
					mockServer,
				),
			);
			// 403 is the canonical denied response under the existing ACL.
			expect(aRes.status).toBe(403);

			// Root (super_admin) — same request — should succeed.
			const sRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/bob/cal/primary/", {
						method: "PROPFIND",
						headers: {
							Authorization: auth("root@example.com", "root"),
							Depth: "0",
						},
					}),
					mockServer,
				),
			);
			expect(sRes.status).toBe(207);

			// Demote root to normal; the same request now fails.
			await runtime.runPromise(
				Effect.flatMap(UserService, (s) =>
					Effect.gen(function* () {
						const found = yield* s.findBySlug(Slug("root"));
						yield* s.update(UserId(found.user.id), { role: "normal" });
					}),
				),
			);
			const sRes2 = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/bob/cal/primary/", {
						method: "PROPFIND",
						headers: {
							Authorization: auth("root@example.com", "root"),
							Depth: "0",
						},
					}),
					mockServer,
				),
			);
			expect(sRes2.status).toBe(403);

			// Sanity probe — sentinel use of refs.
			expect(setup.aId).toBeTruthy();
			expect(setup.bCalId).toBeTruthy();
			expect(setup.sId).toBeTruthy();
		} finally {
			await runtime.dispose();
		}
	});
});
