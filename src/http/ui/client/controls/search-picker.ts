import type { SearchPickerResponse } from "#src/http/ui/helpers/search-picker.ts";
import { initAll, one } from "./dom.ts";
import { createListbox } from "./listbox.ts";

// ---------------------------------------------------------------------------
// SearchPicker enhancement (see view/search-picker.tsx).
//
// Upgrades the plain text input into an ARIA combobox backed by the endpoint
// named in the wrapper's data attributes. The input keeps its name and value,
// so choosing from the list and typing an identifier by hand submit the same
// thing.
//
// This module owns only the fetching; the popup, its keyboard handling and its
// ARIA wiring come from createListbox. In-flight requests are aborted when a
// newer keystroke supersedes them, so a slow response cannot overwrite the list
// belonging to later input.
// ---------------------------------------------------------------------------

const seen = new WeakSet<Element>();
const DEBOUNCE_MS = 200;
// Long enough for a click on an option to land before blur tears the list down
const BLUR_CLOSE_MS = 100;

const initPicker = (root: HTMLElement): void => {
	const input = one<HTMLInputElement>(root, "[data-search-input]");
	const listboxEl = one<HTMLUListElement>(root, "[data-search-listbox]");
	const status = one<HTMLElement>(root, "[data-search-status]");
	const endpoint = root.dataset.endpoint;
	if (!(input && listboxEl) || endpoint === undefined) {
		return;
	}
	const queryParam = root.dataset.queryParam ?? "q";
	const minLength = Number(root.dataset.minLength ?? "2");

	const listbox = createListbox({
		input,
		listbox: listboxEl,
		emptyLabel: root.dataset.emptyLabel ?? "No matches",
		status,
		onChoose: (item) => {
			input.value = item.value;
			listbox.close();
			input.dispatchEvent(new Event("change", { bubbles: true }));
		},
	});

	// Typed from the return value rather than `number`: the project's type graph
	// pulls in node's setTimeout signature, which returns a Timeout object
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: AbortController | null = null;

	const search = async (query: string): Promise<void> => {
		inFlight?.abort();
		const controller = new AbortController();
		inFlight = controller;
		const url = new URL(endpoint, globalThis.location.href);
		url.searchParams.set(queryParam, query);
		try {
			const res = await fetch(url, {
				signal: controller.signal,
				headers: { Accept: "application/json" },
			});
			if (!res.ok) {
				listbox.close();
				return;
			}
			const body = (await res.json()) as SearchPickerResponse;
			listbox.show(body.items ?? [], body.truncated === true);
		} catch {
			// An abort is the expected outcome for a superseded keystroke, and a
			// failed lookup should leave the typed value usable rather than shout
			listbox.close();
		}
	};

	input.addEventListener("input", () => {
		globalThis.clearTimeout(timer);
		const query = input.value.trim();
		if (query.length < minLength) {
			listbox.close();
			return;
		}
		timer = globalThis.setTimeout(() => void search(query), DEBOUNCE_MS);
	});

	input.addEventListener("keydown", (e) => {
		listbox.handleKeydown(e);
	});

	input.addEventListener("blur", () => {
		globalThis.setTimeout(listbox.close, BLUR_CLOSE_MS);
	});
};

export const initSearchPickers = (): void =>
	initAll("[data-search-picker]", seen, initPicker);
