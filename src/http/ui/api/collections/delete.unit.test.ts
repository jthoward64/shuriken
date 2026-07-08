import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option } from "effect";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import {
	CollectionId,
	PrincipalId,
	RequestId,
	UserId,
} from "#src/domain/ids.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { collectionsDeleteHandler } from "./delete.ts";

// ---------------------------------------------------------------------------
// collectionsDeleteHandler — retention-aware delete path.
//
// HIGHEST PRIORITY case per the trash-bin task: when trash.retentionDays is
// 0, the collection must be hard-deleted immediately (row gone entirely, not
// just soft-deleted) rather than going through the normal soft-delete path.
// ---------------------------------------------------------------------------

const makeCtx = (principalId: PrincipalId): HttpRequestContext => ({
	requestId: RequestId("test"),
	method: "POST",
	url: new URL("http://localhost/ui/api/collections/x/delete"),
	headers: new Headers(),
	auth: new Authenticated({
		principal: {
			principalId,
			userId: UserId(crypto.randomUUID()),
			displayName: Option.some("Test User"),
		},
	}),
	clientIp: Option.none(),
	caldavTimezones: null,
});

const configLayer = (retentionDays: number) =>
	Layer.succeed(AppConfigService, {
		auth: { basicAuthEnabled: true },
		trash: { retentionDays },
	} as unknown as AppConfigType);

describe("collectionsDeleteHandler", () => {
	it("soft-deletes when trash.retentionDays > 0 (default retention)", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
		});
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:unbind",
		});

		const res = await Effect.runPromise(
			collectionsDeleteHandler(
				new Request("http://localhost", {
					method: "POST",
					body: new FormData(),
				}),
				makeCtx(principalId),
				CollectionId(collectionId),
			).pipe(
				Effect.provide(Layer.mergeAll(env.toLayer(), configLayer(30))),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(303);
		// Row still present, just soft-deleted — recoverable from the trash bin.
		expect(env.stores.collections.has(collectionId)).toBe(true);
		expect(env.stores.collections.get(collectionId)?.deletedAt).not.toBeNull();
	});

	it("hard-deletes immediately when trash.retentionDays === 0", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		env.withUser({ principalId }).withCollection({
			id: collectionId,
			ownerPrincipalId: principalId,
		});
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:unbind",
		});

		const res = await Effect.runPromise(
			collectionsDeleteHandler(
				new Request("http://localhost", {
					method: "POST",
					body: new FormData(),
				}),
				makeCtx(principalId),
				CollectionId(collectionId),
			).pipe(
				Effect.provide(Layer.mergeAll(env.toLayer(), configLayer(0))),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(303);
		// Row is entirely gone — no trace left in the trash bin.
		expect(env.stores.collections.has(collectionId)).toBe(false);
	});
});
