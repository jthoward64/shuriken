import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import { ComponentId, type UuidString } from "#src/domain/ids.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import type {
	InstanceRepositoryShape,
	InstanceRow,
} from "#src/services/instance/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import type {
	ShareLinkCalendarRow,
	ShareLinkRow,
} from "#src/services/share-link/repository.ts";
import type { ShareLinkSummary } from "#src/services/share-link/service.ts";
import { renderFeed } from "./render.ts";

// ---------------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------------

const makeVevent = (
	uid: string,
	summary: string,
	props: ReadonlyArray<{ name: string; value: string }> = [],
): IrComponent => ({
	name: "VEVENT",
	properties: [
		{
			name: "UID",
			parameters: [],
			value: { type: "TEXT", value: uid },
			isKnown: true,
		},
		{
			name: "DTSTAMP",
			parameters: [],
			value: { type: "TEXT", value: "20260101T000000Z" },
			isKnown: true,
		},
		{
			name: "DTSTART",
			parameters: [],
			value: { type: "TEXT", value: "20260101T100000Z" },
			isKnown: true,
		},
		{
			name: "SUMMARY",
			parameters: [],
			value: { type: "TEXT", value: summary },
			isKnown: true,
		},
		...props.map((p) => ({
			name: p.name,
			parameters: [],
			value: { type: "TEXT" as const, value: p.value },
			isKnown: true,
		})),
	],
	components: [],
});

const makeVcalendar = (events: ReadonlyArray<IrComponent>): IrComponent => ({
	name: "VCALENDAR",
	properties: [
		{
			name: "VERSION",
			parameters: [],
			value: { type: "TEXT", value: "2.0" },
			isKnown: true,
		},
		{
			name: "PRODID",
			parameters: [],
			value: { type: "TEXT", value: "-//test//EN" },
			isKnown: true,
		},
	],
	components: events,
});

const stubInstanceRepo = (
	instances: ReadonlyArray<InstanceRow>,
): InstanceRepositoryShape => ({
	findById: () => Effect.succeed(Option.none()),
	findBySlug: () => Effect.succeed(Option.none()),
	listByCollection: () => Effect.succeed(instances),
	findChangedSince: () => Effect.succeed([]),
	findByIds: () => Effect.succeed([]),
	insert: () => Effect.die("unused"),
	updateEtag: () => Effect.void,
	softDelete: () => Effect.void,
	relocate: () => Effect.die("unused"),
	updateClientProperties: () => Effect.die("unused"),
	listSharedWithPrincipals: () => Effect.succeed([]),
});

const stubComponentRepo = (
	trees: ReadonlyMap<string, IrComponent>,
): ComponentRepositoryShape => ({
	insertTree: () => Effect.succeed(ComponentId(crypto.randomUUID())),
	loadTree: (entityId) =>
		Effect.succeed(Option.fromNullable(trees.get(entityId as string))),
	deleteByEntity: () => Effect.void,
});

const fakeInstance = (
	id: string,
	collectionId: string,
	entityId: string,
): InstanceRow => ({
	id: id as UuidString,
	collectionId: collectionId as UuidString,
	entityId: entityId as UuidString,
	contentType: "text/calendar",
	etag: "etag",
	syncRevision: 1,
	lastModified: null as unknown as InstanceRow["lastModified"],
	updatedAt: null as unknown as InstanceRow["updatedAt"],
	deletedAt: null,
	scheduleTag: null,
	contentLength: null,
	slug: "x.ics",
	clientProperties: {},
});

const summary = (
	calendarId: string,
	visibility: ShareLinkCalendarRow["visibility"],
): ShareLinkSummary => ({
	link: {
		id: "00000000-0000-0000-0000-00000000aaaa" as UuidString,
		enabled: true,
		userId: "00000000-0000-0000-0000-00000000bbbb" as UuidString,
		token: "tok",
		displayName: "Test feed",
		updatedAt: null as unknown as ShareLinkRow["updatedAt"],
		expiresAt: null,
	},
	calendars: [
		{
			shareLinkId: "00000000-0000-0000-0000-00000000aaaa" as UuidString,
			calendarId: calendarId as UuidString,
			visibility,
		},
	],
});

const runRender = (
	summaryArg: ShareLinkSummary,
	instances: ReadonlyArray<InstanceRow>,
	trees: ReadonlyMap<string, IrComponent>,
): Promise<string> =>
	Effect.runPromise(
		renderFeed(summaryArg).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(InstanceRepository, stubInstanceRepo(instances)),
					Layer.succeed(ComponentRepository, stubComponentRepo(trees)),
				),
			),
		),
	);

describe("renderFeed", () => {
	const calId = "00000000-0000-0000-0000-000000001111";
	const entityId = "00000000-0000-0000-0000-000000002222";

	it("preserves SUMMARY/DESCRIPTION when visibility=all", async () => {
		const event = makeVevent("u1", "Real title", [
			{ name: "DESCRIPTION", value: "details" },
			{ name: "LOCATION", value: "room 1" },
		]);
		const ics = await runRender(
			summary(calId, "all"),
			[fakeInstance("i1", calId, entityId)],
			new Map([[entityId, makeVcalendar([event])]]),
		);
		expect(ics).toContain("SUMMARY:Real title");
		expect(ics).toContain("DESCRIPTION:details");
		expect(ics).toContain("LOCATION:room 1");
	});

	it("strips private fields but keeps SUMMARY when visibility=limited", async () => {
		const event = makeVevent("u1", "Real title", [
			{ name: "DESCRIPTION", value: "details" },
			{ name: "LOCATION", value: "room 1" },
		]);
		const ics = await runRender(
			summary(calId, "limited"),
			[fakeInstance("i1", calId, entityId)],
			new Map([[entityId, makeVcalendar([event])]]),
		);
		expect(ics).toContain("SUMMARY:Real title");
		expect(ics).not.toContain("DESCRIPTION");
		expect(ics).not.toContain("LOCATION");
	});

	it("replaces SUMMARY with 'Busy' when visibility=free_busy", async () => {
		const event = makeVevent("u1", "Real title", [
			{ name: "DESCRIPTION", value: "details" },
		]);
		const ics = await runRender(
			summary(calId, "free_busy"),
			[fakeInstance("i1", calId, entityId)],
			new Map([[entityId, makeVcalendar([event])]]),
		);
		expect(ics).toContain("SUMMARY:Busy");
		expect(ics).not.toContain("Real title");
		expect(ics).not.toContain("DESCRIPTION");
	});

	it("dedupes VTIMEZONE components by TZID", async () => {
		const vtz: IrComponent = {
			name: "VTIMEZONE",
			properties: [
				{
					name: "TZID",
					parameters: [],
					value: { type: "TEXT", value: "America/New_York" },
					isKnown: true,
				},
			],
			components: [],
		};
		const e1 = makeVevent("u1", "A");
		const e2 = makeVevent("u2", "B");
		const tree1 = makeVcalendar([vtz, e1]);
		const tree2 = makeVcalendar([vtz, e2]);
		const ics = await runRender(
			summary(calId, "all"),
			[fakeInstance("i1", calId, "ent1"), fakeInstance("i2", calId, "ent2")],
			new Map([
				["ent1", tree1],
				["ent2", tree2],
			]),
		);
		const tzidMatches = ics.match(/TZID:America\/New_York/g) ?? [];
		expect(tzidMatches.length).toBe(1);
	});
});
