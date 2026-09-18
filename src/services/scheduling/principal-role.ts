// ---------------------------------------------------------------------------
// Resolving the acting principal's cal-address and scheduling role
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { SchedulingDeps } from "./deps.ts";

/** The acting principal's own cal-address ("mailto:<email>"), if the principal exists */
export const actingCalAddress = Effect.fn("SchedulingService.actingCalAddress")(
	function* (deps: SchedulingDeps, principalId: PrincipalId) {
		const pwuOpt = yield* deps.principalRepo.findById(principalId);
		return Option.map(pwuOpt, (pwu) => `mailto:${pwu.user.email}`);
	},
);

/** Whether the acting principal is the event's organizer, an attendee, or unrelated */
export const determineRole = Effect.fn("SchedulingService.determineRole")(
	function* (
		deps: SchedulingDeps,
		principalId: PrincipalId,
		organizerCalAddress: string,
	) {
		const addrOpt = yield* actingCalAddress(deps, principalId);
		return Option.match(addrOpt, {
			onNone: () => "unrelated" as const,
			onSome: (addr) =>
				addr.toLowerCase() === organizerCalAddress.toLowerCase()
					? ("organizer" as const)
					: ("attendee" as const),
		});
	},
);
