import { all, initAll, one } from "./dom.ts";

// ---------------------------------------------------------------------------
// RichTextField enhancement (see view/rich-text.tsx).
//
// Formatting runs through document.execCommand. It is deprecated and its
// output varies between engines, which is why everything it produces is
// normalized against an allowlist before being written to the hidden field.
// The alternative is a full editing model (selection mapping, undo stack,
// input-event handling) which is what the editor libraries exist to provide;
// execCommand plus normalization buys a working toolbar for a fraction of the
// code and none of the bundle.
//
// Normalizing here is a formatting concern, not a security one. The server
// re-sanitizes whatever arrives (see helpers/rich-text.ts), because this runs
// on the client and a caller can post anything.
// ---------------------------------------------------------------------------

const seen = new WeakSet<Element>();

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
	"P",
	"BR",
	"HR",
	"STRONG",
	"EM",
	"U",
	"S",
	"A",
	"UL",
	"OL",
	"LI",
	"BLOCKQUOTE",
	"CODE",
	"PRE",
	"H1",
	"H2",
	"H3",
]);

/** Presentational tags execCommand still emits, mapped to the stored vocabulary. */
const RENAME: Readonly<Record<string, string>> = {
	B: "STRONG",
	I: "EM",
	STRIKE: "S",
	DEL: "S",
	DIV: "P",
};

const ALLOWED_ATTRS: Readonly<Record<string, ReadonlyArray<string>>> = {
	A: ["href", "title"],
};

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/iu;

const rename = (el: Element, tag: string): Element => {
	const replacement = document.createElement(tag);
	while (el.firstChild) {
		replacement.append(el.firstChild);
	}
	el.replaceWith(replacement);
	return replacement;
};

/** Drops everything outside the allowlist, keeping the text it contained */
const normalize = (root: Element): void => {
	for (const el of all<Element>(root, "*")) {
		if (!el.isConnected) {
			continue;
		}
		const renamed = RENAME[el.tagName];
		const current = renamed !== undefined ? rename(el, renamed) : el;

		if (!ALLOWED_TAGS.has(current.tagName)) {
			// Unwrap rather than delete, so formatting loss never loses words
			current.replaceWith(...Array.from(current.childNodes));
			continue;
		}
		const allowed = ALLOWED_ATTRS[current.tagName] ?? [];
		for (const attr of Array.from(current.attributes)) {
			if (!allowed.includes(attr.name)) {
				current.removeAttribute(attr.name);
			}
		}
		const href = current.getAttribute("href");
		if (href !== null && !SAFE_SCHEME.test(href)) {
			current.removeAttribute("href");
		}
	}
};

const serialize = (surface: HTMLElement): string => {
	const clone = surface.cloneNode(true) as HTMLElement;
	normalize(clone);
	return clone.innerHTML.trim();
};

type Exec = (command: string, value?: string) => void;

const commandRunner =
	(surface: HTMLElement): Exec =>
	(command, value) => {
		surface.focus();
		document.execCommand(command, false, value);
	};

const applyCommand = (name: string, exec: Exec): void => {
	switch (name) {
		case "bold":
		case "italic":
		case "underline":
			exec(name);
			return;
		case "strike":
			exec("strikeThrough");
			return;
		case "h2":
			exec("formatBlock", "<h2>");
			return;
		case "h3":
			exec("formatBlock", "<h3>");
			return;
		case "paragraph":
			exec("formatBlock", "<p>");
			return;
		case "bulletList":
			exec("insertUnorderedList");
			return;
		case "numberList":
			exec("insertOrderedList");
			return;
		case "blockquote":
			exec("formatBlock", "<blockquote>");
			return;
		case "code":
			exec("formatBlock", "<pre>");
			return;
		case "link": {
			const url = globalThis.prompt("Link URL", "https://");
			if (url !== null && SAFE_SCHEME.test(url)) {
				exec("createLink", url);
			}
			return;
		}
		case "unlink":
			exec("unlink");
			return;
		case "clear":
			exec("removeFormat");
			return;
		default:
			return;
	}
};

const STATE_COMMANDS: Readonly<Record<string, string>> = {
	bold: "bold",
	italic: "italic",
	underline: "underline",
	strike: "strikeThrough",
};

const initEditor = (root: HTMLElement): void => {
	const surface = one<HTMLElement>(root, "[data-rich-surface]");
	const htmlField = one<HTMLInputElement>(root, "[data-rich-html]");
	const plainField = one<HTMLInputElement>(root, "[data-rich-plain]");
	const fallback = one<HTMLTextAreaElement>(root, "[data-rich-fallback]");
	const toolbar = one<HTMLElement>(root, "[data-rich-toolbar]");
	if (!(surface && htmlField && plainField && fallback)) {
		return;
	}

	// Hand submission over to the hidden fields. Until this runs the textarea is
	// the live control, so a bundle that never loads still posts usable content.
	fallback.disabled = true;
	htmlField.disabled = false;
	plainField.disabled = false;

	// Emit tags rather than inline styles, which the allowlist would strip
	document.execCommand("styleWithCSS", false, "false");

	const exec = commandRunner(surface);

	const sync = (): void => {
		htmlField.value = serialize(surface);
		plainField.value = surface.innerText.trim();
		root.classList.toggle("is-empty", surface.textContent?.trim() === "");
	};

	const refreshToolbar = (): void => {
		if (
			!(
				toolbar && surface.contains(document.getSelection()?.anchorNode ?? null)
			)
		) {
			return;
		}
		for (const button of all<HTMLButtonElement>(
			toolbar,
			"[data-rich-command]",
		)) {
			const command = STATE_COMMANDS[button.dataset.richCommand ?? ""];
			if (command !== undefined) {
				button.setAttribute(
					"aria-pressed",
					String(document.queryCommandState(command)),
				);
			}
		}
	};

	toolbar?.addEventListener("click", (e) => {
		const button = (e.target as Element | null)?.closest<HTMLElement>(
			"[data-rich-command]",
		);
		const command = button?.dataset.richCommand;
		if (command !== undefined) {
			e.preventDefault();
			applyCommand(command, exec);
			sync();
			refreshToolbar();
		}
	});

	surface.addEventListener("input", sync);
	surface.addEventListener("blur", sync);
	document.addEventListener("selectionchange", refreshToolbar);

	// Paste as text: pasted markup would mostly be stripped anyway, and dropping
	// it at the boundary avoids a surprise reformat of the surrounding block
	surface.addEventListener("paste", (e) => {
		const text = e.clipboardData?.getData("text/plain");
		if (text !== undefined) {
			e.preventDefault();
			exec("insertText", text);
			sync();
		}
	});

	// A form reset restores the textarea's default, so mirror that in the surface
	root.closest("form")?.addEventListener("reset", () => {
		globalThis.setTimeout(() => {
			surface.textContent = fallback.defaultValue;
			sync();
		}, 0);
	});

	sync();
};

export const initRichText = (): void =>
	initAll("[data-rich-text]", seen, initEditor);
