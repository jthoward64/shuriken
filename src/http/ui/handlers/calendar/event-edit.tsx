import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	type DatabaseError,
	type DavError,
	type InternalError,
	notFound,
} from "#src/domain/errors.ts";
import { EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { EventFormPage } from "#src/http/ui/view/pages/calendar/event-form.tsx";
import { EventEditPopoverForm } from "#src/http/ui/view/pages/calendar/event-popovers.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/calendar/:collectionId/events/:instanceId
// ---------------------------------------------------------------------------

export const eventEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const instance = yield* instanceSvc.findById(instanceId);
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
		const form = parseVeventToForm(vevent);
		const title = form.summary || "Event";
		const action = `/ui/api/calendar/${instance.collectionId}/events/${instanceId}/update`;
		const deleteAction = `/ui/api/calendar/${instance.collectionId}/events/${instanceId}/delete`;

		// HTMX (the calendar page loading the edit popover) gets just the form
		// fragment; a normal navigation gets the full standalone page (the no-JS
		// edit path). Same fields either way — see EventFormBody.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<EventEditPopoverForm
					title={title}
					form={form}
					action={action}
					deleteAction={deleteAction}
				/>,
			);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			<EventFormPage
				mode="edit"
				title={title}
				form={form}
				action={action}
				deleteAction={deleteAction}
				backHref={`/ui/calendar?collection=${instance.collectionId}`}
			/>,
			{ headers: ctx.headers, title, nav },
		);
	});
