import { Option } from "effect";
import { isUuid, type UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { UiRoute } from "#src/http/ui/routes/types.ts";

// True when this is a POST to /ui/api/<group>
export const isApiPost = (route: UiRoute, group: string): boolean =>
	route.method === "POST" &&
	route.segments[0] === "api" &&
	route.segments[1] === group;

// The addressbook a contacts route acts on, when the query string names a valid one
export const addressbookParam = (
	ctx: HttpRequestContext,
): Option.Option<UuidString> => {
	const bookId = ctx.url.searchParams.get("addressbook");
	if (bookId !== null && isUuid(bookId)) {
		return Option.some(bookId);
	}
	return Option.none();
};
