import { all, initAll, make, one, repointLabel } from "./dom.ts";

// ---------------------------------------------------------------------------
// TagPicker enhancement (see view/tag-picker.tsx).
//
// The CSV input stays the single source of truth and the only submitted field;
// the chip UI reads it on init and rewrites it on every change, so the form
// posts the same shape whether or not this script ran.
// ---------------------------------------------------------------------------

const seen = new WeakSet<Element>();

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

const chip = (tag: string): HTMLLIElement => {
	const li = make("li", {
		class: "tag-chip",
		"data-tag-chip": "",
		"data-tag": tag,
	});
	li.append(make("span", { class: "tag-chip-label" }, tag));
	const remove = make("button", {
		type: "button",
		class: "tag-chip-remove",
		"data-tag-remove": "",
		"aria-label": `Remove ${tag}`,
	});
	remove.append(make("span", { "aria-hidden": "true" }, "×"));
	li.append(remove);
	return li;
};

const initPicker = (root: HTMLElement): void => {
	const valueInput = one<HTMLInputElement>(root, "[data-tag-value]");
	const list = one<HTMLUListElement>(root, "[data-tag-list]");
	if (!(valueInput && list)) {
		return;
	}
	const addSelect = one<HTMLSelectElement>(root, "[data-tag-add]");
	const customInput = one<HTMLInputElement>(root, "[data-tag-custom]");
	const emptyNote = one<HTMLElement>(root, "[data-tag-empty]");

	// Captured before any render, since rendering removes the chosen ones
	const suggestions = addSelect
		? all<HTMLOptionElement>(addSelect, "option")
				.map((o) => o.value)
				.filter((v) => v !== "")
		: [];

	let tags = [...parseCsv(valueInput.value)];

	// The label points at the CSV input, which is hidden once this runs
	if (addSelect) {
		repointLabel(valueInput, addSelect);
	}

	const syncAddOptions = (): void => {
		if (!addSelect) {
			return;
		}
		const chosen = new Set(tags.map((t) => t.toLowerCase()));
		for (const option of all<HTMLOptionElement>(addSelect, "option")) {
			if (option.value !== "") {
				option.remove();
			}
		}
		for (const s of suggestions) {
			if (!chosen.has(s.toLowerCase())) {
				addSelect.append(make("option", { value: s }, s));
			}
		}
		addSelect.value = "";
		// Nothing left to offer is worth saying, rather than an empty dropdown
		addSelect.disabled = addSelect.options.length <= 1;
	};

	const render = (): void => {
		list.replaceChildren(...tags.map(chip));
		valueInput.value = tags.join(", ");
		if (emptyNote) {
			emptyNote.hidden = tags.length > 0;
		}
		syncAddOptions();
	};

	const add = (raw: string): void => {
		const tag = raw.trim();
		if (tag === "" || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
			return;
		}
		tags.push(tag);
		render();
	};

	list.addEventListener("click", (e) => {
		const button = (e.target as Element | null)?.closest("[data-tag-remove]");
		if (!button) {
			return;
		}
		const tag = button.closest<HTMLElement>("[data-tag-chip]")?.dataset.tag;
		if (tag !== undefined) {
			tags = tags.filter((t) => t !== tag);
			render();
		}
	});

	addSelect?.addEventListener("change", () => {
		add(addSelect.value);
	});

	// Enter inside the tag field adds a tag rather than submitting the form
	customInput?.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			add(customInput.value);
			customInput.value = "";
		}
	});

	render();
};

export const initTagPickers = (): void =>
	initAll("[data-tag-picker]", seen, initPicker);
