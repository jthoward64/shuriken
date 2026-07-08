import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { parseVtodoToForm } from "#src/services/task-edit/parse-vtodo.ts";
import { TaskEditService } from "#src/services/task-edit/service.ts";
import type { TaskFormData } from "#src/services/task-edit/types.ts";
import { emptyTaskForm } from "#src/services/task-edit/types.ts";

// ---------------------------------------------------------------------------
// Shared form parser for create/update — same shape as event-write.ts's
// parseEventForm, with task-specific fields swapped in.
// ---------------------------------------------------------------------------

interface FormLike {
	get(key: string): unknown;
}

const single = (form: FormLike, key: string) =>
	(form.get(key)?.toString() ?? "").trim();

const parseTaskForm = (form: FormLike): TaskFormData => ({
	...emptyTaskForm,
	summary: single(form, "summary"),
	description: single(form, "description"),
	location: single(form, "location"),
	categoriesCsv: single(form, "categoriesCsv"),
	allDay: form.get("allDay") === "on" || form.get("allDay") === "true",
	start: single(form, "start"),
	due: single(form, "due"),
	status: single(form, "status") as TaskFormData["status"],
	priority: single(form, "priority"),
	// A task marked COMPLETED is 100% done regardless of what the form field
	// says — avoids a stale/blank percent-complete on a completed task.
	percentComplete:
		single(form, "status") === "COMPLETED"
			? "100"
			: single(form, "percentComplete"),
	recurrenceFreq: single(
		form,
		"recurrenceFreq",
	) as TaskFormData["recurrenceFreq"],
	recurrenceCount: single(form, "recurrenceCount"),
	recurrenceUntil: single(form, "recurrenceUntil"),
});

const respondAfterWrite = (
	ctx: HttpRequestContext,
	collectionId: string,
): Response => {
	if (isHtmxRequest(ctx.headers)) {
		return new Response(null, {
			status: 200,
			headers: { "HX-Trigger": "shuriken:tasks-refresh" },
		});
	}
	return new Response(null, {
		status: 303,
		headers: { Location: `/ui/tasks?calendar=${collectionId}` },
	});
};

// ---------------------------------------------------------------------------
// POST /ui/api/tasks/:collectionId/tasks/create
// ---------------------------------------------------------------------------

export const taskCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | TaskEditService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const taskEdit = yield* TaskEditService;

		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:bind",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});
		yield* taskEdit.create(collectionId, parseTaskForm(form));

		return respondAfterWrite(ctx, collectionId);
	});

// ---------------------------------------------------------------------------
// POST /ui/api/tasks/:collectionId/tasks/:instanceId/update
// ---------------------------------------------------------------------------

export const taskUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | InstanceService | TaskEditService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const taskEdit = yield* TaskEditService;
		const instanceSvc = yield* InstanceService;

		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:write-content",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});
		yield* taskEdit.update(instanceId, parseTaskForm(form));

		return respondAfterWrite(ctx, existing.collectionId);
	});

// ---------------------------------------------------------------------------
// POST /ui/api/tasks/:collectionId/tasks/:instanceId/delete
// ---------------------------------------------------------------------------

export const taskDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | InstanceService | TaskEditService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const taskEdit = yield* TaskEditService;
		const instanceSvc = yield* InstanceService;

		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:unbind",
		);
		yield* taskEdit.delete(instanceId);
		return respondAfterWrite(ctx, existing.collectionId);
	});

// ---------------------------------------------------------------------------
// POST /ui/api/tasks/:collectionId/tasks/:instanceId/toggle
//
// Flips COMPLETED <-> NEEDS-ACTION from the list checkbox — a one-click
// action that doesn't require opening the full edit form.
// ---------------------------------------------------------------------------

export const taskToggleHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ComponentRepository | InstanceService | TaskEditService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const taskEdit = yield* TaskEditService;
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:write-content",
		);

		const tree = yield* componentRepo.loadTree(
			EntityId(existing.entityId),
			"icalendar",
		);
		const vtodo =
			tree._tag === "Some"
				? (tree.value.components.find((c) => c.name === "VTODO") ?? null)
				: null;
		const form = vtodo ? parseVtodoToForm(vtodo) : emptyTaskForm;
		const completed = form.status === "COMPLETED";

		yield* taskEdit.update(instanceId, {
			...form,
			status: completed ? "NEEDS-ACTION" : "COMPLETED",
			percentComplete: completed ? "" : "100",
		});

		return respondAfterWrite(ctx, existing.collectionId);
	});
