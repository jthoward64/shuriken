import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	RELATION_NAME_FIELD,
	RelationOptions,
} from "#src/http/ui/view/pages/contacts/relations.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/relation-options?addressbook=<uuid>&q=<text>&row=<id>
//
// Suggestion list backing the relation rows' type-ahead: the <datalist> options
// for contacts in the addressbook being edited whose FN matches `q`. Each option
// carries the contact's UID so the client can store a `urn:uuid:` reference
// rather than the display name.
//
// Enhancement only — the value input is an ordinary text box, so with no JS the
// user types a name and it is stored as free text.
// ---------------------------------------------------------------------------

const SUGGESTION_LIMIT = 10;

export const contactsRelationOptionsHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	addressbookId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CardIndexRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardIndex = yield* CardIndexRepository;

		yield* acl.check(
			principal.principalId,
			addressbookId,
			"collection",
			"DAV:read",
		);

		// htmx sends the requesting input's own name; `q` is the explicit form for
		// anything calling this endpoint directly.
		const query = (
			ctx.url.searchParams.get(RELATION_NAME_FIELD) ??
			ctx.url.searchParams.get("q") ??
			""
		).trim();
		const listId = ctx.url.searchParams.get("list") ?? "";
		// A blank query would list the whole addressbook; the type-ahead only
		// starts suggesting once there is something to match on.
		const rows =
			query === ""
				? []
				: yield* cardIndex.listForCollection(addressbookId, query, {
						limit: SUGGESTION_LIMIT,
						offset: 0,
					});

		return yield* renderFragment(
			<RelationOptions
				listId={listId}
				options={rows.flatMap((r) =>
					r.uid === null || r.fn === null || r.fn === ""
						? []
						: [{ uid: r.uid, fn: r.fn, org: r.org ?? "" }],
				)}
			/>,
		);
	});
