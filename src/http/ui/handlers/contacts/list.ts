import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { parseVcardToForm } from "#src/services/card-edit/parse-vcard.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts?addressbook=<id>&q=<search>
// ---------------------------------------------------------------------------

interface ContactRow {
	readonly instanceId: string;
	readonly fn: string;
	readonly email: string;
	readonly tel: string;
}

export const contactsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CardIndexRepository
	| CollectionRepository
	| ComponentRepository
	| InstanceRepository
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;
		const instRepo = yield* InstanceRepository;
		const componentRepo = yield* ComponentRepository;
		const cardIndex = yield* CardIndexRepository;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const addressbooks = all.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);

		const requestedId = ctx.url.searchParams.get("addressbook") ?? "";
		const selected: CollectionRow | undefined =
			addressbooks.find((c) => c.id === requestedId) ?? addressbooks[0];

		const query = (ctx.url.searchParams.get("q") ?? "").trim();

		let contacts: ReadonlyArray<ContactRow> = [];
		if (selected) {
			let candidateInstanceIds: ReadonlyArray<string>;
			if (query !== "") {
				// CardIndex.findByText is a pre-filter — it returns instance UUIDs
				// of cards whose FN matches the substring; the in-memory pass below
				// strips false positives.
				candidateInstanceIds = yield* cardIndex.findByText(
					CollectionId(selected.id),
					query,
					"fn",
					"i;unicode-casemap",
					"contains",
				);
			} else {
				const instances = yield* instRepo.listByCollection(
					CollectionId(selected.id),
				);
				candidateInstanceIds = instances.map((i) => i.id);
			}
			const rows: Array<ContactRow> = [];
			for (const iid of candidateInstanceIds) {
				const instOpt = yield* instRepo.findById(iid as InstanceId);
				if (Option.isNone(instOpt)) {
					continue;
				}
				const tree = yield* componentRepo.loadTree(
					EntityId(instOpt.value.entityId),
					"vcard",
				);
				if (Option.isNone(tree)) {
					continue;
				}
				const fields = parseVcardToForm(tree.value);
				if (
					query !== "" &&
					!fields.fn.toLowerCase().includes(query.toLowerCase())
				) {
					continue;
				}
				rows.push({
					instanceId: iid,
					fn: fields.fn || "(no name)",
					email: fields.emails[0]?.value ?? "",
					tel: fields.tels[0]?.value ?? "",
				});
			}
			rows.sort((a, b) => a.fn.localeCompare(b.fn));
			contacts = rows;
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/contacts/list",
			{
				...nav,
				pageTitle: "Contacts",
				query,
				selectedId: selected?.id ?? "",
				addressbooks: addressbooks.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
				})),
				contacts,
				hasAddressbook: selected !== undefined,
			},
			ctx.headers,
		);
	});
