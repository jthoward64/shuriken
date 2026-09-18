import type { VNode } from "preact";
import { cx } from "../cx.ts";

// ---------------------------------------------------------------------------
// RichTextField - HTML editor over a contenteditable surface.
//
// Posts two fields: `name` carries a plain-text rendering and `htmlName`
// carries the markup. Both forms are stored, because a rich description is
// kept as STYLED-DESCRIPTION/X-ALT-DESC alongside a plain DESCRIPTION for
// clients with no rich-text support.
//
// Exactly one control named `name` is ever submitted. Without JavaScript that
// is the textarea and the value is plain text, with no HTML field present at
// all. The script disables the textarea and enables the two hidden inputs, so
// the server sees the same field name either way and simply finds `htmlName`
// absent on the unscripted path.
//
// `valueHtml` is written into the surface as markup and must already be
// sanitized - in practice it comes back from `normalizeRichText`, which is
// also what re-sanitizes whatever this control posts.
// ---------------------------------------------------------------------------

export type RichTextCommand =
	| "bold"
	| "italic"
	| "underline"
	| "strike"
	| "h2"
	| "h3"
	| "paragraph"
	| "bulletList"
	| "numberList"
	| "blockquote"
	| "code"
	| "link"
	| "unlink"
	| "clear";

interface ToolbarButton {
	readonly command: RichTextCommand;
	readonly glyph: string;
	readonly label: string;
	/** Rendered in a bolder/italic style matching what it produces. */
	readonly style?: string;
}

const TOOLBAR: ReadonlyArray<ToolbarButton> = [
	{ command: "bold", glyph: "B", label: "Bold", style: "font-bold" },
	{ command: "italic", glyph: "I", label: "Italic", style: "italic" },
	{ command: "underline", glyph: "U", label: "Underline", style: "underline" },
	{
		command: "strike",
		glyph: "S",
		label: "Strikethrough",
		style: "line-through",
	},
	{ command: "h2", glyph: "H2", label: "Heading" },
	{ command: "h3", glyph: "H3", label: "Subheading" },
	{ command: "paragraph", glyph: "¶", label: "Paragraph" },
	{ command: "bulletList", glyph: "••", label: "Bulleted list" },
	{ command: "numberList", glyph: "1.", label: "Numbered list" },
	{ command: "blockquote", glyph: "❝", label: "Quote" },
	{ command: "code", glyph: "</>", label: "Code" },
	{ command: "link", glyph: "🔗", label: "Add link" },
	{ command: "unlink", glyph: "⛓", label: "Remove link" },
	{ command: "clear", glyph: "⌫", label: "Clear formatting" },
];

/** Approximate line height of the editing surface, for sizing it like a textarea. */
const LINE_HEIGHT_REM = 1.5;

/** Commands that toggle, so the script can reflect their state on the button. */
const SEPARATOR_AFTER: ReadonlySet<RichTextCommand> = new Set([
	"strike",
	"paragraph",
	"blockquote",
	"unlink",
]);

export interface RichTextFieldProps {
	readonly id: string;
	/** Submitted field name for the plain-text rendering. */
	readonly name: string;
	/** Submitted field name for the markup. Defaults to `${name}Html`. */
	readonly htmlName?: string;
	/** Sanitized markup to load into the editor. */
	readonly valueHtml?: string;
	/** Plain-text rendering, used by the no-JS textarea. */
	readonly valueText?: string;
	readonly rows?: number;
	readonly placeholder?: string;
	readonly class?: string;
}

export const RichTextField = ({
	id,
	name,
	htmlName,
	valueHtml = "",
	valueText = "",
	rows = 6,
	placeholder = "Write something…",
	class: cls,
}: RichTextFieldProps): VNode => {
	const htmlField = htmlName ?? `${name}Html`;
	return (
		<div class={cx("richtext", cls)} data-rich-text>
			<textarea
				id={id}
				name={name}
				rows={rows}
				placeholder={placeholder}
				class="form-textarea"
				data-nojs-only
				data-rich-fallback
			>
				{valueText}
			</textarea>

			<div class="richtext-ui" data-js-only>
				<div
					class="richtext-toolbar"
					role="toolbar"
					aria-label="Text formatting"
					aria-controls={`${id}-surface`}
					data-rich-toolbar
				>
					{TOOLBAR.map((b) => (
						<>
							<button
								key={b.command}
								type="button"
								class={cx("richtext-btn", b.style)}
								data-rich-command={b.command}
								title={b.label}
								aria-label={b.label}
								aria-pressed="false"
							>
								<span aria-hidden="true">{b.glyph}</span>
							</button>
							{SEPARATOR_AFTER.has(b.command) && (
								<span class="richtext-sep" aria-hidden="true" />
							)}
						</>
					))}
				</div>

				{/* role/aria-multiline follow the ARIA Authoring Practices for a rich
				    text editor: a contenteditable element has no implicit role, and the
				    semantic alternatives the linter suggests cannot hold markup.
				    tabIndex keeps it reachable by keyboard. */}
				{/* biome-ignore lint/a11y/useSemanticElements: an editable markup surface cannot be an input or textarea */}
				<div
					id={`${id}-surface`}
					class="richtext-surface form-textarea"
					contentEditable
					role="textbox"
					aria-multiline="true"
					tabIndex={0}
					data-rich-surface
					data-placeholder={placeholder}
					// biome-ignore lint/nursery/noInlineStyles: height is computed from the caller's row count
					style={{ minHeight: `${rows * LINE_HEIGHT_REM}rem` }}
					dangerouslySetInnerHTML={{
						// biome-ignore lint/style/useNamingConvention: preact's own prop name
						__html: valueHtml,
					}}
				/>

				{/* Enabled by the script, which also disables the textarea above, so
				    exactly one control named `name` is ever submitted. */}
				<input
					type="hidden"
					name={htmlField}
					value={valueHtml}
					disabled
					data-rich-html
				/>
				<input
					type="hidden"
					name={name}
					value={valueText}
					disabled
					data-rich-plain
				/>
			</div>
		</div>
	);
};
