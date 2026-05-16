import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	type CollectionId,
	type PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { importIcs } from "#src/services/cal-edit/import-ics.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockServer } from "#src/testing/script-runner/runner.ts";

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:lunch@test
DTSTAMP:20260101T000000Z
DTSTART:20260601T120000Z
DTEND:20260601T130000Z
SUMMARY:Lunch
DESCRIPTION:secret notes
END:VEVENT
END:VCALENDAR
`;

const setup = (
	visibility: "all" | "limited" | "free_busy",
	overrides?: { readonly enabled?: boolean; readonly expired?: boolean },
) =>
	Effect.gen(function* () {
		const prov = yield* ProvisioningService;
		const alice = yield* prov
			.provisionUser({
				email: Email("alice@example.com"),
				name: "Alice",
				slug: Slug("alice"),
			})
			.pipe(Effect.orDie);
		const calendarId = alice.calendar.id as CollectionId;
		const userId = UserId(alice.user.user.id);
		const principalId = alice.user.principal.id as PrincipalId;

		yield* importIcs(calendarId, ICS, "skip").pipe(Effect.orDie);

		const svc = yield* ShareLinkService;
		const expiresAt = overrides?.expired
			? Temporal.Now.instant().subtract({ hours: 1 })
			: null;
		const summary = yield* svc
			.create(
				{ userId, principalId },
				{
					displayName: "test",
					expiresAt,
					calendars: [{ calendarId, visibility }],
				},
			)
			.pipe(Effect.orDie);
		const token = summary.link.token;

		if (overrides?.enabled === false) {
			yield* svc
				.update(summary.link.id, { userId, principalId }, { enabled: false })
				.pipe(Effect.orDie);
		}
		return token;
	});

const fetchFeed = (token: string) =>
	handleRequest(new Request(`http://localhost/feed/${token}.ics`), mockServer);

describe("share-link feed end-to-end (integration)", () => {
	it("returns 200 with VEVENT for an active link (visibility=all)", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const token = await runtime.runPromise(setup("all"));
			const res = await runtime.runPromise(fetchFeed(token));
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain("SUMMARY:Lunch");
			expect(body).toContain("DESCRIPTION:secret notes");
		} finally {
			await runtime.dispose();
		}
	});

	it("strips SUMMARY when visibility=free_busy", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const token = await runtime.runPromise(setup("free_busy"));
			const res = await runtime.runPromise(fetchFeed(token));
			expect(res.status).toBe(200);
			const body = await res.text();
			expect(body).toContain("SUMMARY:Busy");
			expect(body).not.toContain("Lunch");
			expect(body).not.toContain("secret notes");
		} finally {
			await runtime.dispose();
		}
	});

	it("returns 404 when link is disabled", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const token = await runtime.runPromise(setup("all", { enabled: false }));
			const res = await runtime.runPromise(fetchFeed(token));
			expect(res.status).toBe(404);
		} finally {
			await runtime.dispose();
		}
	});

	it("returns 404 when link is expired", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const token = await runtime.runPromise(setup("all", { expired: true }));
			const res = await runtime.runPromise(fetchFeed(token));
			expect(res.status).toBe(404);
		} finally {
			await runtime.dispose();
		}
	});

	it("returns 404 for unknown tokens", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const res = await runtime.runPromise(fetchFeed("does-not-exist"));
			expect(res.status).toBe(404);
		} finally {
			await runtime.dispose();
		}
	});
});
