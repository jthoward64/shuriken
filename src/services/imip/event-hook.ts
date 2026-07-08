import { Effect, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { EntityId, type InstanceId, type UserId } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
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

export const dispatchForInstance = (
	method: ImipMethod,
	instanceId: InstanceId,
	organizerUserId: UserId,
	onlyRecipients?: ReadonlyArray<string>,
): Effect.Effect<
	void,
	DavError | DatabaseError | InternalError,
	ComponentRepository | ImipDispatchService | InstanceService | UserService
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

		const { user, principal } = yield* userSvc.findById(organizerUserId);
		const outcome = yield* dispatch.dispatch({
			method,
			vevent,
			organizerUserId,
			organizerEmail: user.email,
			organizerDisplayName: principal.displayName,
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
