// ---------------------------------------------------------------------------
// Inbox delivery and automatic processing of incoming iTIP messages
// (RFC 6638 §4). Each message updates or creates the matching scheduling object
// resource on the recipient's calendars, alongside the Inbox indicator copy.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import { CollectionId, EntityId, type PrincipalId } from "#src/domain/ids.ts";
import type { SchedulingDeps } from "./deps.ts";
import { patchPartstat, stripMethod } from "./itip-build.ts";
import { extractAttendees, getMethod } from "./itip-extract.ts";
import { persistItipToCollection, updateExistingSor } from "./persist.ts";
import {
	applyReplyToSor,
	isPartstatOnlyChange,
	setStatusCancelled,
} from "./sor-patch.ts";

/**
 * REQUEST (RFC 6638 §4.1): create the SOR, or update an existing copy with the
 * same UID rather than duplicating it.
 */
const autoApplyRequest = Effect.fn("SchedulingService.autoApplyRequest")(
	function* (
		deps: SchedulingDeps,
		recipientPrincipalId: PrincipalId,
		requestDoc: IrDocument,
		uid: string,
	) {
		const calendarDoc = stripMethod(requestDoc);
		const sorOpt = yield* deps.repo.findSorByUid(recipientPrincipalId, uid);
		if (Option.isSome(sorOpt)) {
			// Update case: the Organizer's view is authoritative. The Schedule-Tag
			// changes for a consequential change, but RFC 6638 §3.2.10 Attendee
			// rule 2 requires it to stay stable when the update only changes
			// Attendees' participation status — otherwise a concurrent RSVP would
			// spuriously fail another client's If-Schedule-Tag-Match conditional
			// PUT. Diff the incoming REQUEST against the stored copy to decide.
			const prevTreeOpt = yield* deps.componentRepo.loadTree(
				EntityId(sorOpt.value.instance.entityId),
				"icalendar",
			);
			const partstatOnly =
				Option.isSome(prevTreeOpt) &&
				isPartstatOnlyChange(prevTreeOpt.value, calendarDoc.root);
			yield* updateExistingSor(
				deps,
				sorOpt.value.instance,
				calendarDoc.root,
				partstatOnly ? undefined : crypto.randomUUID(),
			);
			return;
		}
		// New message: auto-place into the schedule-default-calendar with the
		// recipient's participation reset to NEEDS-ACTION (RFC 6638 §3.4.2).
		const defaultCalOpt =
			yield* deps.repo.findDefaultCalendar(recipientPrincipalId);
		if (Option.isSome(defaultCalOpt)) {
			yield* persistItipToCollection(deps, {
				collectionId: CollectionId(defaultCalOpt.value.id),
				itipDoc: patchPartstat(calendarDoc, "NEEDS-ACTION"),
				uid,
				scheduleTag: crypto.randomUUID(),
			});
		}
	},
);

/**
 * REPLY (RFC 6638 §4.2): update the Organizer's SOR with the Attendee's new
 * PARTSTAT. The Schedule-Tag MUST stay stable (§3.2.10 organizer rule 1).
 */
const autoApplyReply = Effect.fn("SchedulingService.autoApplyReply")(function* (
	deps: SchedulingDeps,
	organizerPrincipalId: PrincipalId,
	replyDoc: IrDocument,
	uid: string,
) {
	const sorOpt = yield* deps.repo.findSorByUid(organizerPrincipalId, uid);
	if (Option.isNone(sorOpt)) {
		// RFC 6638 §4.2: no matching SOR — ignore the reply (inbox copy kept).
		yield* Effect.logDebug("scheduling.autoApplyReply: no organizer SOR", {
			uid,
		});
		return;
	}
	const replyAttendees = extractAttendees(replyDoc);
	if (replyAttendees.length === 0) {
		return;
	}
	const treeOpt = yield* deps.componentRepo.loadTree(
		EntityId(sorOpt.value.instance.entityId),
		"icalendar",
	);
	if (Option.isNone(treeOpt)) {
		return;
	}
	// No scheduleTag argument → the Schedule-Tag is preserved.
	yield* updateExistingSor(
		deps,
		sorOpt.value.instance,
		applyReplyToSor(
			treeOpt.value,
			new Map(
				replyAttendees.map((a) => [a.calAddress.toLowerCase(), a.partstat]),
			),
		),
	);
});

/**
 * CANCEL (RFC 6638 §4.1): mark the recipient's SOR cancelled. A cancellation is
 * consequential, so the Schedule-Tag changes.
 */
const autoApplyCancel = Effect.fn("SchedulingService.autoApplyCancel")(
	function* (
		deps: SchedulingDeps,
		recipientPrincipalId: PrincipalId,
		uid: string,
	) {
		const sorOpt = yield* deps.repo.findSorByUid(recipientPrincipalId, uid);
		if (Option.isNone(sorOpt)) {
			return;
		}
		const treeOpt = yield* deps.componentRepo.loadTree(
			EntityId(sorOpt.value.instance.entityId),
			"icalendar",
		);
		if (Option.isNone(treeOpt)) {
			return;
		}
		yield* updateExistingSor(
			deps,
			sorOpt.value.instance,
			setStatusCancelled(treeOpt.value),
			crypto.randomUUID(),
		);
	},
);

/**
 * Automatically process a delivered message onto the recipient's calendars
 * (RFC 6638 §4). Best-effort: a failure here must not undo the Inbox delivery,
 * so every path is wrapped in Effect.ignore. The placed/updated copies are real
 * scheduling object resources (METHOD stripped, Schedule-Tag assigned), so
 * clients can read the tag back (RFC 6638 §3.2.10, §8.2).
 */
const autoApply = Effect.fn("SchedulingService.autoApply")(function* (
	deps: SchedulingDeps,
	recipientPrincipalId: PrincipalId,
	itipDoc: IrDocument,
	uid: string,
) {
	const method = getMethod(itipDoc);
	if (method === "REQUEST") {
		yield* Effect.ignore(
			autoApplyRequest(deps, recipientPrincipalId, itipDoc, uid),
		);
		return;
	}
	if (method === "REPLY") {
		yield* Effect.ignore(
			autoApplyReply(deps, recipientPrincipalId, itipDoc, uid),
		);
		return;
	}
	if (method === "CANCEL") {
		yield* Effect.ignore(autoApplyCancel(deps, recipientPrincipalId, uid));
	}
});

/** Deliver an iTIP doc to a principal's inbox, then auto-process it */
export const deliverToInbox = Effect.fn("SchedulingService.deliverToInbox")(
	function* (
		deps: SchedulingDeps,
		recipientPrincipalId: PrincipalId,
		itipDoc: IrDocument,
		uid: string,
	) {
		const inboxOpt = yield* deps.repo.findInbox(recipientPrincipalId);
		if (Option.isNone(inboxOpt)) {
			yield* Effect.logWarning("scheduling.deliverToInbox: no inbox found", {
				recipientPrincipalId,
			});
			return false;
		}
		const inboxId = CollectionId(inboxOpt.value.id);

		// Check schedule-deliver-invite privilege (best-effort — don't block)
		yield* Effect.ignore(
			deps.aclSvc.check(
				recipientPrincipalId,
				inboxId,
				"collection",
				"CALDAV:schedule-deliver-invite",
			),
		);

		// The Inbox copy is the iTIP message itself — it keeps its METHOD as the
		// indicator that a scheduling operation occurred (RFC 6638 §4).
		yield* persistItipToCollection(deps, {
			collectionId: inboxId,
			itipDoc,
			uid,
		});
		yield* autoApply(deps, recipientPrincipalId, itipDoc, uid);
		return true;
	},
);
