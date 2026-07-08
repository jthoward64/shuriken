import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_BAD_REQUEST } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { TaskFormPage } from "#src/http/ui/view/pages/tasks/form.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { emptyTaskForm } from "#src/services/task-edit/types.ts";

// ---------------------------------------------------------------------------
// GET /ui/tasks/new?calendar=<id>
// ---------------------------------------------------------------------------

export const tasksNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const calendars = all.filter(
			(c) => c.collectionType === "calendar" && c.deletedAt === null,
		);
		const requestedId = ctx.url.searchParams.get("calendar") ?? "";
		const selected =
			calendars.find((c) => c.id === requestedId) ?? calendars[0];
		if (!selected) {
			return new Response("No calendar available", {
				status: HTTP_BAD_REQUEST,
			});
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			<TaskFormPage
				mode="new"
				title="New task"
				form={emptyTaskForm}
				action={`/ui/api/tasks/${selected.id}/tasks/create`}
				backHref={`/ui/tasks?calendar=${selected.id}`}
			/>,
			{ headers: ctx.headers, title: "New task", nav },
		);
	});
