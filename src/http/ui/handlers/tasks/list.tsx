import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	collectTasks,
	type TaskView,
} from "#src/http/ui/api/tasks/collect-tasks.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import type { UiPageOpts } from "#src/http/ui/helpers/page-opts.ts";
import { listOwnedAndShared } from "#src/http/ui/helpers/shared-collections.ts";
import {
	parseFloatingInstant,
	parsePlainDate,
	parsePlainDateTime,
} from "#src/http/ui/helpers/temporal-parse.ts";
import {
	notModifiedPageResponse,
	PageCacheService,
	pageEtag,
	withPageCacheHeaders,
} from "#src/http/ui/page-cache/index.ts";
import {
	type TaskRow,
	TasksListPage,
} from "#src/http/ui/view/pages/tasks/list.tsx";
import { renderPage } from "#src/http/ui/view/shell/render.tsx";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AclService } from "#src/services/acl/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/tasks?calendar=<id>&completed=<0|1>&page=<n>
// ---------------------------------------------------------------------------

const DECIMAL = 10;

const PAGE_SIZE = 50;

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const STATUS_LABELS: Record<string, string> = {
	"": "Needs action",
	"NEEDS-ACTION": "Needs action",
	"IN-PROCESS": "In process",
	COMPLETED: "Completed",
	CANCELLED: "Cancelled",
};

// The due date as an instant; due dates are stored floating and read as UTC here
const dueInstant = (task: TaskView): Option.Option<Temporal.Instant> =>
	task.due === null
		? Option.none()
		: parseFloatingInstant(task.due, task.allDay, "UTC");

const pad2 = (n: number): string => String(n).padStart(2, "0");

// Human due-date label; an unparseable value falls back to the raw string
const dueLabel = (task: TaskView): string => {
	if (task.due === null) {
		return "No due date";
	}
	const raw = `Due ${task.due}`;
	if (task.allDay) {
		return Option.match(parsePlainDate(task.due), {
			onNone: () => raw,
			onSome: (d) => `Due ${MONTH_NAMES[d.month - 1]} ${d.day}, ${d.year}`,
		});
	}
	return Option.match(parsePlainDateTime(task.due), {
		onNone: () => raw,
		onSome: (dt) =>
			`Due ${MONTH_NAMES[dt.month - 1]} ${dt.day}, ${dt.year} ${pad2(dt.hour)}:${pad2(dt.minute)}`,
	});
};

const priorityLabel = (priority: number | null): Option.Option<string> => {
	if (priority === null) {
		return Option.none();
	}
	if (priority === 0) {
		return Option.some("None");
	}
	const highMax = 4;
	const mediumMax = 5;
	if (priority <= highMax) {
		return Option.some(`High (${priority})`);
	}
	if (priority === mediumMax) {
		return Option.some(`Medium (${priority})`);
	}
	return Option.some(`Low (${priority})`);
};

const toRow = (task: TaskView, now: Temporal.Instant): TaskRow => {
	const completed = task.status === "COMPLETED";
	const overdue =
		!completed &&
		Option.exists(
			dueInstant(task),
			(due) => Temporal.Instant.compare(due, now) < 0,
		);
	return {
		id: task.id,
		title: task.title,
		dueLabel: dueLabel(task),
		overdue,
		status: task.status,
		statusLabel: STATUS_LABELS[task.status] ?? task.status,
		completed,
		priorityLabel: Option.getOrNull(priorityLabel(task.priority)),
		recurring: task.recurring,
	};
};

export const tasksListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	opts: UiPageOpts = {},
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclRepository
	| AclService
	| AppConfigService
	| CalIndexRepository
	| CollectionRepository
	| ComponentRepository
	| InstanceRepository
	| PageCacheService
	| PrincipalRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;

		const withSharing = yield* listOwnedAndShared(principal, "calendar");
		const calendars = withSharing.map((c) => c.row);
		const sharingById = new Map(withSharing.map((c) => [c.row.id, c]));

		const requestedId = ctx.url.searchParams.get("calendar") ?? "";
		const selected =
			calendars.find((c) => c.id === requestedId) ?? calendars[0];
		const selectedWritable = selected
			? (sharingById.get(selected.id)?.writable ?? true)
			: true;

		const showCompleted = ctx.url.searchParams.get("completed") === "1";

		// Conditional GET — skip collectTasks (a full, unpaginated per-collection
		// listing) below entirely when nothing the render depends on changed
		// since the client's cached copy. `overdue`/day-rollover in the rendered
		// rows is time-dependent, not data-dependent, so the current UTC day is
		// folded in too — coarse enough to avoid invalidating every request, but
		// still catches a task tipping over into "overdue" at midnight.
		const pageCache = yield* PageCacheService;
		const etag = yield* pageEtag(pageCache.startupToken, {
			page: "tasks",
			principal: principal.principalId,
			fragment: isHtmxRequest(ctx.headers),
			chrome: opts.chrome ?? "full",
			calendar: requestedId,
			showCompleted,
			pageParam: ctx.url.searchParams.get("page"),
			today: Temporal.Now.plainDateISO("UTC").toString(),
			collections: withSharing.map((c) => [
				c.row.id,
				c.row.synctoken,
				c.row.updatedAt?.toString() ?? null,
				c.row.sortOrder,
				c.writable,
			]),
		});
		const notModified = notModifiedPageResponse(ctx.headers, etag);
		if (notModified !== undefined) {
			return notModified;
		}

		let rows: ReadonlyArray<TaskRow> = [];
		let totalPages = 1;
		let page = 1;
		if (selected) {
			const now = Temporal.Now.instant();
			const all = yield* collectTasks(CollectionId(selected.id));
			const filtered = (
				showCompleted ? all : all.filter((t) => t.status !== "COMPLETED")
			)
				.map((t) => toRow(t, now))
				.sort((a, b) => {
					if (a.completed !== b.completed) {
						return a.completed ? 1 : -1;
					}
					return a.dueLabel.localeCompare(b.dueLabel);
				});

			totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
			const requestedPage = Number.parseInt(
				ctx.url.searchParams.get("page") ?? "",
				DECIMAL,
			);
			page = Number.isFinite(requestedPage)
				? Math.min(Math.max(requestedPage, 1), totalPages)
				: 1;
			rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const response = yield* renderPage(
			<TasksListPage
				calendars={calendars.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
					ownerSlug: sharingById.get(c.id)?.ownerSlug ?? null,
					writable: sharingById.get(c.id)?.writable ?? true,
				}))}
				selectedId={selected?.id ?? ""}
				selectedWritable={selectedWritable}
				hasCalendar={selected !== undefined}
				showCompleted={showCompleted}
				tasks={rows}
				page={page}
				totalPages={totalPages}
			/>,
			{
				headers: ctx.headers,
				title: "Tasks",
				nav,
				wide: true,
				fill: true,
				chrome: opts.chrome,
			},
		);
		return withPageCacheHeaders(response, etag);
	});
