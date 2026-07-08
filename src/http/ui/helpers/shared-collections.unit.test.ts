import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Option } from "effect";
import { PrincipalId, UserId, type UuidString } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { listOwnedAndShared } from "./shared-collections.ts";

// ---------------------------------------------------------------------------
// listOwnedAndShared — the merged sidebar listing behind the Calendar and
// Contacts pages: owned collections plus anything another principal has
// granted the caller, so shared calendars/address books show up alongside
// owned ones instead of only being discoverable from a separate page.
// ---------------------------------------------------------------------------

const principalOf = (principalId: UuidString): AuthenticatedPrincipal => ({
	principalId: PrincipalId(principalId),
	userId: UserId(crypto.randomUUID()),
	displayName: Option.none(),
});

describe("listOwnedAndShared", () => {
	it("returns only owned collections when nothing is shared (regression guard)", async () => {
		const owner = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const env = makeTestEnv().withUser({ principalId: owner }).withCollection({
			id: collectionId,
			ownerPrincipalId: owner,
			collectionType: "calendar",
			displayName: "Mine",
		});

		const result = await runSuccess(
			listOwnedAndShared(principalOf(owner), "calendar").pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.row.id).toBe(collectionId);
		expect(result[0]?.ownerSlug).toBeNull();
		expect(result[0]?.writable).toBe(true);
	});

	it("merges shared collections after owned ones, with the owner's slug and computed writable flag", async () => {
		const viewer = crypto.randomUUID();
		const sharer = crypto.randomUUID();
		const ownedId = crypto.randomUUID();
		const readOnlySharedId = crypto.randomUUID();
		const writableSharedId = crypto.randomUUID();

		const env = makeTestEnv()
			.withUser({ principalId: viewer, slug: "viewer" })
			.withUser({ principalId: sharer, slug: "sharer" })
			.withCollection({
				id: ownedId,
				ownerPrincipalId: viewer,
				collectionType: "calendar",
				displayName: "Mine",
			})
			.withCollection({
				id: readOnlySharedId,
				ownerPrincipalId: sharer,
				collectionType: "calendar",
				displayName: "Zebra Calendar",
			})
			.withCollection({
				id: writableSharedId,
				ownerPrincipalId: sharer,
				collectionType: "calendar",
				displayName: "Alpha Calendar",
			})
			.withAce({
				resourceType: "collection",
				resourceId: readOnlySharedId,
				principalType: "principal",
				principalId: viewer,
				privilege: "DAV:read",
			})
			.withAce({
				resourceType: "collection",
				resourceId: writableSharedId,
				principalType: "principal",
				principalId: viewer,
				// The ACL grant UI only ever stores "DAV:all" / "DAV:read" / "DAV:write"
				// / "DAV:write-acl" as a single ACE (src/http/ui/helpers/acl-panel.ts
				// COMMON_PRIVILEGE_OPTIONS) — "Write" grants "DAV:write", which implies
				// read too.
				privilege: "DAV:write",
			});

		const result = await runSuccess(
			listOwnedAndShared(principalOf(viewer), "calendar").pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		// Owned first, then shared sorted alphabetically by display name.
		expect(result.map((r) => r.row.id)).toEqual([
			ownedId,
			writableSharedId,
			readOnlySharedId,
		]);

		const owned = result.find((r) => r.row.id === ownedId);
		expect(owned?.ownerSlug).toBeNull();
		expect(owned?.writable).toBe(true);

		const readOnly = result.find((r) => r.row.id === readOnlySharedId);
		expect(readOnly?.ownerSlug).toBe("sharer");
		expect(readOnly?.writable).toBe(false);

		const writable = result.find((r) => r.row.id === writableSharedId);
		expect(writable?.ownerSlug).toBe("sharer");
		expect(writable?.writable).toBe(true);
	});

	it("filters by collection type, excluding address books when calendars are requested", async () => {
		const owner = crypto.randomUUID();
		const calendarId = crypto.randomUUID();
		const addressbookId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ principalId: owner })
			.withCollection({
				id: calendarId,
				ownerPrincipalId: owner,
				collectionType: "calendar",
			})
			.withCollection({
				id: addressbookId,
				ownerPrincipalId: owner,
				collectionType: "addressbook",
			});

		const result = await runSuccess(
			listOwnedAndShared(principalOf(owner), "calendar").pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.map((r) => r.row.id)).toEqual([calendarId]);
	});
});
