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
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
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
	| AclService
	| AppConfigService
	| ComponentRepository
	| InstanceService
	| TemplateService
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

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			"pages/calendar/event-form",
			{
				...nav,
				pageTitle: form.summary || "Event",
				mode: "edit",
				instanceId,
				collectionId: instance.collectionId,
				form,
				action: `/ui/api/calendar/${instance.collectionId}/events/${instanceId}/update`,
				deleteAction: `/ui/api/calendar/${instance.collectionId}/events/${instanceId}/delete`,
				backHref: `/ui/calendar?collection=${instance.collectionId}`,
			},
			ctx.headers,
		);
	});
