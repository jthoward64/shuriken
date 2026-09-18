import { all, initAll, make, one, repointLabel } from "./dom.ts";
import { createListbox } from "./listbox.ts";

// ---------------------------------------------------------------------------
// TagCombobox enhancement (see view/tag-combobox.tsx).
//
// The hidden CSV input stays the single source of truth and the only submitted
// field; the token box reads it on init and rewrites it on every change, so the
// form posts the same shape whether or not this script ran.
// ---------------------------------------------------------------------------

const seen = new WeakSet<Element>();
const BLUR_CLOSE_MS = 120;

const parseCsv = (value: string): ReadonlyArray<string> => {
	const out: Array<string> = [];
	for (const raw of value.split(",")) {
		const tag = raw.trim();
		// Case-insensitive de-dupe, keeping the casing first entered
		if (tag !== "" && !out.some((t) => t.toLowerCase() === tag.toLowerCase())) {
			out.push(tag);
		}
	}
	return out;
};

const parseSuggestions = (raw: string | undefined): ReadonlyArray<string> => {
	if (raw === undefined) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((v): v is string => typeof v === "string")
			: [];
	} catch {
		return [];
	}
};

const token = (tag: string): HTMLSpanElement => {
	const el = make("span", {
		class: "tag-token",
		"data-tag-token": "",
		"data-tag": tag,
	});
	el.append(make("span", { class: "tag-token-label" }, tag));
	const remove = make("button", {
		type: "button",
		class: "tag-token-remove",
		"data-tag-remove": "",
		tabindex: "-1",
		"aria-label": `Remove ${tag}`,
	});
	remove.append(make("span", { "aria-hidden": "true" }, "×"));
	el.append(remove);
	return el;
};

const initCombobox = (root: HTMLElement): void => {
	const valueInput = one<HTMLInputElement>(root, "[data-tag-value]");
	const box = one<HTMLElement>(root, "[data-tag-box]");
	const entry = one<HTMLInputElement>(root, "[data-tag-entry]");
	const listboxEl = one<HTMLUListElement>(root, "[data-tag-listbox]");
	const status = one<HTMLElement>(root, "[data-tag-status]");
	if (!(valueInput && box && entry && listboxEl)) {
		return;
	}

	const allowCustom = root.hasAttribute("data-allow-custom");
	const suggestions = parseSuggestions(root.dataset.suggestions);
	let tags = [...parseCsv(valueInput.value)];

	// The field's label points at the CSV input, which is hidden once this runs,
	// so move it to the entry the person actually types into
	repointLabel(valueInput, entry);

	const has = (tag: string): boolean =>
		tags.some((t) => t.toLowerCase() === tag.toLowerCase());

	const render = (): void => {
		for (const el of all(box, "[data-tag-token]")) {
			el.remove();
		}
		for (const tag of tags) {
			box.insertBefore(token(tag), entry);
		}
		valueInput.value = tags.join(", ");
		valueInput.dispatchEvent(new Event("change", { bubbles: true }));
	};

	const available = (): ReadonlyArray<{ value: string; label: string }> => {
		const query = entry.value.trim().toLowerCase();
		return suggestions
			.filter((s) => !has(s) && s.toLowerCase().includes(query))
			.map((s) => ({ value: s, label: s }));
	};

	const listbox = createListbox({
		input: entry,
		listbox: listboxEl,
		// With free entry, an unmatched query is an instruction rather than a dead end
		emptyLabel: allowCustom ? "Press Enter to add" : "No matches",
		status,
		onChoose: (item) => {
			add(item.value);
		},
	});

	const openList = (): void => {
		listbox.show(available());
	};

	// An arrow rather than a function declaration: a hoisted declaration could in
	// principle run before the null guards above, so TypeScript discards their
	// narrowing inside one. `listbox`'s onChoose reaches this at call time.
	const add = (raw: string): void => {
		const tag = raw.trim();
		if (tag === "" || has(tag)) {
			entry.value = "";
			return;
		}
		tags.push(tag);
		entry.value = "";
		render();
		// Kept open so several tags can be added without reaching for the field again
		openList();
	};

	const commitEntry = (): void => {
		if (allowCustom) {
			add(entry.value);
		} else {
			entry.value = "";
		}
	};

	// Clicking the box's padding should feel like clicking a text field
	box.addEventListener("mousedown", (e) => {
		if (!(e.target as Element | null)?.closest("[data-tag-token]")) {
			e.preventDefault();
			entry.focus();
			openList();
		}
	});

	box.addEventListener("click", (e) => {
		const remove = (e.target as Element | null)?.closest("[data-tag-remove]");
		if (!remove) {
			return;
		}
		const tag = remove.closest<HTMLElement>("[data-tag-token]")?.dataset.tag;
		if (tag !== undefined) {
			tags = tags.filter((t) => t !== tag);
			render();
			entry.focus();
		}
	});

	entry.addEventListener("focus", openList);
	entry.addEventListener("input", openList);

	entry.addEventListener("keydown", (e) => {
		if (listbox.handleKeydown(e)) {
			return;
		}
		if (e.key === "Enter") {
			// Never let a half-typed tag submit the surrounding form
			e.preventDefault();
			commitEntry();
			return;
		}
		if (e.key === ",") {
			e.preventDefault();
			commitEntry();
			return;
		}
		// Backspace into the tokens removes the last one, as in a mail To: field
		if (e.key === "Backspace" && entry.value === "" && tags.length > 0) {
			tags.pop();
			render();
			openList();
		}
	});

	entry.addEventListener("blur", () => {
		// Committing on the way out means typed text is never silently discarded
		commitEntry();
		globalThis.setTimeout(listbox.close, BLUR_CLOSE_MS);
	});

	render();
};

export const initTagComboboxes = (): void =>
	initAll("[data-tag-combobox]", seen, initCombobox);
