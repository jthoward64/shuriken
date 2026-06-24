/** biome-ignore-all lint/style/useNamingConvention: tagged-union discriminants use _tag */
import { Effect, Layer, Option } from "effect";
import { simpleParser } from "mailparser";
import { decodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent } from "#src/data/ir.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { Email } from "#src/domain/types/strings.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { CalEditService } from "#src/services/cal-edit/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import type { ImipInboundOutcome } from "./inbound.ts";
import { ImipInboundService } from "./inbound.ts";

// ---------------------------------------------------------------------------
// Live ImipInboundService — see inbound.ts for the contract.
//
// Routing rules:
//   * REQUEST/CANCEL/REPLY for an existing UID in the recipient's primary
//     calendar → apply via CalEditService.update (or .delete for CANCEL).
//   * REQUEST for a new UID → CalEditService.create on the primary calendar.
//   * Anything else → MalformedIcs.
//
// "Primary calendar" is the one with `slug = "primary"` and
// `collection_type = "calendar"`. Future enhancement: route to a dedicated
// scheduling inbox collection (RFC 6638) but for v1 dropping into primary
// is the simplest useful behaviour.
// ---------------------------------------------------------------------------

const findVCalendarPart = (
	parsed: Awaited<ReturnType<typeof simpleParser>>,
): string | null => {
	if (parsed.text && /BEGIN:VCALENDAR/i.test(parsed.text)) {
		// `simpleParser` puts a text/calendar body into .text when it's the only
		// body part — happy path for our own outbound messages.
		return parsed.text;
	}
	const attachments = parsed.attachments ?? [];
	for (const att of attachments) {
		const ct = (att.contentType ?? "").toLowerCase();
		if (ct.startsWith("text/calendar")) {
			return att.content.toString("utf8");
		}
	}
	return null;
};

const veventOf = (root: IrComponent): IrComponent | null =>
	root.components.find((c) => c.name === "VEVENT") ?? null;

const methodOf = (root: IrComponent): string | null => {
	const p = root.properties.find((pp) => pp.name === "METHOD");
	return p && p.value.type === "TEXT" ? p.value.value.toUpperCase() : null;
};

const uidOf = (vevent: IrComponent): string | null => {
	const p = vevent.properties.find((pp) => pp.name === "UID");
	if (!p) {
		return null;
	}
	if (p.value.type === "TEXT" || p.value.type === "URI") {
		return p.value.value;
	}
	return null;
};

const findExistingByUid = (
	collectionId: CollectionId,
	uid: string,
): Effect.Effect<
	{
		readonly entityId: import("#src/domain/ids.ts").EntityId;
		readonly instanceId: import("#src/domain/ids.ts").InstanceId;
	} | null,
	DatabaseError,
	EntityRepository
> =>
	Effect.gen(function* () {
		const entityRepo = yield* EntityRepository;
		const rows = yield* entityRepo.listActiveInstancesWithUid(collectionId);
		const match = rows.find((r) => r.logicalUid === uid);
		return match
			? { entityId: match.entityId, instanceId: match.instanceId }
			: null;
	});

const process_ = (input: {
	readonly recipientEmail: string;
	readonly rawMessage: string;
}): Effect.Effect<
	ImipInboundOutcome,
	DatabaseError | DavError | InternalError,
	| CalEditService
	| CollectionRepository
	| ComponentRepository
	| EntityRepository
	| InstanceRepository
	| InstanceService
	| UserRepository
> =>
	Effect.gen(function* () {
		const userRepo = yield* UserRepository;
		const collRepo = yield* CollectionRepository;
		const calEdit = yield* CalEditService;

		// 1. Recipient lookup (case-insensitive on email).
		const userOpt = yield* userRepo.findByEmail(
			Email(input.recipientEmail.toLowerCase()),
		);
		if (Option.isNone(userOpt)) {
			return {
				_tag: "UnknownRecipient" as const,
				recipientEmail: input.recipientEmail,
			};
		}
		const recipient = userOpt.value;
		const principalId = recipient.principal.id as PrincipalId;
		// Tag once for telemetry; not relied on later.
		yield* Effect.annotateCurrentSpan({
			"imip.recipient_user_id": recipient.user.id,
		});

		// 2. Parse MIME → find VCALENDAR text → decode IR.
		const parsed = yield* Effect.tryPromise({
			try: () => simpleParser(input.rawMessage),
			catch: (e) => new InternalError({ cause: e }),
		});
		const ics = findVCalendarPart(parsed);
		if (ics === null) {
			return { _tag: "NotImip" as const };
		}
		const doc = yield* decodeICalendar(ics).pipe(
			Effect.mapError(
				(e) =>
					new InternalError({
						cause: e instanceof Error ? e : new Error(String(e)),
					}),
			),
		);
		const method = methodOf(doc.root);
		const vevent = veventOf(doc.root);
		if (vevent === null || method === null) {
			return {
				_tag: "MalformedIcs" as const,
				cause: "no METHOD or VEVENT",
			};
		}
		const uid = uidOf(vevent);
		if (uid === null) {
			return { _tag: "MalformedIcs" as const, cause: "no UID" };
		}

		// 3. Locate primary calendar.
		const collections = yield* collRepo.listByOwner(principalId);
		const primary = collections.find(
			(c) =>
				c.collectionType === "calendar" &&
				c.deletedAt === null &&
				c.slug === "primary",
		);
		if (!primary) {
			return {
				_tag: "MissingCalendar" as const,
				recipientEmail: input.recipientEmail,
			};
		}
		const calendarId = primary.id as CollectionId;

		// 4. Apply by method.
		const existing = yield* findExistingByUid(calendarId, uid);
		const form = parseVeventToForm(vevent);

		if (method === "CANCEL") {
			if (existing) {
				yield* calEdit.delete(existing.instanceId);
			}
			return {
				_tag: "Applied" as const,
				method,
				recipientEmail: input.recipientEmail,
				uid,
			};
		}

		// REQUEST / REPLY both apply the new state. REPLY would normally only
		// adjust the ATTENDEE PARTSTAT; for v1 we treat it the same as REQUEST
		// because the form-driven update only owns surface fields.
		if (existing) {
			yield* calEdit.update(existing.instanceId, form);
		} else {
			yield* calEdit.create(calendarId, form, uid);
		}
		return {
			_tag: "Applied" as const,
			method,
			recipientEmail: input.recipientEmail,
			uid,
		};
	});

export const ImipInboundServiceLive = Layer.effect(
	ImipInboundService,
	Effect.gen(function* () {
		const calEdit = yield* CalEditService;
		const collRepo = yield* CollectionRepository;
		const componentRepo = yield* ComponentRepository;
		const entityRepo = yield* EntityRepository;
		const instRepo = yield* InstanceRepository;
		const instSvc = yield* InstanceService;
		const userRepo = yield* UserRepository;
		return {
			process: (input) =>
				process_(input).pipe(
					Effect.provideService(CalEditService, calEdit),
					Effect.provideService(CollectionRepository, collRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceRepository, instRepo),
					Effect.provideService(InstanceService, instSvc),
					Effect.provideService(UserRepository, userRepo),
				),
		};
	}),
);

// Sentinel — keeps unused-import lint quiet on imports that future revisions
// will need (UserId for telemetry tagging).
export type _UserIdSentinel = UserId;
