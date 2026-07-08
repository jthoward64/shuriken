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
import { TaskFormPage } from "#src/http/ui/view/pages/tasks/form.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { parseVtodoToForm } from "#src/services/task-edit/parse-vtodo.ts";

// ---------------------------------------------------------------------------
// GET /ui/tasks/:instanceId
// ---------------------------------------------------------------------------

export const taskEditHandler = (
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
			return yield* Effect.fail(notFound("Task not found"));
		}
		const vtodo = tree.value.components.find((c) => c.name === "VTODO");
		if (!vtodo) {
			return yield* Effect.fail(notFound("Task not found"));
		}
		const form = parseVtodoToForm(vtodo);
		const title = form.summary || "Task";
		const action = `/ui/api/tasks/${instance.collectionId}/tasks/${instanceId}/update`;
		const deleteAction = `/ui/api/tasks/${instance.collectionId}/tasks/${instanceId}/delete`;

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			<TaskFormPage
				mode="edit"
				title={title}
				form={form}
				action={action}
				deleteAction={deleteAction}
				backHref={`/ui/tasks?calendar=${instance.collectionId}`}
			/>,
			{ headers: ctx.headers, title, nav },
		);
	});
