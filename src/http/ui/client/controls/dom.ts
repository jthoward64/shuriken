// biome-ignore-all lint/plugin: plain browser script with no Effect; the linteffect rules flag its try/catch and JSON use regardless
// Small typed query helpers shared by the form controls. Kept local to the
// client bundle rather than pulled from a library, since this is all they need.

export const one = <T extends Element>(
	root: ParentNode,
	selector: string,
): T | null => root.querySelector<T>(selector);

export const all = <T extends Element>(
	root: ParentNode,
	selector: string,
): ReadonlyArray<T> => Array.from(root.querySelectorAll<T>(selector));

/** Element factory that keeps text as text, so nothing built here can inject markup */
export const make = <K extends keyof HTMLElementTagNameMap>(
	tag: K,
	attrs: Readonly<Record<string, string>> = {},
	text?: string,
): HTMLElementTagNameMap[K] => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		node.setAttribute(k, v);
	}
	if (text !== undefined) {
		node.textContent = text;
	}
	return node;
};

/**
 * Runs `init` once per element, now and after any HTMX swap brings in more.
 *
 * Each element is enhanced inside its own try/catch. Every control degrades to
 * a working native input, so one that fails to enhance must not abort the loop
 * or the initializers that run after it - otherwise a single broken control
 * silently disables every other control on the page.
 */
export const initAll = (
	selector: string,
	seen: WeakSet<Element>,
	init: (el: HTMLElement) => void,
): void => {
	for (const el of all<HTMLElement>(document, selector)) {
		if (seen.has(el)) {
			continue;
		}
		seen.add(el);
		try {
			init(el);
		} catch (cause) {
			// The native fallback still works, but a failure here is a bug worth
			// surfacing rather than swallowing
			console.error(`failed to enhance ${selector}`, cause);
		}
	}
};

/**
 * Moves a `<label for>` from a control to its replacement.
 *
 * A progressively-enhanced control hides the element the label was written
 * against, which would leave the label pointing at something invisible and
 * unfocusable. Re-pointing keeps clicking the label working and keeps the
 * accessible name attached to the element that actually takes input.
 */
export const repointLabel = (from: Element, to: Element): void => {
	if (from.id === "" || to.id === "") {
		return;
	}
	for (const label of all<HTMLLabelElement>(
		document,
		`label[for="${CSS.escape(from.id)}"]`,
	)) {
		label.htmlFor = to.id;
	}
};

/** Positions a popover under `anchor`, flipping above when it would overflow */
export const placeUnder = (panel: HTMLElement, anchor: Element): void => {
	const a = anchor.getBoundingClientRect();
	const p = panel.getBoundingClientRect();
	const margin = 4;
	const below = a.bottom + margin;
	const fitsBelow = below + p.height <= globalThis.innerHeight;
	const top = fitsBelow ? below : Math.max(margin, a.top - margin - p.height);
	const left = Math.min(
		Math.max(margin, a.left),
		Math.max(margin, globalThis.innerWidth - p.width - margin),
	);
	panel.style.top = `${top}px`;
	panel.style.left = `${left}px`;
};
