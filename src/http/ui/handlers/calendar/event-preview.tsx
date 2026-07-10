import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { notFound } from "#src/domain/errors.ts";
import { EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { EventHoverCard } from "#src/http/ui/view/pages/calendar/event-hover-card.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import type { EventFormData } from "#src/services/cal-edit/types.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/calendar/:collectionId/events/:instanceId/preview
//
// HTMX-only: the hover card fetches this on hover/click (see
// calendar.client.ts). Read-only — reuses the same fetch chain as
// eventEditHandler, just renders EventHoverCard instead of the edit form.
// ---------------------------------------------------------------------------

export const eventPreviewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;
		const acl = yield* AclService;

		// Existence + read access enforced together — see event-edit.tsx.
		const instance = yield* instanceSvc.findById(instanceId);

		// At least free-busy-only read is required; DAV:read/DAV:all also
		// satisfy this via the privilege hierarchy.
		yield* acl.check(
			principal.principalId,
			instanceId,
			"instance",
			"CALDAV:read-free-busy",
		);
		const privileges = yield* acl.currentUserPrivileges(
			principal.principalId,
			instanceId,
			"instance",
		);
		const hasFullRead = privileges.includes("DAV:read");
		const hasWrite = privileges.includes("DAV:write");

		const tree = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"icalendar",
		);
		if (Option.isNone(tree)) {
			return yield* Effect.fail(notFound("Event not found"));
		}
		const vevent = tree.value.components.find((c) => c.name === "VEVENT");
		if (!vevent) {
			return yield* Effect.fail(notFound("Event not found"));
		}
		const rawForm = parseVeventToForm(vevent);
		// Free-busy-only callers see the same "Busy" block the calendar grid
		// already shows them — never the real title/description/location/
		// attendees/organizer.
		const form: EventFormData = hasFullRead
			? rawForm
			: {
					...rawForm,
					summary: "Busy",
					description: "",
					location: "",
					attendees: [],
					organizer: "",
				};
		const editHref = `/ui/calendar/${instance.collectionId}/events/${instanceId}`;

		return yield* renderFragment(
			<EventHoverCard form={form} editHref={hasWrite ? editHref : undefined} />,
		);
	});
