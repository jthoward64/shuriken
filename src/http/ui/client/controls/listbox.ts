import { make } from "./dom.ts";

// ---------------------------------------------------------------------------
// Shared combobox listbox - the popup list, its keyboard handling and its ARIA
// wiring, used by both the search picker (choose one) and the tag combobox
// (choose many).
//
// The two differ only in where the items come from and what happens on choice,
// so everything else lives here rather than being written twice: one
// implementation of roving aria-activedescendant, arrow/enter/escape handling
// and the mousedown-not-click selection.
// ---------------------------------------------------------------------------

export interface ListboxItem {
	readonly value: string;
	readonly label: string;
	readonly description?: string;
}

export interface ListboxConfig {
	/** The combobox input this list belongs to; gets the combobox ARIA roles. */
	readonly input: HTMLInputElement;
	/** The popup element; must already carry an id. */
	readonly listbox: HTMLUListElement;
	/** Shown when there is nothing to offer. */
	readonly emptyLabel: string;
	/** Optional polite live region for match counts. */
	readonly status?: HTMLElement | null;
	readonly onChoose: (item: ListboxItem) => void;
}

export interface Listbox {
	readonly show: (
		items: ReadonlyArray<ListboxItem>,
		truncated?: boolean,
	) => void;
	readonly close: () => void;
	readonly isOpen: () => boolean;
	/** Handles a key press, returning whether it was consumed. */
	readonly handleKeydown: (event: KeyboardEvent) => boolean;
}

export const createListbox = ({
	input,
	listbox,
	emptyLabel,
	status,
	onChoose,
}: ListboxConfig): Listbox => {
	input.setAttribute("role", "combobox");
	input.setAttribute("aria-expanded", "false");
	input.setAttribute("aria-autocomplete", "list");
	input.setAttribute("aria-controls", listbox.id);
	listbox.setAttribute("role", "listbox");

	let items: ReadonlyArray<ListboxItem> = [];
	let active = -1;

	const setStatus = (text: string): void => {
		if (status) {
			status.textContent = text;
		}
	};

	const close = (): void => {
		listbox.hidden = true;
		listbox.replaceChildren();
		input.setAttribute("aria-expanded", "false");
		input.removeAttribute("aria-activedescendant");
		items = [];
		active = -1;
	};

	const highlight = (index: number): void => {
		active = index;
		const options = Array.from(listbox.children);
		options.forEach((el, i) => {
			el.classList.toggle("is-active", i === index);
			el.setAttribute("aria-selected", String(i === index));
		});
		const current = options[index];
		if (current) {
			input.setAttribute("aria-activedescendant", current.id);
			current.scrollIntoView({ block: "nearest" });
		} else {
			input.removeAttribute("aria-activedescendant");
		}
	};

	const choose = (index: number): void => {
		const item = items[index];
		if (item) {
			onChoose(item);
		}
	};

	const show = (next: ReadonlyArray<ListboxItem>, truncated = false): void => {
		items = next;
		active = -1;
		if (next.length === 0) {
			listbox.replaceChildren(
				make("li", { class: "listbox-empty" }, emptyLabel),
			);
			listbox.hidden = false;
			input.setAttribute("aria-expanded", "true");
			setStatus(emptyLabel);
			return;
		}
		const nodes = next.map((item, i) => {
			const li = make("li", {
				id: `${input.id}-opt-${i}`,
				class: "listbox-option",
				role: "option",
				"aria-selected": "false",
			});
			li.append(make("span", { class: "listbox-option-label" }, item.label));
			if (item.description !== undefined) {
				li.append(
					make("span", { class: "listbox-option-desc" }, item.description),
				);
			}
			return li;
		});
		if (truncated) {
			nodes.push(
				make("li", { class: "listbox-more" }, "More matches - keep typing"),
			);
		}
		listbox.replaceChildren(...nodes);
		listbox.hidden = false;
		input.setAttribute("aria-expanded", "true");
		setStatus(`${next.length} match${next.length === 1 ? "" : "es"}`);
	};

	const handleKeydown = (event: KeyboardEvent): boolean => {
		if (listbox.hidden) {
			return false;
		}
		if (event.key === "ArrowDown") {
			event.preventDefault();
			highlight(Math.min(active + 1, items.length - 1));
			return true;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			highlight(Math.max(active - 1, 0));
			return true;
		}
		// Enter is only ours while an option is highlighted; otherwise the host
		// control decides what a bare Enter means
		if (event.key === "Enter" && active >= 0) {
			event.preventDefault();
			choose(active);
			return true;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return true;
		}
		return false;
	};

	// mousedown, not click: blur would tear the list down before click fires
	listbox.addEventListener("mousedown", (e) => {
		const option = (e.target as Element | null)?.closest(".listbox-option");
		if (option) {
			e.preventDefault();
			choose(Array.from(listbox.children).indexOf(option));
		}
	});

	return { show, close, isOpen: () => !listbox.hidden, handleKeydown };
};
