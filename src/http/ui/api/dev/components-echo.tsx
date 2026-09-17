import { Effect } from "effect";
import { type DavError, InternalError } from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { normalizeRichText } from "#src/http/ui/helpers/rich-text.ts";
import type { ComponentEchoData } from "#src/http/ui/view/pages/dev/echo.tsx";
import { ComponentEchoPanel } from "#src/http/ui/view/pages/dev/echo.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";

// ---------------------------------------------------------------------------
// POST /ui/api/dev/components/echo - parses the gallery form and renders back
// what arrived, so each control's wire format can be inspected on both the
// scripted and the unscripted path.
//
// Nothing is stored. The rich-text field is still run through
// `normalizeRichText`, because that is the step every real caller performs and
// seeing its output is the point of the panel.
// ---------------------------------------------------------------------------

// Request.formData()'s return type varies by runtime/lib config, so depend only
// on the structural subset actually used (matching helpers/contact-form.ts)
interface FormLike {
	get(key: string): unknown;
}

const field = (form: FormLike, name: string): string =>
	form.get(name)?.toString().trim() ?? "";

const parseTags = (csv: string): ReadonlyArray<string> =>
	csv
		.split(",")
		.map((t) => t.trim())
		.filter((t) => t !== "");

export const componentEchoHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, DavError | InternalError> =>
	Effect.gen(function* () {
		yield* requireAuthenticated(ctx.auth);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (cause) => new InternalError({ cause }),
		});

		// Present only when the editor's script ran; its absence is what tells the
		// panel which path produced this submission
		const rawHtml = form.get("descriptionHtml");
		const scripted = typeof rawHtml === "string";
		const rich = yield* normalizeRichText(scripted ? rawHtml : "");

		const data: ComponentEchoData = {
			tags: parseTags(field(form, "categoriesCsv")),
			altTags: parseTags(field(form, "altCategoriesCsv")),
			dueDate: field(form, "dueDate"),
			startsAt: field(form, "startsAt"),
			rangeStart: field(form, "rangeStart"),
			rangeEnd: field(form, "rangeEnd"),
			shiftStart: field(form, "shiftStart"),
			shiftEnd: field(form, "shiftEnd"),
			principalSlug: field(form, "principalSlug"),
			descriptionHtml: rich.html,
			// The markup is authoritative when it arrived, since the plain field is
			// then only the editor's own approximation of it
			descriptionText: scripted ? rich.text : field(form, "description"),
			scripted,
		};

		return yield* renderFragment(<ComponentEchoPanel data={data} />);
	});
