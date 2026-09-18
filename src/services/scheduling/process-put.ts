// ---------------------------------------------------------------------------
// processAfterPut - implicit scheduling triggered by a PUT (RFC 6638 §3.2)
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import {
	CollectionId,
	type EntityId,
	type InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";
import { deliverToInbox } from "./auto-apply.ts";
import type { SchedulingDeps } from "./deps.ts";
import {
	buildItipCancel,
	buildItipReply,
	buildItipRequest,
} from "./itip-build.ts";
import {
	extractAttendees,
	extractOrganizerCalAddress,
	extractSorUid,
	isSor,
} from "./itip-extract.ts";
import { persistScheduleStatus } from "./persist.ts";
import { actingCalAddress, determineRole } from "./principal-role.ts";
import {
	SCHED_STATUS_DELIVERED,
	SCHED_STATUS_FAILED,
	SCHED_STATUS_PENDING,
} from "./sor-patch.ts";
import type { AttendeeInfo, SchedulingRole } from "./types.ts";

/** What the organizer and attendee branches both need about the resource being put */
interface PutContext {
	readonly actingPrincipalId: PrincipalId;
	readonly entityId: EntityId;
	readonly uid: string;
	readonly organizerCalAddress: string;
	readonly doc: IrDocument;
	readonly previousDoc: Option.Option<IrDocument>;
}

/** The SERVER-agent attendees of a document (RFC 6638 §7.1) */
const serverAttendeesOf = (doc: IrDocument): ReadonlyArray<AttendeeInfo> =>
	extractAttendees(doc).filter((a) => a.scheduleAgent === "SERVER");

/** Log a failed inbox delivery and report the attendee as undelivered */
const logDeliveryFailure = Effect.fn("SchedulingService.logDeliveryFailure")(
	function* (calAddress: string, cause: unknown) {
		yield* Effect.logWarning("scheduling.processAfterPut: delivery failed", {
			attendee: calAddress,
			cause,
		});
		return false;
	},
);

/** A PUT context plus the REQUEST built once for all of the event's attendees */
interface OrganizerContext extends PutContext {
	readonly requestDoc: IrDocument;
}

/** Deliver the REQUEST to an on-server attendee and record the delivery outcome */
const notifyServerAttendee = Effect.fn(
	"SchedulingService.notifyServerAttendee",
)(function* (
	deps: SchedulingDeps,
	ctx: OrganizerContext,
	recipientPrincipalId: PrincipalId,
	attendee: AttendeeInfo,
) {
	const delivered = yield* deliverToInbox(
		deps,
		recipientPrincipalId,
		ctx.requestDoc,
		ctx.uid,
	).pipe(
		Effect.catch((cause) => logDeliveryFailure(attendee.calAddress, cause)),
	);
	yield* Effect.ignore(
		persistScheduleStatus(
			deps,
			ctx.entityId,
			attendee.calAddress,
			delivered ? SCHED_STATUS_DELIVERED : SCHED_STATUS_FAILED,
		),
	);
});

/** Queue an iMIP row for an off-server attendee and mark its status pending */
const queueExternalAttendee = Effect.fn(
	"SchedulingService.queueExternalAttendee",
)(function* (deps: SchedulingDeps, ctx: PutContext, attendee: AttendeeInfo) {
	const inboxOpt = yield* deps.repo.findInbox(ctx.actingPrincipalId);
	if (Option.isSome(inboxOpt)) {
		yield* Effect.ignore(
			deps.repo.insertScheduleMessage({
				collectionId: CollectionId(inboxOpt.value.id),
				entityId: ctx.entityId,
				sender: ctx.organizerCalAddress,
				recipient: attendee.calAddress,
				method: "REQUEST",
			}),
		);
	}
	yield* Effect.ignore(
		persistScheduleStatus(
			deps,
			ctx.entityId,
			attendee.calAddress,
			SCHED_STATUS_PENDING,
		),
	);
});

/** Send a CANCEL to every attendee dropped from the event by this update */
const cancelRemovedAttendees = Effect.fn(
	"SchedulingService.cancelRemovedAttendees",
)(function* (
	deps: SchedulingDeps,
	ctx: PutContext,
	removed: ReadonlyArray<AttendeeInfo>,
) {
	const cancelDoc = buildItipCancel(
		Option.getOrElse(ctx.previousDoc, () => ctx.doc),
	);
	for (const attendee of removed) {
		const recipientOpt = yield* deps.repo.findPrincipalByCalAddress(
			attendee.calAddress,
		);
		if (Option.isSome(recipientOpt)) {
			yield* Effect.ignore(
				deliverToInbox(
					deps,
					PrincipalId(recipientOpt.value.principal.id),
					cancelDoc,
					ctx.uid,
				),
			);
		}
	}
});

/** Organizer PUT: REQUEST the current attendees and CANCEL the removed ones */
const processOrganizerPut = Effect.fn("SchedulingService.processOrganizerPut")(
	function* (deps: SchedulingDeps, base: PutContext) {
		const ctx: OrganizerContext = {
			...base,
			requestDoc: buildItipRequest(base.doc),
		};
		const serverAttendees = serverAttendeesOf(ctx.doc);

		for (const attendee of serverAttendees) {
			// The Organizer holds the master copy and is not sent an iTIP REQUEST
			// for their own event (RFC 5546 §3.2; RFC 6638 §3.2.2). Skipping
			// self-delivery also avoids redundantly auto-applying the REQUEST back
			// onto the Organizer's own scheduling object resource.
			if (
				attendee.calAddress.toLowerCase() ===
				ctx.organizerCalAddress.toLowerCase()
			) {
				continue;
			}
			const recipientOpt = yield* deps.repo.findPrincipalByCalAddress(
				attendee.calAddress,
			);
			if (Option.isSome(recipientOpt)) {
				yield* notifyServerAttendee(
					deps,
					ctx,
					PrincipalId(recipientOpt.value.principal.id),
					attendee,
				);
			} else {
				yield* queueExternalAttendee(deps, ctx, attendee);
			}
		}

		const currAddresses = new Set(
			serverAttendees.map((a) => a.calAddress.toLowerCase()),
		);
		const removedAttendees = Option.match(ctx.previousDoc, {
			onNone: (): ReadonlyArray<AttendeeInfo> => [],
			onSome: (prev) =>
				serverAttendeesOf(prev).filter(
					(a) => !currAddresses.has(a.calAddress.toLowerCase()),
				),
		});
		if (removedAttendees.length > 0) {
			yield* cancelRemovedAttendees(deps, ctx, removedAttendees);
		}
	},
);

/** The acting attendee's PARTSTAT before and after this update */
const partstatChange = (
	ctx: PutContext,
	myAddr: string,
): { readonly previous: string | undefined; readonly current: string } => ({
	previous: Option.getOrUndefined(
		Option.map(
			ctx.previousDoc,
			(prev) =>
				extractAttendees(prev).find(
					(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
				)?.partstat,
		),
	),
	current:
		serverAttendeesOf(ctx.doc).find(
			(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
		)?.partstat ?? "NEEDS-ACTION",
});

/** Route an attendee's REPLY to the organizer's inbox, or queue it for iMIP */
const sendReplyToOrganizer = Effect.fn(
	"SchedulingService.sendReplyToOrganizer",
)(function* (deps: SchedulingDeps, ctx: PutContext, myAddr: string) {
	const organizerOpt = yield* deps.repo.findPrincipalByCalAddress(
		ctx.organizerCalAddress,
	);
	if (Option.isSome(organizerOpt)) {
		yield* Effect.ignore(
			deliverToInbox(
				deps,
				PrincipalId(organizerOpt.value.principal.id),
				buildItipReply(ctx.doc, myAddr),
				ctx.uid,
			),
		);
		return;
	}
	// External organizer — iMIP
	const inboxOpt = yield* deps.repo.findInbox(ctx.actingPrincipalId);
	if (Option.isSome(inboxOpt)) {
		yield* Effect.ignore(
			deps.repo.insertScheduleMessage({
				collectionId: CollectionId(inboxOpt.value.id),
				entityId: ctx.entityId,
				sender: myAddr,
				recipient: ctx.organizerCalAddress,
				method: "REPLY",
			}),
		);
	}
});

/** Attendee PUT: REPLY to the organizer when the acting attendee's PARTSTAT moved */
const processAttendeePut = Effect.fn("SchedulingService.processAttendeePut")(
	function* (deps: SchedulingDeps, ctx: PutContext) {
		const myAddrOpt = yield* actingCalAddress(deps, ctx.actingPrincipalId);
		if (Option.isNone(myAddrOpt)) {
			return;
		}
		const myAddr = myAddrOpt.value;
		const partstat = partstatChange(ctx, myAddr);
		if (
			partstat.previous !== partstat.current ||
			Option.isNone(ctx.previousDoc)
		) {
			yield* sendReplyToOrganizer(deps, ctx, myAddr);
		}
	},
);

/**
 * Decide the Schedule-Tag for this PUT.
 *
 * NOTE — intentional deviation. A *strict* reading of RFC 6638 §3.2.10
 * (Attendee rule 3) and the reference implementation (Apple CalendarServer)
 * both say a direct/explicit PUT — even one that only changes the Attendee's
 * PARTSTAT — MUST mint a fresh Schedule-Tag; the tag is only held stable for
 * server-internal iTIP processing. We deliberately keep it stable for an
 * Attendee's PARTSTAT-style update instead, matching the de-facto caldav
 * ecosystem convention probed by caldav-server-tester
 * (`scheduling.schedule-tag.stable-partstat`): holding the tag avoids breaking
 * other clients' If-Schedule-Tag-Match conditional PUTs across concurrent
 * RSVPs. validateSchedulingChange has already restricted an Attendee's edit to
 * attendee-mutable properties (PARTSTAT, VALARM, TRANSP, …), so every
 * Attendee-role update reaching here is treated as tag-stable. Organizer
 * changes, and brand-new resources, always get a fresh tag.
 */
const decideScheduleTag = (
	role: SchedulingRole,
	previousDoc: Option.Option<IrDocument>,
	previousScheduleTag: Option.Option<string>,
): { readonly tag: string; readonly preserved: boolean } => {
	const existingTag = Option.getOrUndefined(previousScheduleTag);
	const preserved =
		role === "attendee" &&
		Option.isSome(previousDoc) &&
		existingTag !== undefined;
	return {
		tag:
			preserved && existingTag !== undefined
				? existingTag
				: crypto.randomUUID(),
		preserved,
	};
};

export const processAfterPut = Effect.fn("SchedulingService.processAfterPut")(
	function* (
		deps: SchedulingDeps,
		opts: {
			actingPrincipalId: PrincipalId;
			entityId: EntityId;
			instanceId: InstanceId;
			collectionId: CollectionId;
			doc: IrDocument;
			previousDoc: Option.Option<IrDocument>;
			previousScheduleTag: Option.Option<string>;
			suppressReply: boolean;
		},
	) {
		yield* Effect.annotateCurrentSpan({
			"scheduling.principal_id": opts.actingPrincipalId,
			"scheduling.entity_id": opts.entityId,
			"scheduling.instance_id": opts.instanceId,
			"scheduling.is_sor": isSor(opts.doc),
		});
		yield* Effect.logTrace("scheduling.processAfterPut", {
			actingPrincipalId: opts.actingPrincipalId,
			entityId: opts.entityId,
			instanceId: opts.instanceId,
			suppressReply: opts.suppressReply,
			hasPreviousDoc: Option.isSome(opts.previousDoc),
		});

		if (!isSor(opts.doc)) {
			return Option.none<string>();
		}
		const organizerCalAddress = extractOrganizerCalAddress(opts.doc);
		const uid = extractSorUid(opts.doc);
		if (!(organizerCalAddress && uid)) {
			return Option.none<string>();
		}

		const role = yield* determineRole(
			deps,
			opts.actingPrincipalId,
			organizerCalAddress,
		);
		const scheduleTag = decideScheduleTag(
			role,
			opts.previousDoc,
			opts.previousScheduleTag,
		);

		const ctx: PutContext = {
			actingPrincipalId: opts.actingPrincipalId,
			entityId: opts.entityId,
			uid,
			organizerCalAddress,
			doc: opts.doc,
			previousDoc: opts.previousDoc,
		};

		if (role === "organizer") {
			yield* processOrganizerPut(deps, ctx);
		} else if (role === "attendee" && !opts.suppressReply) {
			yield* processAttendeePut(deps, ctx);
		}

		// When preserving the tag (attendee RSVP), the stored value already equals
		// `scheduleTag`; skip the write so we don't churn updated_at.
		if (!scheduleTag.preserved) {
			yield* Effect.ignore(
				deps.repo.updateScheduleTag(opts.instanceId, scheduleTag.tag),
			);
		}
		return Option.some(scheduleTag.tag);
	},
);
