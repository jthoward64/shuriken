import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import {
	DEFAULT_REGION,
	REGION_OPTIONS,
} from "#src/http/ui/helpers/regions.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/service.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/cleanup?addressbook=<id>&region=<XX>
//
// Scans the selected addressbook for messy contact data and lists each problem
// as an individual Fix / Ignore suggestion. Region drives phone parsing and can
// be changed from the page (re-scans on submit).
// ---------------------------------------------------------------------------

export const contactsCleanupHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CollectionRepository
	| ContactCleanupService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;
		const acl = yield* AclService;
		const cleanup = yield* ContactCleanupService;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const addressbooks = all.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);

		const params = ctx.url.searchParams;
		const requestedId = params.get("addressbook") ?? "";
		const selected: CollectionRow | undefined =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];

		const requestedRegion = params.get("region") ?? "";
		const region =
			REGION_OPTIONS.find((r) => r.code === requestedRegion)?.code ??
			DEFAULT_REGION;

		let suggestions: ReadonlyArray<{
			readonly id: string;
			readonly instanceId: string;
			readonly contactFn: string;
			readonly category: string;
			readonly title: string;
			readonly description: string;
			readonly current: string;
			readonly proposed: string;
			readonly fix: unknown;
			readonly needsAreaCode: boolean;
			readonly needsLabel: boolean;
			readonly labelOptions: ReadonlyArray<string>;
			readonly region: string;
		}> = [];

		if (selected) {
			yield* acl.check(
				principal.principalId,
				CollectionId(selected.id),
				"collection",
				"DAV:read",
			);
			const found = yield* cleanup.scan(CollectionId(selected.id), region);
			suggestions = found.map((s) => ({
				id: s.id,
				instanceId: s.instanceId,
				contactFn: s.contactFn,
				category: s.category,
				title: s.title,
				description: s.description,
				current: s.current,
				proposed: s.proposed,
				fix: s.fix,
				needsAreaCode: s.needsInput === "areaCode",
				needsLabel: s.needsInput === "label",
				labelOptions: s.labelOptions ?? [],
				region,
			}));
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/contacts/cleanup",
			{
				...nav,
				pageTitle: "Clean up contacts",
				selectedId: selected?.id ?? "",
				hasAddressbook: selected !== undefined,
				addressbooks: addressbooks.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
				})),
				regions: REGION_OPTIONS.map((r) => ({
					code: r.code,
					name: r.name,
					selected: r.code === region,
				})),
				suggestions,
				suggestionCount: suggestions.length,
			},
			ctx.headers,
		);
	});
