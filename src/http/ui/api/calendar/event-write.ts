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
import { CalEditService } from "#src/services/cal-edit/service.ts";
import type { EventFormData } from "#src/services/cal-edit/types.ts";
import { emptyEventForm } from "#src/services/cal-edit/types.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { extractAttendeeAddresses } from "#src/services/imip/build-message.ts";
import type { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import { fireAndForgetDispatch } from "#src/services/imip/event-hook.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import type { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// Shared form parser for both create and update — event payload is small
// enough to inline here rather than a separate helper module.
// ---------------------------------------------------------------------------

interface FormLike {
	get(key: string): unknown;
}

const single = (form: FormLike, key: string) =>
	(form.get(key)?.toString() ?? "").trim();

const parseEventForm = (form: FormLike): EventFormData => ({
	...emptyEventForm,
	summary: single(form, "summary"),
	description: single(form, "description"),
	location: single(form, "location"),
	categoriesCsv: single(form, "categoriesCsv"),
	allDay: form.get("allDay") === "on" || form.get("allDay") === "true",
	start: single(form, "start"),
	end: single(form, "end"),
	recurrenceFreq: single(
		form,
		"recurrenceFreq",
	) as EventFormData["recurrenceFreq"],
	recurrenceCount: single(form, "recurrenceCount"),
	recurrenceUntil: single(form, "recurrenceUntil"),
	attendees: single(form, "attendeesCsv")
		.split(/[\n,]/)
		.map((s) => s.trim())
		.filter((s) => s !== ""),
	organizer: single(form, "organizer"),
});

const respondAfterWrite = (
	ctx: HttpRequestContext,
	collectionId: string,
): Response => {
	// HTMX = a popover submit: don't navigate. Emit the refresh trigger the
	// calendar script listens for — it closes the popover and refetches events
	// (or reloads if the interactive calendar isn't loaded). The forms use
	// hx-swap="none", so the empty body is never swapped in.
	if (isHtmxRequest(ctx.headers)) {
		return new Response(null, {
			status: 200,
			headers: { "HX-Trigger": "shuriken:calendar-refresh" },
		});
	}
	// No-JS: full navigation back to the calendar (the POST redirects, so the
	// page reloads with the change applied).
	return new Response(null, {
		status: 303,
		headers: { Location: `/ui/calendar?collection=${collectionId}` },
	});
};

// ---------------------------------------------------------------------------
// POST /ui/api/calendar/:collectionId/events/create
// ---------------------------------------------------------------------------

export const eventCreateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| CalEditService
	| ComponentRepository
	| ImipDispatchService
	| InstanceService
	| UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const calEdit = yield* CalEditService;

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
		const created = yield* calEdit.create(collectionId, parseEventForm(form));
		yield* fireAndForgetDispatch(
			"REQUEST",
			created.instanceId,
			principal.userId,
		);

		return respondAfterWrite(ctx, collectionId);
	});

// ---------------------------------------------------------------------------
// POST /ui/api/calendar/:collectionId/events/:instanceId/update
// ---------------------------------------------------------------------------

export const eventUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| CalEditService
	| ComponentRepository
	| ImipDispatchService
	| InstanceService
	| UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const calEdit = yield* CalEditService;
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

		// Capture the pre-edit attendee set so we can fire CANCEL to any
		// addresses dropped by the new form. Without this, removed
		// attendees would keep the meeting on their calendar.
		const componentRepo = yield* ComponentRepository;
		const preTree = yield* componentRepo.loadTree(
			EntityId(existing.entityId),
			"icalendar",
		);
		const preAttendees: ReadonlyArray<string> =
			preTree._tag === "Some"
				? extractAttendeeAddresses(
						preTree.value.components.find((c) => c.name === "VEVENT") ?? {
							name: "VEVENT",
							properties: [],
							components: [],
						},
					)
				: [];

		const parsed = parseEventForm(form);
		yield* calEdit.update(instanceId, parsed);

		const lowerSet = new Set(
			parsed.attendees.map((a) => a.toLowerCase().trim()),
		);
		const removed = preAttendees.filter((a) => !lowerSet.has(a.toLowerCase()));

		yield* fireAndForgetDispatch("REQUEST", instanceId, principal.userId);
		if (removed.length > 0) {
			yield* fireAndForgetDispatch(
				"CANCEL",
				instanceId,
				principal.userId,
				removed,
			);
		}

		return respondAfterWrite(ctx, existing.collectionId);
	});

// ---------------------------------------------------------------------------
// POST /ui/api/calendar/:collectionId/events/:instanceId/delete
// ---------------------------------------------------------------------------

export const eventDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| CalEditService
	| ComponentRepository
	| ImipDispatchService
	| InstanceService
	| UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const calEdit = yield* CalEditService;
		const instanceSvc = yield* InstanceService;

		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:unbind",
		);
		// Fire CANCEL *before* the delete so the IR tree is still readable
		// when the dispatcher loads it on its forked fiber.
		yield* fireAndForgetDispatch("CANCEL", instanceId, principal.userId);
		yield* calEdit.delete(instanceId);
		return respondAfterWrite(ctx, existing.collectionId);
	});
