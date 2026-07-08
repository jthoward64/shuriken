// Sidebar reorder — native HTML5 drag-and-drop for `[data-reorder-list]`
// containers (the calendar and address-book sidebars). Progressive
// enhancement over the server-rendered Up/Down buttons (`data-nojs-only`,
// hidden once this script's presence marks `html.js`): dragging a
// `[data-reorder-item]` row live-reorders the DOM, then POSTs the full desired
// order to /ui/api/collections/reorder. On failure the page reloads to
// restore the server's truth rather than leaving the UI in a stale state.

type ReorderList = HTMLElement & { dataset: { collectionType?: string } };
type ReorderItem = HTMLElement & { dataset: { collectionId?: string } };

const isReorderItem = (el: EventTarget | null): el is ReorderItem =>
	el instanceof HTMLElement && el.hasAttribute("data-reorder-item");

const items = (list: Element): ReadonlyArray<ReorderItem> =>
	Array.from(list.children).filter(isReorderItem);

const postReorder = async (
	list: ReorderList,
	movedId: string,
): Promise<void> => {
	const collectionType = list.dataset.collectionType ?? "";
	const order = items(list)
		.map((el) => el.dataset.collectionId ?? "")
		.filter((id) => id !== "");
	try {
		const res = await fetch("/ui/api/collections/reorder", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ collectionType, movedId, order }),
		});
		if (!res.ok) {
			window.location.reload();
		}
	} catch {
		window.location.reload();
	}
};

document.addEventListener("DOMContentLoaded", () => {
	for (const list of Array.from(
		document.querySelectorAll("[data-reorder-list]"),
	)) {
		if (!(list instanceof HTMLElement)) {
			continue;
		}
		const reorderList = list as ReorderList;

		let dragging: ReorderItem | null = null;

		for (const item of items(list)) {
			item.draggable = true;
			item.style.cursor = "grab";

			// Links are draggable by default; without this, starting a drag from
			// the calendar/addressbook name link fights the row's own dragstart.
			for (const link of Array.from(item.querySelectorAll("a"))) {
				link.draggable = false;
			}

			item.addEventListener("dragstart", (e) => {
				dragging = item;
				item.style.opacity = "0.5";
				e.dataTransfer?.setData("text/plain", item.dataset.collectionId ?? "");
				if (e.dataTransfer) {
					e.dataTransfer.effectAllowed = "move";
				}
			});

			item.addEventListener("dragend", () => {
				item.style.opacity = "";
				item.style.cursor = "grab";
				if (dragging === item) {
					const movedId = item.dataset.collectionId;
					dragging = null;
					if (movedId) {
						void postReorder(reorderList, movedId);
					}
				}
			});

			item.addEventListener("dragover", (e) => {
				if (!dragging || dragging === item) {
					return;
				}
				e.preventDefault();
				const rect = item.getBoundingClientRect();
				const before = e.clientY - rect.top < rect.height / 2;
				item.parentElement?.insertBefore(
					dragging,
					before ? item : item.nextSibling,
				);
			});

			item.addEventListener("drop", (e) => {
				e.preventDefault();
			});
		}
	}
});
