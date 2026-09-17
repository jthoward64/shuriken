import type { ComponentChildren, VNode } from "preact";
import { cx } from "./cx.ts";
import { IconCheck, IconCopy } from "./icons.tsx";

// ---------------------------------------------------------------------------
// Copy-to-clipboard controls.
//
// Progressive enhancement: the value is always rendered as selectable text, so
// no-JS users can select + copy it manually. The button is a pure enhancement —
// the delegated handler in /static/ui.js reads `data-copy` and writes it to the
// clipboard, then swaps the idle/done spans (toggled via the `hidden` attribute,
// so no extra CSS is needed). Buttons are `type="button"` so they never submit a
// surrounding form when JS is unavailable.
// ---------------------------------------------------------------------------

export interface CopyButtonProps {
	/** Text placed on the clipboard when pressed. */
	readonly value: string;
	/** Accessible description, e.g. "Principal URL" → "Copy Principal URL". */
	readonly label: string;
	readonly class?: string;
}

export const CopyButton = ({
	value,
	label,
	class: cls,
}: CopyButtonProps): VNode => (
	<button
		type="button"
		data-copy={value}
		aria-label={`Copy ${label}`}
		title={`Copy ${label}`}
		class={cx("btn btn-secondary btn-sm shrink-0", cls)}
	>
		<span class="copy-idle inline-flex items-center gap-1.5">
			<IconCopy class="h-4 w-4" />
			Copy
		</span>
		<span class="copy-done inline-flex items-center gap-1.5" hidden>
			<IconCheck class="h-4 w-4" />
			Copied
		</span>
	</button>
);

export interface CopyFieldProps {
	readonly label: string;
	readonly value: string;
	/** Optional hint shown under the field. */
	readonly hint?: ComponentChildren;
}

// A labelled, monospace, selectable value paired with a copy button. Used for
// DAV setup URLs and one-time app-password secrets.
export const CopyField = ({ label, value, hint }: CopyFieldProps): VNode => (
	<div class="form-group">
		<span class="form-label">{label}</span>
		<div class="flex items-stretch gap-2">
			<code class="block flex-1 min-w-0 select-all overflow-x-auto whitespace-nowrap rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-fg">
				{value}
			</code>
			<CopyButton value={value} label={label} />
		</div>
		{hint && <p class="form-hint">{hint}</p>}
	</div>
);
