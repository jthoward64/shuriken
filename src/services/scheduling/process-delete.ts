// ---------------------------------------------------------------------------
// processAfterDelete - CANCEL (organizer) or REPLY DECLINED (attendee)
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import { PrincipalId } from "#src/domain/ids.ts";
import { deliverToInbox } from "./auto-apply.ts";
import type { SchedulingDeps } from "./deps.ts";
import {
	buildItipCancel,
	buildItipReply,
	patchPartstat,
} from "./itip-build.ts";
import {
	extractAttendees,
	extractOrganizerCalAddress,
	extractSorUid,
	isSor,
} from "./itip-extract.ts";
import { actingCalAddress, determineRole } from "./principal-role.ts";

/** Organizer DELETE: CANCEL the event for every on-server attendee */
const cancelForAttendees = Effect.fn("SchedulingService.cancelForAttendees")(
	function* (deps: SchedulingDeps, doc: IrDocument, uid: string) {
		const cancelDoc = buildItipCancel(doc);
		const serverAttendees = extractAttendees(doc).filter(
			(a) => a.scheduleAgent === "SERVER",
		);
		for (const attendee of serverAttendees) {
			const recipientOpt = yield* deps.repo.findPrincipalByCalAddress(
				attendee.calAddress,
			);
			if (Option.isSome(recipientOpt)) {
				yield* Effect.ignore(
					deliverToInbox(
						deps,
						PrincipalId(recipientOpt.value.principal.id),
						cancelDoc,
						uid,
					),
				);
			}
		}
	},
);

/** The acting principal and the resource a DELETE-time REPLY is built from */
interface DeclineContext {
	readonly actingPrincipalId: PrincipalId;
	readonly doc: IrDocument;
	readonly organizerCalAddress: string;
	readonly uid: string;
}

/** Attendee DELETE with RSVP=TRUE: REPLY DECLINED to the organizer */
const declineForAttendee = Effect.fn("SchedulingService.declineForAttendee")(
	function* (deps: SchedulingDeps, ctx: DeclineContext) {
		const myAddrOpt = yield* actingCalAddress(deps, ctx.actingPrincipalId);
		if (Option.isNone(myAddrOpt)) {
			return;
		}
		const myAddr = myAddrOpt.value;
		const attendeeInfo = extractAttendees(ctx.doc).find(
			(a) => a.calAddress.toLowerCase() === myAddr.toLowerCase(),
		);
		if (!attendeeInfo?.rsvp) {
			return;
		}
		const organizerOpt = yield* deps.repo.findPrincipalByCalAddress(
			ctx.organizerCalAddress,
		);
		if (Option.isSome(organizerOpt)) {
			yield* Effect.ignore(
				deliverToInbox(
					deps,
					PrincipalId(organizerOpt.value.principal.id),
					buildItipReply(patchPartstat(ctx.doc, "DECLINED"), myAddr),
					ctx.uid,
				),
			);
		}
	},
);

export const processAfterDelete = Effect.fn(
	"SchedulingService.processAfterDelete",
)(function* (
	deps: SchedulingDeps,
	opts: {
		actingPrincipalId: PrincipalId;
		doc: IrDocument;
		suppressReply: boolean;
	},
) {
	yield* Effect.annotateCurrentSpan({
		"scheduling.principal_id": opts.actingPrincipalId,
		"scheduling.is_sor": isSor(opts.doc),
	});
	yield* Effect.logTrace("scheduling.processAfterDelete", {
		actingPrincipalId: opts.actingPrincipalId,
		suppressReply: opts.suppressReply,
	});

	if (!isSor(opts.doc)) {
		return;
	}
	const organizerCalAddress = extractOrganizerCalAddress(opts.doc);
	const uid = extractSorUid(opts.doc);
	if (!(organizerCalAddress && uid)) {
		return;
	}

	const role = yield* determineRole(
		deps,
		opts.actingPrincipalId,
		organizerCalAddress,
	);
	if (role === "organizer") {
		yield* cancelForAttendees(deps, opts.doc, uid);
	} else if (role === "attendee" && !opts.suppressReply) {
		yield* declineForAttendee(deps, {
			actingPrincipalId: opts.actingPrincipalId,
			doc: opts.doc,
			organizerCalAddress,
			uid,
		});
	}
});
