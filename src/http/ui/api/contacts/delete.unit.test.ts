import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option } from "effect";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import { InstanceId, PrincipalId, RequestId, UserId } from "#src/domain/ids.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { CardEditServiceLive } from "#src/services/card-edit/service.live.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { contactsDeleteHandler } from "./delete.ts";

// ---------------------------------------------------------------------------
// contactsDeleteHandler — retention-aware delete path.
//
// HIGHEST PRIORITY case per the trash-bin task: when trash.retentionDays is
// 0, the contact must be hard-deleted immediately (row gone entirely, not
// just soft-deleted) rather than going through the normal soft-delete path.
// ---------------------------------------------------------------------------

const makeCtx = (principalId: PrincipalId): HttpRequestContext => ({
	requestId: RequestId("test"),
	method: "POST",
	url: new URL("http://localhost/ui/api/contacts/x/delete"),
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
		trash: { retentionDays },
	} as unknown as AppConfigType);

describe("contactsDeleteHandler", () => {
	it("soft-deletes when trash.retentionDays > 0 (default retention)", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({
				id: collectionId,
				ownerPrincipalId: principalId,
				collectionType: "addressbook",
			})
			.withInstance({
				id: instanceId,
				collectionId,
				contentType: "text/vcard",
			});
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:unbind",
		});

		const layer = Layer.mergeAll(
			env.toLayer(),
			configLayer(30),
			CardEditServiceLive.pipe(Layer.provide(env.toLayer())),
		);

		const res = await Effect.runPromise(
			contactsDeleteHandler(
				new Request("http://localhost"),
				makeCtx(principalId),
				InstanceId(instanceId),
			).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(res.status).toBe(303);
		// Row still present, just soft-deleted — recoverable from the trash bin.
		expect(env.stores.instances.has(instanceId)).toBe(true);
		expect(env.stores.instances.get(instanceId)?.deletedAt).not.toBeNull();
	});

	it("hard-deletes immediately when trash.retentionDays === 0", async () => {
		const env = makeTestEnv();
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		env
			.withUser({ principalId })
			.withCollection({
				id: collectionId,
				ownerPrincipalId: principalId,
				collectionType: "addressbook",
			})
			.withInstance({
				id: instanceId,
				collectionId,
				contentType: "text/vcard",
			});
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:unbind",
		});

		const layer = Layer.mergeAll(
			env.toLayer(),
			configLayer(0),
			CardEditServiceLive.pipe(Layer.provide(env.toLayer())),
		);

		const res = await Effect.runPromise(
			contactsDeleteHandler(
				new Request("http://localhost"),
				makeCtx(principalId),
				InstanceId(instanceId),
			).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(res.status).toBe(303);
		// Row is entirely gone — no trace left in the trash bin.
		expect(env.stores.instances.has(instanceId)).toBe(false);
	});
});
