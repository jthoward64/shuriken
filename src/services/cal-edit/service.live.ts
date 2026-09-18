import { Effect, Layer, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
	needPrivileges,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { isReadOnlyCollection } from "#src/services/collection/read-only-guard.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { buildVeventComponent } from "./build-vevent.ts";
import { CalEditService } from "./service.ts";
import type { EventFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// Live CalEditService — see service.ts.
//
// Edit semantics: when updating, properties the form doesn't surface
// (ATTENDEE, ORGANIZER, ALARM components, …) are copied from the existing
// IR tree into the new VEVENT so an edit-save doesn't silently strip them.
// The form-owned properties (UID, SUMMARY, DTSTART, DTEND, DESCRIPTION,
// LOCATION, CATEGORIES, RRULE) are replaced wholesale.
// ---------------------------------------------------------------------------

const FORM_OWNED_PROPS = new Set([
	"UID",
	"SUMMARY",
	"DESCRIPTION",
	"LOCATION",
	"DTSTART",
	"DTEND",
	"CATEGORIES",
	"RRULE",
	// ATTENDEE / ORGANIZER are form-managed: the new payload is the
	// authoritative set. Without this, edits that remove an attendee leave
	// a stale ATTENDEE in the IR and resend REQUESTs to ghosts.
	"ATTENDEE",
	"ORGANIZER",
]);

const SLUG_MAX_BODY = 120;

const slugFromUid = (uid: string): Slug => {
	const safe = uid.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "event"}.ics`);
};

const wrapInDoc = (vevent: IrComponent): IrDocument => ({
	kind: "icalendar",
	root: {
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
				value: { type: "TEXT", value: "-//shuriken//calendar//EN" },
				isKnown: true,
			},
		],
		components: [vevent],
	},
});

const newUid = (): string => `${crypto.randomUUID()}@shuriken`;

/** Persists a new event: entity row, VCALENDAR tree and collection instance. */
const insertEvent = Effect.fn("CalEditService.insertEvent")(function* (input: {
	readonly calendarId: CollectionId;
	readonly uid: string;
	readonly root: IrComponent;
	readonly etag: ETag;
	readonly slug: Slug;
	readonly contentLength: number;
}) {
	const componentRepo = yield* ComponentRepository;
	const entityRepo = yield* EntityRepository;
	const instanceSvc = yield* InstanceService;
	const entityRow = yield* entityRepo.insert({
		entityType: "icalendar",
		logicalUid: input.uid,
	});
	const eid = EntityId(entityRow.id);
	// Match DAV PUT convention: store the VCALENDAR root, not the bare
	// VEVENT, so readers (REPORT, the events feed) find the event under
	// tree.components.
	yield* componentRepo.insertTree(eid, input.root);
	const instance = yield* instanceSvc.put({
		collectionId: input.calendarId,
		entityId: eid,
		contentType: "text/calendar",
		etag: input.etag,
		slug: input.slug,
		contentLength: input.contentLength,
	});
	return { entityId: eid, instanceId: instance.id as InstanceId };
});

/** Rewrites an existing event's tree and bumps its instance etag. */
const rewriteEvent = Effect.fn("CalEditService.rewriteEvent")(
	function* (input: {
		readonly collectionId: CollectionId;
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly root: IrComponent;
		readonly etag: ETag;
		readonly slug: Slug;
		readonly contentLength: number;
	}) {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		yield* componentRepo.deleteByEntity(input.entityId);
		yield* componentRepo.insertTree(input.entityId, input.root);
		yield* instanceSvc.put(
			{
				collectionId: input.collectionId,
				entityId: input.entityId,
				contentType: "text/calendar",
				etag: input.etag,
				slug: input.slug,
				contentLength: input.contentLength,
			},
			input.instanceId,
		);
	},
);

const create = (
	calendarId: CollectionId,
	form: EventFormData,
	uidOverride?: string,
): Effect.Effect<
	{
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly slug: string;
		readonly uid: string;
	},
	DatabaseError | DavError | InternalError,
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| ExternalCalendarRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;

		// Mirrors the DAV-layer read-only-guard check: the birthdays generator /
		// subscription sync own these collections' event sets, so a manual
		// create through the UI form would just be clobbered on the next run.
		if (yield* isReadOnlyCollection(calendarId)) {
			return yield* Effect.fail(
				needPrivileges("collection is server-managed and accepts no writes"),
			);
		}

		const uid = uidOverride ?? newUid();
		const vevent = yield* Option.match(buildVeventComponent(uid, form), {
			onNone: () =>
				Effect.fail(
					new InternalError({ cause: new Error("invalid event form") }),
				),
			onSome: Effect.succeed,
		});
		const doc = wrapInDoc(vevent);
		const canonical = yield* encodeICalendar(doc);
		const etag = ETag(yield* makeEtag(canonical));
		const slug = slugFromUid(uid);
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		const result = yield* withTransaction(
			insertEvent({
				calendarId,
				uid,
				root: doc.root,
				etag,
				slug,
				contentLength,
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return {
			entityId: result.entityId,
			instanceId: result.instanceId,
			slug,
			uid,
		};
	});

const mergePreservedProps = (
	existing: IrComponent | null,
	rebuilt: IrComponent,
): IrComponent => {
	if (!existing) {
		return rebuilt;
	}
	const preserved = existing.properties.filter(
		(p) => !FORM_OWNED_PROPS.has(p.name),
	);
	return {
		...rebuilt,
		properties: [...rebuilt.properties, ...preserved],
		// VALARM / sub-components are also preserved as-is.
		components: existing.components,
	};
};

const update = (
	instanceId: InstanceId,
	form: EventFormData,
): Effect.Effect<
	{
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly slug: string;
		readonly uid: string;
	},
	DatabaseError | DavError | InternalError,
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| ExternalCalendarRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const existing = yield* instanceSvc.findById(instanceId);
		if (yield* isReadOnlyCollection(CollectionId(existing.collectionId))) {
			return yield* Effect.fail(
				needPrivileges("collection is server-managed and accepts no writes"),
			);
		}
		const entityId = EntityId(existing.entityId);
		const existingDocOpt = yield* componentRepo.loadTree(entityId, "icalendar");
		const existingVevent =
			existingDocOpt._tag === "Some"
				? (existingDocOpt.value.components.find((c) => c.name === "VEVENT") ??
					null)
				: null;
		// Carry UID through — vCard-style logical-UID stability.
		const uidFromTree =
			existingVevent?.properties
				.find((p) => p.name === "UID")
				?.value.value?.toString() ?? null;
		const finalUid = uidFromTree ?? `${existing.entityId}@shuriken`;

		const rebuilt = yield* Option.match(buildVeventComponent(finalUid, form), {
			onNone: () =>
				Effect.fail(
					new InternalError({ cause: new Error("invalid event form") }),
				),
			onSome: Effect.succeed,
		});
		const merged = mergePreservedProps(existingVevent, rebuilt);
		const doc = wrapInDoc(merged);
		const canonical = yield* encodeICalendar(doc);
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		yield* withTransaction(
			rewriteEvent({
				collectionId: CollectionId(existing.collectionId),
				entityId,
				instanceId,
				root: doc.root,
				etag,
				slug: Slug(existing.slug),
				contentLength,
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return {
			entityId,
			instanceId,
			slug: existing.slug,
			uid: finalUid,
		};
	});

const del = (
	instanceId: InstanceId,
): Effect.Effect<
	void,
	DatabaseError | DavError | InternalError,
	CollectionRepository | ExternalCalendarRepository | InstanceService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		const existing = yield* instanceSvc.findById(instanceId);
		if (yield* isReadOnlyCollection(CollectionId(existing.collectionId))) {
			return yield* Effect.fail(
				needPrivileges("collection is server-managed and accepts no writes"),
			);
		}
		yield* instanceSvc.delete(instanceId);
	});

export const CalEditServiceLive = Layer.effect(
	CalEditService,
	Effect.gen(function* () {
		const collectionRepo = yield* CollectionRepository;
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const entityRepo = yield* EntityRepository;
		const externalCalendarRepo = yield* ExternalCalendarRepository;
		const instanceSvc = yield* InstanceService;
		return {
			create: (calendarId, form, uidOverride) =>
				create(calendarId, form, uidOverride).pipe(
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(
						ExternalCalendarRepository,
						externalCalendarRepo,
					),
					Effect.provideService(InstanceService, instanceSvc),
				),
			update: (instanceId, form) =>
				update(instanceId, form).pipe(
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(
						ExternalCalendarRepository,
						externalCalendarRepo,
					),
					Effect.provideService(InstanceService, instanceSvc),
				),
			delete: (instanceId) =>
				del(instanceId).pipe(
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(
						ExternalCalendarRepository,
						externalCalendarRepo,
					),
					Effect.provideService(InstanceService, instanceSvc),
				),
		};
	}),
);
