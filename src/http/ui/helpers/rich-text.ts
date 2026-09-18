import { Effect } from "effect";
import { compile } from "html-to-text";
import { InternalError } from "#src/domain/errors.ts";
import { sanitizeHtml } from "./sanitize-html.ts";

// ---------------------------------------------------------------------------
// Rich-text boundary - sanitizing editor HTML and downconverting it to plain
// text.
//
// The RichText control (view/rich-text.tsx) posts HTML produced by a
// contenteditable surface, which is untrusted: the client-side serializer
// normalizes it, but a caller can post anything. Every path that accepts rich
// text runs it through `normalizeRichText` before storage.
//
// The plain-text form is not a display convenience, it is a storage
// requirement. Rich descriptions are stored as STYLED-DESCRIPTION/X-ALT-DESC
// alongside a plain DESCRIPTION, so clients with no rich-text support still
// see readable content.
//
// Not a Context.Service: sanitizing is a pure transformation with no
// dependency worth injecting, so it follows the same free-function shape as
// the XML helpers in http/dav/xml/.
// ---------------------------------------------------------------------------

/** Tags the editor toolbar can produce. Anything else is unwrapped or dropped. */
const ALLOWED_TAGS: ReadonlyArray<string> = [
	"p",
	"br",
	"hr",
	"strong",
	"em",
	"u",
	"s",
	"a",
	"ul",
	"ol",
	"li",
	"blockquote",
	"code",
	"pre",
	"h1",
	"h2",
	"h3",
];

/** Link schemes that survive sanitizing; everything else has its href stripped. */
const ALLOWED_SCHEMES: ReadonlyArray<string> = [
	"http",
	"https",
	"mailto",
	"tel",
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
	allowedTags: [...ALLOWED_TAGS],
	// `rel` is allowed because transformTags adds it below; the allowlist is
	// applied after transforms, so it would otherwise be stripped straight back
	allowedAttributes: { a: ["href", "title", "rel"] },
	allowedSchemes: [...ALLOWED_SCHEMES],
	// Drop href entirely rather than keeping a bare <a> pointing nowhere useful
	allowProtocolRelative: false,
	// Discard the contents of script/style rather than leaking them as text
	nonTextTags: ["script", "style", "textarea", "noscript"],
	transformTags: {
		// Legacy presentational tags execCommand still emits in some browsers
		b: "strong",
		i: "em",
		strike: "s",
		div: "p",
		// Untrusted links open with no window.opener handle back to the app
		a: sanitizeHtml.simpleTransform("a", {
			rel: "noopener noreferrer",
		}),
	},
};

// Compiled once at module load: html-to-text parses and indexes its selector
// set per converter, so building one converter beats passing options per call
const convert = compile({
	// iCalendar folds its own lines, so hard-wrapping here would double up
	wordwrap: false,
	selectors: [
		{ selector: "a", options: { hideLinkHrefIfSameAsText: true } },
		{ selector: "hr", format: "skip" },
	],
});

/** A rich-text value in both the forms the storage layer needs. */
export interface RichTextValue {
	/** Sanitized HTML, safe to store and re-serve. */
	readonly html: string;
	/** Plain-text rendering for clients with no rich-text support. */
	readonly text: string;
}

/** Strips untrusted markup from editor HTML, leaving the editor's own vocabulary */
export const sanitizeRichText = (
	html: string,
): Effect.Effect<string, InternalError> =>
	Effect.try({
		try: () => sanitizeHtml(html, SANITIZE_OPTIONS),
		catch: (cause) => new InternalError({ cause }),
	});

/** Renders HTML as readable plain text, preserving list and paragraph structure */
export const richTextToPlainText = (
	html: string,
): Effect.Effect<string, InternalError> =>
	Effect.try({
		try: () => convert(html).trim(),
		catch: (cause) => new InternalError({ cause }),
	});

// An editor left empty still serializes a placeholder paragraph, which must not
// count as content or every untouched form would store an empty rich value
const isBlankHtml = (html: string): boolean =>
	html
		.replace(/<[^>]*>/gu, "")
		.replace(/&nbsp;/gu, " ")
		.trim() === "";

/**
 * Sanitizes editor HTML and derives its plain-text form.
 *
 * Returns both fields empty for markup that carries no text, so callers can
 * treat "untouched editor" and "cleared editor" identically.
 */
export const normalizeRichText = (
	html: string,
): Effect.Effect<RichTextValue, InternalError> =>
	Effect.gen(function* () {
		const clean = yield* sanitizeRichText(html);
		if (isBlankHtml(clean)) {
			return { html: "", text: "" };
		}
		const text = yield* richTextToPlainText(clean);
		return { html: clean, text };
	});
