import { Effect, Option } from "effect";
import { resolveCalendarZone } from "#src/data/icalendar/calendar-zone.ts";
import { decodeICalendar } from "#src/data/icalendar/codec.ts";
import type { ResolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import { UTC } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	EntityId,
	type InstanceId,
	type UserId,
} from "#src/domain/ids.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import { UserService } from "#src/services/user/index.ts";
import type { ImipMethod } from "./build-message.ts";
import { ImipDispatchService } from "./dispatch.ts";

// ---------------------------------------------------------------------------
// dispatchForInstance — fire iMIP REQUEST/CANCEL for the VEVENT carried by
// the given dav_instance, addressed by the given organizer (typically the
// caller of the surrounding edit handler). All look-ups are best-effort —
// a missing instance, missing tree, missing user, or zero attendees all
// result in a no-op.
//
// Designed to be Effect.fork'd from event-write handlers so the response
// returns immediately while delivery happens in the background.
// ---------------------------------------------------------------------------

/**
 * VTIMEZONE component for a resolution zone, absent when none is needed or
 * available. UTC is self-describing, and a zone the library cannot render is
 * not worth failing an invitation over - the anchored values still carry a
 * TZID the recipient's own tz database can resolve.
 */
const resolveVtimezoneComponent = (
	zone: ResolutionZone,
): Effect.Effect<Option.Option<IrComponent>, never, IanaTimezoneService> =>
	Effect.gen(function* () {
		if (zone === UTC) {
			return Option.none();
		}
		const iana = yield* IanaTimezoneService;
		const text = iana.getVtimezone(zone);
		if (Option.isNone(text)) {
			return Option.none();
		}
		const docOpt = yield* decodeICalendar(text.value).pipe(
			Effect.map(Option.some),
			Effect.catchCause(() => Effect.succeed(Option.none<IrDocument>())),
		);
		return Option.flatMap(docOpt, (doc) =>
			doc.kind === "icalendar"
				? Option.fromNullishOr(
						doc.root.components.find((c) => c.name === "VTIMEZONE"),
					)
				: Option.none(),
		);
	});

export const dispatchForInstance = (
	method: ImipMethod,
	instanceId: InstanceId,
	organizerUserId: UserId,
	onlyRecipients?: ReadonlyArray<string>,
): Effect.Effect<
	void,
	DavError | DatabaseError | InternalError,
	| ComponentRepository
	| ImipDispatchService
	| InstanceService
	| UserService
	| CollectionRepository
	| IanaTimezoneService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;
		const userSvc = yield* UserService;
		const dispatch = yield* ImipDispatchService;

		const instance = yield* instanceSvc.findById(instanceId);
		const tree = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"icalendar",
		);
		if (Option.isNone(tree)) {
			return;
		}
		const vevent: IrComponent | undefined = tree.value.components.find(
			(c) => c.name === "VEVENT",
		);
		if (!vevent) {
			return;
		}
		// onlyRecipients=[] means "no targeted recipients" — skip entirely.
		// (Distinguished from undefined, which means "use the VEVENT's
		// ATTENDEE list".)
		if (onlyRecipients !== undefined && onlyRecipients.length === 0) {
			return;
		}

		// An invitation must name one instant, so floating times are anchored to
		// the organizing calendar's zone (falling back to UTC) before they leave
		// the server. See services/imip/build-message.ts.
		const collRepo = yield* CollectionRepository;
		const collOpt = yield* collRepo.findById(
			CollectionId(instance.collectionId),
		);
		const zone = resolveCalendarZone({
			collectionTzid: Option.getOrUndefined(collOpt)?.timezoneTzid,
		});
		const vtimezoneOpt = yield* resolveVtimezoneComponent(zone);

		const { user, principal } = yield* userSvc.findById(organizerUserId);
		const outcome = yield* dispatch.dispatch({
			method,
			vevent,
			organizerUserId,
			organizerEmail: user.email,
			organizerDisplayName: principal.displayName,
			zone,
			vtimezone: Option.getOrNull(vtimezoneOpt),
			...(onlyRecipients !== undefined ? { onlyRecipients } : {}),
		});
		yield* Effect.logDebug("imip.dispatch result", { outcome, instanceId });
	});

/**
 * Convenience wrapper to forget errors so callers can `Effect.fork` the
 * dispatch without worrying about background failures bubbling up.
 */
export const fireAndForgetDispatch = (
	method: ImipMethod,
	instanceId: InstanceId,
	organizerUserId: UserId,
	onlyRecipients?: ReadonlyArray<string>,
) =>
	dispatchForInstance(method, instanceId, organizerUserId, onlyRecipients).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("imip.fireAndForgetDispatch failed", { cause }),
		),
		Effect.forkDetach,
		Effect.asVoid,
	);
