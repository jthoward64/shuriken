import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	type SearchPickerItem,
	searchPickerResponse,
} from "#src/http/ui/helpers/search-picker.ts";

// ---------------------------------------------------------------------------
// GET /ui/api/dev/components/search - feeds the gallery's SearchPicker.
//
// Static demo data on purpose: the gallery demonstrates the control and its
// wire contract, and pointing it at a real directory would turn a dev page
// into a people-search endpoint with none of the access checks the real
// principal search applies.
// ---------------------------------------------------------------------------

const LIMIT = 8;

const DEMO_PEOPLE: ReadonlyArray<SearchPickerItem> = [
	{ value: "ada", label: "Ada Lovelace", description: "ada@example.com" },
	{ value: "alan", label: "Alan Turing", description: "alan@example.com" },
	{ value: "anita", label: "Anita Borg", description: "anita@example.com" },
	{
		value: "barbara",
		label: "Barbara Liskov",
		description: "barbara@example.com",
	},
	{
		value: "edsger",
		label: "Edsger Dijkstra",
		description: "edsger@example.com",
	},
	{ value: "grace", label: "Grace Hopper", description: "grace@example.com" },
	{
		value: "katherine",
		label: "Katherine Johnson",
		description: "katherine@example.com",
	},
	{ value: "radia", label: "Radia Perlman", description: "radia@example.com" },
	{ value: "robert", label: "Robert Kahn", description: "robert@example.com" },
	{ value: "engineering", label: "Engineering", description: "Group of 12" },
	{ value: "support", label: "Support", description: "Group of 5" },
];

export const componentSearchHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, DavError> =>
	Effect.gen(function* () {
		yield* requireAuthenticated(ctx.auth);

		const query = (new URL(req.url).searchParams.get("q") ?? "")
			.trim()
			.toLowerCase();
		if (query === "") {
			return searchPickerResponse([]);
		}
		const matches = DEMO_PEOPLE.filter(
			(p) =>
				p.label.toLowerCase().includes(query) ||
				p.value.includes(query) ||
				(p.description ?? "").toLowerCase().includes(query),
		);
		return searchPickerResponse(
			matches.slice(0, LIMIT),
			matches.length > LIMIT,
		);
	});
