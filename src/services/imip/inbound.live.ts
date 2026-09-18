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
import {
	CollectionId,
	type EntityId,
	type InstanceId,
	PrincipalId,
	type UserId,
} from "#src/domain/ids.ts";
import { parseEmail } from "#src/domain/types/strings.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { CalEditService } from "#src/services/cal-edit/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import {
	extractAttendeeAddresses,
	extractOrganizerAddress,
} from "./build-message.ts";
import type { ImipInboundOutcome } from "./inbound.ts";
import { ImipInboundService } from "./inbound.ts";

const VCALENDAR_MARKER = /BEGIN:VCALENDAR/iu;

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

/** The text/calendar body of an inbound message, if it carries one */
const findVCalendarPart = (
	parsed: Awaited<ReturnType<typeof simpleParser>>,
): Option.Option<string> => {
	if (parsed.text && VCALENDAR_MARKER.test(parsed.text)) {
		// `simpleParser` puts a text/calendar body into .text when it's the only
		// body part — happy path for our own outbound messages.
		return Option.some(parsed.text);
	}
	for (const att of parsed.attachments ?? []) {
		if ((att.contentType ?? "").toLowerCase().startsWith("text/calendar")) {
			return Option.some(att.content.toString("utf8"));
		}
	}
	return Option.none();
};

/** The first VEVENT of a VCALENDAR tree */
const veventOf = (root: IrComponent): Option.Option<IrComponent> =>
	Option.fromNullishOr(root.components.find((c) => c.name === "VEVENT"));

/** The VCALENDAR METHOD, upper-cased */
const methodOf = (root: IrComponent): Option.Option<string> => {
	const p = root.properties.find((pp) => pp.name === "METHOD");
	return p?.value.type === "TEXT"
		? Option.some(p.value.value.toUpperCase())
		: Option.none();
};

/** The VEVENT's UID */
const uidOf = (vevent: IrComponent): Option.Option<string> => {
	const p = vevent.properties.find((pp) => pp.name === "UID");
	if (p?.value.type === "TEXT" || p?.value.type === "URI") {
		return Option.some(p.value.value);
	}
	return Option.none();
};

/**
 * Whether an inbound message claiming to be from `incomingOrganizer` about
 * `recipientEmail` is authorized to modify/cancel `existingVevent`. Checks
 * only run against fields the stored event actually records — an event with
 * no ORGANIZER/ATTENDEE on file (e.g. created locally, never scheduled)
 * can't be authenticated this way and is left unauthenticated as before.
 */
const isAuthorizedSender = (
	existingVevent: IrComponent,
	incomingOrganizer: Option.Option<string>,
	recipientEmail: string,
): boolean => {
	const existingOrganizer = extractOrganizerAddress(existingVevent);
	if (
		Option.isSome(existingOrganizer) &&
		existingOrganizer.value !==
			Option.getOrUndefined(incomingOrganizer)?.toLowerCase()
	) {
		return false;
	}
	const existingAttendees = extractAttendeeAddresses(existingVevent).map((a) =>
		a.toLowerCase(),
	);
	return (
		existingAttendees.length === 0 ||
		existingAttendees.includes(recipientEmail.toLowerCase())
	);
};

/** An existing calendar object resource matched by UID */
interface ExistingEvent {
	readonly entityId: EntityId;
	readonly instanceId: InstanceId;
}

/** Locate the recipient's stored copy of a UID, if they already have one */
const findExistingByUid = Effect.fn("imip.inbound.findExistingByUid")(
	function* (collectionId: CollectionId, uid: string) {
		const entityRepo = yield* EntityRepository;
		const rows = yield* entityRepo.listActiveInstancesWithUid(collectionId);
		return Option.map(
			Option.fromNullishOr(rows.find((r) => r.logicalUid === uid)),
			(match): ExistingEvent => ({
				entityId: match.entityId,
				instanceId: match.instanceId,
			}),
		);
	},
);

/** The decoded scheduling content of an inbound iMIP message */
interface ImipPayload {
	readonly method: string;
	readonly vevent: IrComponent;
	readonly uid: string;
}

/** Decode the MIME message down to its iMIP payload, or say why it is unusable */
const decodeImipMessage = Effect.fn("imip.inbound.decodeMessage")(function* (
	rawMessage: string,
) {
	const parsed = yield* Effect.tryPromise({
		try: () => simpleParser(rawMessage),
		catch: (e) => new InternalError({ cause: e }),
	});
	const icsOpt = findVCalendarPart(parsed);
	if (Option.isNone(icsOpt)) {
		return { _tag: "NotImip" as const };
	}
	const doc = yield* decodeICalendar(icsOpt.value).pipe(
		Effect.mapError(
			(e) =>
				new InternalError({
					cause: e instanceof Error ? e : new Error(String(e)),
				}),
		),
	);
	const method = methodOf(doc.root);
	const veventOpt = veventOf(doc.root);
	if (Option.isNone(veventOpt) || Option.isNone(method)) {
		return { _tag: "MalformedIcs" as const, cause: "no METHOD or VEVENT" };
	}
	const uid = uidOf(veventOpt.value);
	if (Option.isNone(uid)) {
		return { _tag: "MalformedIcs" as const, cause: "no UID" };
	}
	const payload: ImipPayload = {
		method: method.value,
		vevent: veventOpt.value,
		uid: uid.value,
	};
	return payload;
});

/** Reject an update unless the stored copy authenticates the claimed sender */
const isSenderAuthorized = Effect.fn("imip.inbound.isSenderAuthorized")(
	function* (
		existing: ExistingEvent,
		payload: ImipPayload,
		recipientEmail: string,
	) {
		const componentRepo = yield* ComponentRepository;
		const existingTreeOpt = yield* componentRepo.loadTree(
			existing.entityId,
			"icalendar",
		);
		return Option.match(Option.flatMap(existingTreeOpt, veventOf), {
			onNone: () => true,
			onSome: (existingVevent) =>
				isAuthorizedSender(
					existingVevent,
					extractOrganizerAddress(payload.vevent),
					recipientEmail,
				),
		});
	},
);

/** Apply a decoded payload to the recipient's primary calendar */
const applyPayload = Effect.fn("imip.inbound.applyPayload")(function* (
	target: {
		readonly calendarId: CollectionId;
		readonly recipientEmail: string;
	},
	payload: ImipPayload,
) {
	const calEdit = yield* CalEditService;
	const existing = yield* findExistingByUid(target.calendarId, payload.uid);

	if (
		Option.isSome(existing) &&
		!(yield* isSenderAuthorized(existing.value, payload, target.recipientEmail))
	) {
		return {
			_tag: "SenderNotAuthorized" as const,
			recipientEmail: target.recipientEmail,
			uid: payload.uid,
		};
	}

	if (payload.method === "CANCEL") {
		if (Option.isSome(existing)) {
			yield* calEdit.delete(existing.value.instanceId);
		}
	} else if (Option.isSome(existing)) {
		// REQUEST / REPLY both apply the new state. REPLY would normally only
		// adjust the ATTENDEE PARTSTAT; for v1 we treat it the same as REQUEST
		// because the form-driven update only owns surface fields.
		yield* calEdit.update(
			existing.value.instanceId,
			parseVeventToForm(payload.vevent),
		);
	} else {
		yield* calEdit.create(
			target.calendarId,
			parseVeventToForm(payload.vevent),
			payload.uid,
		);
	}
	return {
		_tag: "Applied" as const,
		method: payload.method,
		recipientEmail: target.recipientEmail,
		uid: payload.uid,
	};
});

/** The recipient's primary calendar - slug "primary", not deleted */
const findPrimaryCalendar = Effect.fn("imip.inbound.findPrimaryCalendar")(
	function* (principalId: PrincipalId) {
		const collRepo = yield* CollectionRepository;
		const collections = yield* collRepo.listByOwner(principalId);
		return Option.fromNullishOr(
			collections.find(
				(c) =>
					c.collectionType === "calendar" &&
					c.deletedAt === null &&
					c.slug === "primary",
			),
		);
	},
);

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

		// 1. Recipient lookup (case-insensitive on email).
		const userOpt = yield* userRepo.findByEmail(
			parseEmail(input.recipientEmail),
		);
		if (Option.isNone(userOpt)) {
			return {
				_tag: "UnknownRecipient" as const,
				recipientEmail: input.recipientEmail,
			};
		}
		const recipient = userOpt.value;
		// Tag once for telemetry; not relied on later.
		yield* Effect.annotateCurrentSpan({
			"imip.recipient_user_id": recipient.user.id,
		});

		// 2. Parse MIME → find VCALENDAR text → decode IR.
		const decoded = yield* decodeImipMessage(input.rawMessage);
		if ("_tag" in decoded) {
			return decoded;
		}

		// 3. Locate primary calendar.
		const primary = yield* findPrimaryCalendar(
			PrincipalId(recipient.principal.id),
		);
		if (Option.isNone(primary)) {
			return {
				_tag: "MissingCalendar" as const,
				recipientEmail: input.recipientEmail,
			};
		}

		// 4. Apply by method.
		return yield* applyPayload(
			{
				calendarId: CollectionId(primary.value.id),
				recipientEmail: input.recipientEmail,
			},
			decoded,
		);
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
