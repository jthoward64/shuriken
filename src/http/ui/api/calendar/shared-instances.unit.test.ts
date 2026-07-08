import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { PrincipalId, UserId, type UuidString } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import type { CalendarEventView } from "./collect-events.ts";
import {
	filterViewsByRange,
	findUncoveredSharedInstances,
} from "./shared-instances.ts";

// ---------------------------------------------------------------------------
// findUncoveredSharedInstances — backs the synthetic "Shared events" pseudo-
// calendar on the Calendar page. Must show only events granted directly to
// the caller whose parent calendar isn't already owned or shared as a whole
// — otherwise the event would double-appear: once via its calendar's normal
// feed, once via this synthetic one.
// ---------------------------------------------------------------------------

const principalOf = (principalId: UuidString): AuthenticatedPrincipal => ({
	principalId: PrincipalId(principalId),
	userId: UserId(crypto.randomUUID()),
	displayName: Option.none(),
});

describe("findUncoveredSharedInstances", () => {
	it("excludes an instance whose parent collection the caller owns", async () => {
		const viewer = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ principalId: viewer })
			.withCollection({ id: collectionId, ownerPrincipalId: viewer })
			.withInstance({ id: instanceId, collectionId })
			.withAce({
				resourceType: "instance",
				resourceId: instanceId,
				principalType: "principal",
				principalId: viewer,
				privilege: "DAV:read",
			});

		const result = await runSuccess(
			findUncoveredSharedInstances(
				principalOf(viewer),
				new Set([collectionId]),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);
		expect(result).toEqual([]);
	});

	it("excludes an instance whose parent collection is already covered as a shared collection", async () => {
		const viewer = crypto.randomUUID();
		const owner = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ principalId: viewer })
			.withUser({ principalId: owner })
			.withCollection({ id: collectionId, ownerPrincipalId: owner })
			.withInstance({ id: instanceId, collectionId })
			.withAce({
				resourceType: "instance",
				resourceId: instanceId,
				principalType: "principal",
				principalId: viewer,
				privilege: "DAV:read",
			});

		// `coveredCollectionIds` here stands in for "already shown via a shared
		// calendar" — the instance-level grant must not also surface it in the
		// synthetic pseudo-calendar.
		const result = await runSuccess(
			findUncoveredSharedInstances(
				principalOf(viewer),
				new Set([collectionId]),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);
		expect(result).toEqual([]);
	});

	it("includes an instance shared directly whose parent collection is neither owned nor shared", async () => {
		const viewer = crypto.randomUUID();
		const owner = crypto.randomUUID();
		const collectionId = crypto.randomUUID();
		const instanceId = crypto.randomUUID();
		const env = makeTestEnv()
			.withUser({ principalId: viewer })
			.withUser({ principalId: owner })
			.withCollection({ id: collectionId, ownerPrincipalId: owner })
			.withInstance({ id: instanceId, collectionId })
			.withAce({
				resourceType: "instance",
				resourceId: instanceId,
				principalType: "principal",
				principalId: viewer,
				privilege: "DAV:read",
			});

		const result = await runSuccess(
			findUncoveredSharedInstances(principalOf(viewer), new Set()).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result.map((i) => i.id)).toEqual([instanceId]);
	});
});

// ---------------------------------------------------------------------------
// filterViewsByRange — in-memory date-range filter applied after hydrating
// individually-shared instances (no index-backed range query for this path).
// ---------------------------------------------------------------------------

const baseView: CalendarEventView = {
	id: "evt-1",
	title: "Standup",
	allDay: false,
	start: "2026-06-15T09:00",
	end: "2026-06-15T09:30",
	rruleRaw: null,
	description: "",
	location: "",
	categoriesCsv: "",
};

describe("filterViewsByRange", () => {
	it("passes everything through when the range is unbounded", () => {
		expect(filterViewsByRange([baseView], null, null)).toEqual([baseView]);
	});

	it("keeps a timed event that overlaps the range", () => {
		const start = Temporal.Instant.from("2026-06-01T00:00:00Z");
		const end = Temporal.Instant.from("2026-07-01T00:00:00Z");
		expect(filterViewsByRange([baseView], start, end)).toEqual([baseView]);
	});

	it("drops a timed event outside the range", () => {
		const start = Temporal.Instant.from("2026-07-01T00:00:00Z");
		const end = Temporal.Instant.from("2026-08-01T00:00:00Z");
		expect(filterViewsByRange([baseView], start, end)).toEqual([]);
	});

	it("keeps an all-day event that overlaps the range", () => {
		const allDay: CalendarEventView = {
			...baseView,
			allDay: true,
			start: "2026-06-15",
			end: "2026-06-16",
		};
		const start = Temporal.Instant.from("2026-06-01T00:00:00Z");
		const end = Temporal.Instant.from("2026-07-01T00:00:00Z");
		expect(filterViewsByRange([allDay], start, end)).toEqual([allDay]);
	});
});
