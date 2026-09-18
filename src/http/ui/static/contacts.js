// Shuriken contacts UI enhancement. Loaded per-page (via `extraHead`) on the
// contacts pages that run long HTMX operations or need light interactivity.
//
// Everything here is progressive enhancement — the pages work without JS (forms
// submit via method/action; the merge/cleanup/import forms POST full-page). This
// script only layers on feedback + convenience, all via event delegation on
// `document` so it also applies to HTMX-swapped content.
//
// Enhancements:
//   1. A slim indeterminate progress bar + navigate-away guard while a guarded
//      HTMX request ([data-guard]) is in flight (import / bulk / merge / cleanup).
//   2. A brief progress flash for plain file downloads ([data-download]) — a
//      native download emits no completion signal, so we can only time it out.
//   3. Delegated behaviours that replace inline on* handlers (which preact's JSX
//      types reject as string attributes):
//        [data-autosubmit]        — submit the owning form on change
//        [data-check-all]         — toggle every input[name=id] in the table
//        [data-dismiss-suggestion]— remove the closest [data-suggestion]
//        [data-reload]            — reload the page (preserves the query string)
//
// NOTE: contacts-local convention. There is no shared progress/guard helper in
// the design system (static/ui.js) yet — promote this if another area needs it.

const NUMERIC_SUFFIX = /-\d+$/u;

(() => {
	const autoHideMs = 2500;

	// Ids come from server-rendered markup, so they are escaped before use as a selector
	const byId = (id) => document.querySelector(`#${CSS.escape(id)}`);

	let inFlight = 0;
	let bar = null;
	let downloadTimer = null;

	// Ids must match hover-card.tsx / edit-dialog.tsx.
	const hoverCardId = "contact-hover-card";
	const hoverCardBodyId = "contact-hover-card-body";
	const editContactPopoverId = "edit-contact-popover";
	const editContactPopoverBodyId = "edit-contact-popover-body";

	const getHtmx = () => {
		const h = window.htmx;
		return h && typeof h.ajax === "function" ? h : undefined;
	};

	// --- Progress bar --------------------------------------------------------
	// Injected lazily; styled via the static #contacts-progress rule in
	// input.css (a runtime-injected <style> tag would be blocked by the
	// style-src-elem CSP directive).
	const ensureBar = () => {
		if (bar) {
			return bar;
		}
		bar = document.createElement("div");
		bar.id = "contacts-progress";
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-label", "Working…");
		bar.hidden = true;
		document.body.appendChild(bar);
		return bar;
	};

	const showBar = () => {
		ensureBar().hidden = false;
	};
	const hideBar = () => {
		if (bar) {
			bar.hidden = true;
		}
	};

	// --- Navigate-away guard -------------------------------------------------
	const onBeforeUnload = (e) => {
		e.preventDefault();
		// Legacy browsers require a returnValue to show the prompt.
		e.returnValue = "";
		return "";
	};

	const start = () => {
		inFlight += 1;
		showBar();
		window.addEventListener("beforeunload", onBeforeUnload);
	};
	const stop = () => {
		inFlight = Math.max(0, inFlight - 1);
		if (inFlight === 0) {
			hideBar();
			window.removeEventListener("beforeunload", onBeforeUnload);
		}
	};

	// --- Hover card (read-only preview, shown on hover + click) --------------
	// A `popover="manual"` element — not a <dialog> — so it's non-modal and its
	// show/hide is entirely driven from here (no light-dismiss), letting hover
	// and click share the same logic. Positioned next to the trigger via
	// getBoundingClientRect, clamped to the viewport.
	const hoverOpenDelayMs = 300;
	const hoverCloseDelayMs = 200;
	let hoverOpenTimer;
	let hoverCloseTimer;
	// Bumped on every open/click so a slow, superseded fetch never shows stale
	// content after a newer hover/click already resolved.
	let hoverCardToken = 0;

	const clearHoverOpenTimer = () => {
		window.clearTimeout(hoverOpenTimer);
		hoverOpenTimer = undefined;
	};
	const clearHoverCloseTimer = () => {
		window.clearTimeout(hoverCloseTimer);
		hoverCloseTimer = undefined;
	};

	const positionHoverCard = (card, anchor) => {
		const margin = 8;
		const anchorRect = anchor.getBoundingClientRect();
		const cardRect = card.getBoundingClientRect();
		let left = anchorRect.left;
		let top = anchorRect.bottom + margin;
		if (left + cardRect.width > window.innerWidth - margin) {
			left = Math.max(margin, window.innerWidth - cardRect.width - margin);
		}
		if (top + cardRect.height > window.innerHeight - margin) {
			top = Math.max(margin, anchorRect.top - cardRect.height - margin);
		}
		card.style.left = `${left}px`;
		card.style.top = `${top}px`;
	};

	const hideHoverCard = () => {
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		const card = byId(hoverCardId);
		// togglePopover(false) is a no-op on a card that is not showing, where
		// hidePopover() would throw InvalidStateError
		if (card && typeof card.togglePopover === "function") {
			card.togglePopover(false);
		}
	};

	// Fetch + show immediately — used by click, and by the debounced hover open.
	const showHoverCardNow = (url, anchor) => {
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		const card = byId(hoverCardId);
		const htmx = getHtmx();
		if (!card || typeof card.showPopover !== "function" || !htmx) {
			window.location.href = url;
			return;
		}
		const token = ++hoverCardToken;
		htmx
			.ajax("GET", url, { target: `#${hoverCardBodyId}`, swap: "innerHTML" })
			.then(() => {
				if (token !== hoverCardToken) {
					return;
				}
				card.togglePopover(true);
				positionHoverCard(card, anchor);
			});
	};

	const scheduleHoverCardOpen = (url, anchor) => {
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		hoverOpenTimer = window.setTimeout(
			() => showHoverCardNow(url, anchor),
			hoverOpenDelayMs,
		);
	};

	const scheduleHoverCardClose = () => {
		clearHoverOpenTimer();
		clearHoverCloseTimer();
		hoverCloseTimer = window.setTimeout(hideHoverCard, hoverCloseDelayMs);
	};

	// Open the real Edit dialog for a hover-card's Edit button (or, absent
	// htmx, fall back to navigating there).
	const openEditDialog = (url) => {
		const htmx = getHtmx();
		const dialog = byId(editContactPopoverId);
		if (!(htmx && dialog instanceof HTMLDialogElement)) {
			window.location.href = url;
			return;
		}
		if (!dialog.open) {
			dialog.showModal();
		}
		htmx.ajax("GET", url, {
			target: `#${editContactPopoverBodyId}`,
			swap: "innerHTML",
		});
	};

	// --- Preview pane (read-only, opened on row click) -----------------------
	// A popover (`popover="auto"`) opened via showPopover() on a row click: a
	// full-bleed sheet on mobile, a right-anchored panel over a dimmed (still-
	// visible) list on desktop. Native light-dismiss handles the backdrop
	// click / Escape, and the in-pane Back button hides it via popovertarget —
	// no JS dismiss wiring needed. Its body is fetched from the same /preview
	// route the no-JS new-tab link points at. Ids match preview-pane.tsx.
	const paneId = "contacts-pane";
	const paneBodyId = "contacts-pane-body";
	let paneToken = 0;

	// `:popover-open` is a syntax error in browsers without popover support, so
	// the selector is feature-checked once rather than probed per call
	const popoverOpenSupported =
		typeof CSS !== "undefined" &&
		typeof CSS.supports === "function" &&
		CSS.supports("selector(:popover-open)");

	const isPopoverOpen = (el) =>
		popoverOpenSupported && el.matches(":popover-open");

	const closePane = () => {
		const pane = byId(paneId);
		if (pane && typeof pane.togglePopover === "function") {
			pane.togglePopover(false);
		}
	};

	// Fetch the preview fragment into the pane body, then show the popover.
	// Token-guarded so a slow, superseded fetch never overwrites a newer
	// selection (e.g. a fast second click while the first is still loading).
	const openPane = (url) => {
		const htmx = getHtmx();
		const pane = byId(paneId);
		if (!(htmx && pane) || typeof pane.showPopover !== "function") {
			window.open(url, "_blank");
			return;
		}
		const token = ++paneToken;
		if (!isPopoverOpen(pane)) {
			pane.showPopover();
		}
		htmx
			.ajax("GET", url, { target: `#${paneBodyId}`, swap: "innerHTML" })
			.then(() => {
				if (token !== paneToken) {
					return;
				}
				const focusTarget = pane.querySelector("[data-edit-contact]");
				if (focusTarget && typeof focusTarget.focus === "function") {
					focusTarget.focus();
				}
			});
	};

	// Keep every [data-selected-count] in a form in sync with its checked rows.
	const updateSelectedCount = (form) => {
		const n = form.querySelectorAll("input[name=id]:checked").length;
		for (const el of form.querySelectorAll("[data-selected-count]")) {
			el.textContent = String(n);
		}
	};

	// True when the element that triggered an HTMX request opted into guarding.
	// htmx 4 dispatches lifecycle events on the requesting element, so read it
	// from `evt.target` (htmx 2 exposed it as `evt.detail.elt`).
	const isGuarded = (evt) => {
		const el = evt.target;
		return el && typeof el.closest === "function" && el.closest("[data-guard]");
	};

	document.addEventListener("htmx:before:request", (e) => {
		if (isGuarded(e)) {
			start();
		}
	});
	// `finally:request` always fires (success or failure), so the guard never
	// sticks — it replaces htmx 2's afterRequest + sendError + responseError.
	document.addEventListener("htmx:finally:request", (e) => {
		if (isGuarded(e)) {
			stop();
		}
	});

	// --- Contact form: dynamic rows, type checkboxes, gender, display name ---
	// All JS-only enhancements over the plain-HTML form in form.tsx — every
	// piece here has a working (if less convenient) no-JS fallback rendered
	// server-side, per the initial state each helper reads/writes.

	// Clone a field's <template data-row-template> into its <div data-row-list>
	// (used by "+ Add …" buttons). Rows are otherwise identical, name-wise, to
	// the server-rendered blank trailing row — contact-form.ts zips by DOM
	// order, not by index, so this needs no server support.
	//
	// Scoped to the clicked button's own <form> — the contacts list page keeps
	// both the New-contact and Edit-contact forms mounted at once (the New one
	// stays in the DOM, hidden, so its dialog can open instantly), and both
	// render the same field names, so an unscoped `document.querySelector`
	// would silently grab the OTHER form's (possibly hidden) row list/template.
	const addRow = (btn) => {
		const field = btn.getAttribute("data-add-row");
		if (!field) {
			return;
		}
		const scope = btn.closest("form") ?? document;
		const list = scope.querySelector(`[data-row-list="${field}"]`);
		const tpl = scope.querySelector(`template[data-row-template="${field}"]`);
		if (!(list && tpl instanceof HTMLTemplateElement)) {
			return;
		}
		const clone = tpl.content.cloneNode(true);
		list.appendChild(clone);
		const added = list.lastElementChild;
		if (added) {
			rekeyRelationRow(added);
			// Relation rows carry hx-* attributes for their type-ahead; a cloned
			// node is invisible to htmx until it is told about it.
			getHtmx()?.process?.(added);
		}
		const focusTarget = added?.querySelector("input, select, textarea");
		focusTarget?.focus();
	};

	// --- Relation type-ahead -------------------------------------------------
	// A relation row owns two <datalist>s addressed by id, so a cloned row must
	// be given fresh ids or it would drive (and be driven by) the row it was
	// cloned from.
	let relationRowSeq = 0;
	const rekeyRelationRow = (row) => {
		const input = row.querySelector("[data-relation-input]");
		if (!input) {
			return;
		}
		relationRowSeq += 1;
		const suffix = `c${relationRowSeq}`;
		for (const [selector, attr] of [
			["[data-relation-input]", "list"],
			["input[list^='relation-kinds']", "list"],
		]) {
			const el = row.querySelector(selector);
			const old = el?.getAttribute(attr);
			if (!(el && old)) {
				continue;
			}
			const next = `${old.replace(NUMERIC_SUFFIX, "")}-${suffix}`;
			const dl = row.querySelector(`datalist[id="${old}"]`);
			el.setAttribute(attr, next);
			dl?.setAttribute("id", next);
			if (attr === "list" && el === input) {
				el.setAttribute("hx-target", `#${next}`);
				const vals = JSON.parse(el.getAttribute("hx-vals") ?? "{}");
				vals.list = next;
				el.setAttribute("hx-vals", JSON.stringify(vals));
			}
		}
	};

	// The typed value is what gets submitted; the hidden uid is what turns the
	// entry into a link to another contact. It is set only on an exact match
	// against a suggestion, and cleared as soon as the text diverges — so
	// editing a linked name back to free text stops claiming to be that contact.
	// Suggestions land after the keystroke that asked for them, so a value typed
	// out in full matches nothing at input time. Re-check once they arrive.
	const resyncRelationUids = () => {
		for (const input of document.querySelectorAll("[data-relation-input]")) {
			syncRelationUid(input);
		}
	};

	const syncRelationUid = (input) => {
		const row = input.closest("[data-row-item]");
		const hidden = row?.querySelector("[data-relation-uid]");
		if (!hidden) {
			return;
		}
		const list = byId(input.getAttribute("list") ?? "");
		const match = [...(list?.querySelectorAll("option") ?? [])].find(
			(o) => o.value === input.value,
		);
		hidden.value = match?.getAttribute("data-uid") ?? "";
	};

	// A row's hidden `types` field carries the actual submitted value — the
	// checkboxes + "other" text are unnamed and only ever sync into it.
	const syncTypeHidden = (row) => {
		const hidden = row?.querySelector("[data-type-hidden]");
		if (!hidden) {
			return;
		}
		const checked = [
			...row.querySelectorAll("[data-type-checkbox]:checked"),
		].map((c) => c.value);
		const other = row.querySelector("[data-type-other]");
		const otherTokens = (other?.value ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		hidden.value = [...checked, ...otherTokens].join(",");
	};

	// Same hidden-mirror pattern for the "preferred" checkbox — a plain
	// checkbox omits itself from FormData when unchecked, which would break
	// the positional row zip in contact-form.ts, so the row always submits an
	// explicit `preferred` value via this hidden field instead.
	const syncPreferredHidden = (checkbox) => {
		const row = checkbox.closest("[data-row-item]");
		const hidden = row?.querySelector("[data-preferred-hidden]");
		if (hidden) {
			hidden.value = checkbox.checked ? "on" : "";
		}
	};

	// Radio-like UX over a set of checkboxes: checking one unchecks the rest
	// within the same field's row list (server-side dedupePreferred in
	// contact-form.ts is the real single-PREF-per-group enforcement; this is
	// just UX polish so it doesn't look inconsistent before submit).
	const onPreferredChange = (checkbox) => {
		syncPreferredHidden(checkbox);
		if (!checkbox.checked) {
			return;
		}
		const list = checkbox.closest("[data-row-list]");
		if (!list) {
			return;
		}
		for (const other of list.querySelectorAll("[data-preferred-checkbox]")) {
			if (other !== checkbox && other.checked) {
				other.checked = false;
				syncPreferredHidden(other);
			}
		}
	};

	// Gender: the select and the custom-text input never both carry
	// `name="gender"` at once — whichever is active submits, the other is
	// nameless and hidden. Initial state is decided server-side (form.tsx); this
	// only handles switching between the two after load.
	const genderCustomSentinel = "__custom__";
	const syncGenderMode = (select) => {
		const wrap = select.closest("[data-gender-field]");
		const custom = wrap?.querySelector("[data-gender-custom]");
		if (!custom) {
			return;
		}
		const isCustom = select.value === genderCustomSentinel;
		custom.hidden = !isCustom;
		if (isCustom) {
			select.removeAttribute("name");
			custom.setAttribute("name", "gender");
			custom.focus();
		} else {
			custom.removeAttribute("name");
			select.setAttribute("name", "gender");
		}
	};

	// Display name (FN): "Auto" mode keeps it in sync with Given/Middle/Family
	// name as the user types; "Manual" mode leaves it alone. Initial mode is
	// decided server-side by comparing form.fn to the computed value.
	const computeFn = (form) => {
		const val = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
		return [val("givenName"), val("middleName"), val("familyName")]
			.join(" ")
			.replace(/\s+/gu, " ")
			.trim();
	};
	const setFnAutoMode = (form, auto) => {
		const fnInput = form.querySelector('[name="fn"]');
		const toggle = form.querySelector("[data-fn-mode-toggle]");
		if (!(fnInput && toggle)) {
			return;
		}
		fnInput.readOnly = auto;
		fnInput.classList.toggle("bg-subtle", auto);
		fnInput.classList.toggle("text-muted", auto);
		toggle.setAttribute("aria-pressed", String(auto));
		toggle.textContent = auto ? "Auto" : "Manual";
		if (auto) {
			fnInput.value = computeFn(form);
		} else {
			fnInput.focus();
		}
	};

	document.addEventListener("input", (e) => {
		const t = e.target;
		if (!t || typeof t.closest !== "function") {
			return;
		}
		if (t.matches("[data-type-other]")) {
			syncTypeHidden(t.closest("[data-row-item]"));
			return;
		}
		if (t.matches("[data-relation-input]")) {
			syncRelationUid(t);
			return;
		}
		if (
			t.matches('[name="givenName"], [name="middleName"], [name="familyName"]')
		) {
			const form = t.closest("form");
			const toggle = form?.querySelector("[data-fn-mode-toggle]");
			if (form && toggle?.getAttribute("aria-pressed") === "true") {
				const fnInput = form.querySelector('[name="fn"]');
				if (fnInput) {
					fnInput.value = computeFn(form);
				}
			}
		}
	});

	// Mirror the "select all" box onto every row of its own bulk <form> (the
	// table is gone in the list redesign, so the form is the scope)
	const setAllChecked = (t) => {
		const form = t.closest("form");
		if (!form) {
			return;
		}
		for (const c of form.querySelectorAll("input[name=id]")) {
			c.checked = t.checked;
		}
		updateSelectedCount(form);
	};

	// Refresh the bulk bar's count for the form the control belongs to
	const refreshSelectedCount = (t) => {
		const form = t.closest("form");
		if (form) {
			updateSelectedCount(form);
		}
	};

	// Submit the control's own form, preferring requestSubmit so validation and
	// the submit event still run
	const submitOwningForm = (t) => {
		const form = t.form || t.closest("form");
		if (!form) {
			return;
		}
		if (typeof form.requestSubmit === "function") {
			form.requestSubmit();
			return;
		}
		form.submit();
	};

	// --- Delegated change behaviours -----------------------------------------
	document.addEventListener("change", (e) => {
		const t = e.target;
		if (!t || typeof t.closest !== "function") {
			return;
		}
		if (t.matches("[data-check-all]")) {
			setAllChecked(t);
			return;
		}
		if (t.matches("input[name=id]")) {
			refreshSelectedCount(t);
			return;
		}
		if (t.matches("[data-autosubmit]")) {
			submitOwningForm(t);
			return;
		}
		if (t.matches("[data-type-checkbox]")) {
			syncTypeHidden(t.closest("[data-row-item]"));
			return;
		}
		if (t.matches("[data-preferred-checkbox]")) {
			onPreferredChange(t);
			return;
		}
		if (t.matches("[data-gender-select]")) {
			syncGenderMode(t);
		}
	});

	// The bulk bar's "Clear" is a native <button type=reset>: it unchecks every
	// row on its own; we just refresh the count once the reset has applied.
	document.addEventListener("reset", (e) => {
		const form = e.target;
		if (form instanceof HTMLFormElement) {
			window.setTimeout(() => updateSelectedCount(form), 0);
		}
	});

	// --- Delegated click behaviours ------------------------------------------
	// Row-editing controls inside a contact form. Returns true once it has
	// handled the click.
	const handleRowEditClick = (t) => {
		const addRowBtn = t.closest("[data-add-row]");
		if (addRowBtn) {
			addRow(addRowBtn);
			return true;
		}
		const removeRowBtn = t.closest("[data-remove-row]");
		if (removeRowBtn) {
			removeRowBtn.closest("[data-row-item]")?.remove();
			return true;
		}
		const gramGenderToggle = t.closest("[data-add-gram-gender]");
		if (gramGenderToggle) {
			revealGramGender(gramGenderToggle);
			return true;
		}
		const fnToggle = t.closest("[data-fn-mode-toggle]");
		if (fnToggle) {
			toggleFnMode(fnToggle);
			return true;
		}
		return false;
	};

	// Reveal the grammatical-gender field, scoped to this button's own <form> -
	// see the addRow() comment above for why an unscoped query is unsafe here
	const revealGramGender = (toggle) => {
		toggle.hidden = true;
		const field = toggle
			.closest("form")
			?.querySelector("[data-gram-gender-field]");
		if (!field) {
			return;
		}
		field.hidden = false;
		field.querySelector("select")?.focus();
	};

	// Flip the display-name field between following Given/Middle/Family and manual
	const toggleFnMode = (toggle) => {
		const form = toggle.closest("form");
		if (form) {
			setFnAutoMode(form, toggle.getAttribute("aria-pressed") !== "true");
		}
	};

	// Lazily-loaded dialogs: the trigger is a real link (no-JS follows it to a
	// full page); with JS, htmx loads the fragment into the dialog body and we
	// open the dialog here. Native `commandfor`/`command="show-modal"` handles
	// the inline dialogs.
	const openLazyDialog = (trigger) => {
		const pop = byId(trigger.getAttribute("data-popover"));
		if (pop instanceof HTMLDialogElement && !pop.open) {
			pop.showModal();
		}
	};

	// Navigation-ish controls: each has a real link/behaviour without JS, which
	// this replaces with an in-page dialog, pane or refresh. Returns true once it
	// has handled the click.
	const handleNavClick = (t, e) => {
		// The hover card's Edit button - a real link to the full edit page (no-JS
		// fallback); with JS, hide the hover card and open the real edit dialog
		// instead of navigating.
		const editTrigger = t.closest("[data-edit-contact]");
		if (editTrigger instanceof HTMLAnchorElement) {
			e.preventDefault();
			hideHoverCard();
			openEditDialog(editTrigger.href);
			return true;
		}
		// Contact row body - a real link to the full preview page (no-JS opens it
		// in a new tab); with JS, load it into the preview pane instead.
		const openPaneTrigger = t.closest("[data-open-pane]");
		if (openPaneTrigger instanceof HTMLAnchorElement) {
			e.preventDefault();
			hideHoverCard();
			openPane(openPaneTrigger.href);
			return true;
		}
		const dismiss = t.closest("[data-dismiss-suggestion]");
		if (dismiss) {
			dismiss.closest("[data-suggestion]")?.remove();
			return true;
		}
		if (t.closest("[data-reload]")) {
			location.reload();
			return true;
		}
		return false;
	};

	// The download bar is shown optimistically and hidden again once nothing is
	// in flight, since a download gives no completion event
	const onDownloadClick = () => {
		showBar();
		if (downloadTimer) {
			clearTimeout(downloadTimer);
		}
		downloadTimer = setTimeout(() => {
			if (inFlight === 0) {
				hideBar();
			}
		}, autoHideMs);
	};

	document.addEventListener("click", (e) => {
		const t = e.target;
		if (!t || typeof t.closest !== "function") {
			return;
		}
		if (handleRowEditClick(t)) {
			return;
		}
		const popTrigger = t.closest("[data-popover]");
		if (popTrigger) {
			openLazyDialog(popTrigger);
		}
		if (handleNavClick(t, e)) {
			return;
		}
		if (t.closest("[data-download]")) {
			onDownloadClick();
		}
	});

	// Hover-preview triggers (contact rows) — mouseover/mouseout (not
	// mouseenter/mouseleave, which don't bubble) delegated + relatedTarget-
	// checked so re-entering the same trigger doesn't re-fire.
	document.addEventListener("mouseover", (e) => {
		const t = e.target;
		if (!t || typeof t.closest !== "function") {
			return;
		}
		const trigger = t.closest("[data-hover-preview]");
		if (!trigger?.dataset.hoverPreview) {
			return;
		}
		if (e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget)) {
			return;
		}
		scheduleHoverCardOpen(trigger.dataset.hoverPreview, trigger);
	});
	document.addEventListener("mouseout", (e) => {
		const t = e.target;
		if (!t || typeof t.closest !== "function") {
			return;
		}
		const trigger = t.closest("[data-hover-preview]");
		if (!trigger) {
			return;
		}
		if (e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget)) {
			return;
		}
		scheduleHoverCardClose();
	});

	// Keep the card open while the pointer is over it (so the Edit button is
	// reachable), and let it close once the pointer leaves it.
	const hoverCardEl = byId(hoverCardId);
	hoverCardEl?.addEventListener("mouseenter", clearHoverCloseTimer);
	hoverCardEl?.addEventListener("mouseleave", scheduleHoverCardClose);

	// The hover card is position:fixed and anchored once on open, so it would
	// hang in place while the list scrolls under it. Dismiss it on any scroll
	// (capture phase, since scroll on #contact-list doesn't bubble).
	document.addEventListener("scroll", hideHoverCard, true);

	// --- Bulk-job progress (SSE) ----------------------------------------------
	// Chunked bulk actions (delete/clear-photo/download/export/import/cleanup
	// fix-all) respond with a `#bulk-job-progress` fragment carrying
	// `data-bulk-job-events`. We open an EventSource against it and update the
	// bar/count as frames arrive; on a terminal frame we either reveal a
	// download link (file-producing jobs), reload the page (jobs marked
	// `data-bulk-job-reload`, e.g. cleanup fix-all), or fire `contacts:changed`
	// to refresh the table.
	const startBulkJobListener = (el) => {
		el.setAttribute("data-bulk-job-bound", "");
		const url = el.getAttribute("data-bulk-job-events");
		const resultUrl = el.getAttribute("data-bulk-job-result");
		const label = el.querySelector("[data-bulk-job-label]");
		const count = el.querySelector("[data-bulk-job-count]");
		const barEl = el.querySelector("[data-bulk-job-bar]");
		if (!url || typeof EventSource === "undefined") {
			return;
		}
		const es = new EventSource(url);
		const finish = (ok) => {
			es.close();
			if (label) {
				label.textContent = ok ? "Done" : "Failed";
			}
			if (ok && resultUrl) {
				const a = document.createElement("a");
				a.href = resultUrl;
				a.textContent = "Download ready — click to save";
				a.setAttribute("data-download", "");
				a.className = "link";
				el.appendChild(a);
			} else if (el.hasAttribute("data-bulk-job-reload")) {
				location.reload();
			} else {
				document.body.dispatchEvent(new CustomEvent("contacts:changed"));
			}
		};
		es.onmessage = (evt) => {
			let data;
			try {
				data = JSON.parse(evt.data);
			} catch {
				return;
			}
			if (barEl) {
				bar.max = data.total || 1;
				bar.value = data.done || 0;
			}
			if (count) {
				count.textContent = `${data.done} / ${data.total}`;
			}
			if (data.status === "succeeded" || data.status === "failed") {
				finish(data.status === "succeeded");
			}
		};
		es.onerror = () => {
			es.close();
		};
	};

	const bindBulkJobListeners = () => {
		for (const el of document.querySelectorAll(
			"[data-bulk-job-events]:not([data-bulk-job-bound])",
		)) {
			startBulkJobListener(el);
		}
	};

	document.addEventListener("htmx:after:settle", bindBulkJobListeners);
	document.addEventListener("htmx:after:settle", resyncRelationUids);
	bindBulkJobListeners();

	// --- Modal dialogs (New contact / Find duplicates / Clean up) -------------
	// The sidebar triggers open the dialog natively via `commandfor`/
	// `command="show-modal"` and load their fragment into #contacts-popover-body
	// over HTMX. A successful write emits `contacts:changed` (which also
	// refreshes the list) — use it to close.
	document.body.addEventListener("contacts:changed", () => {
		for (const id of [
			"contacts-popover",
			"new-contact-popover",
			editContactPopoverId,
		]) {
			const pop = byId(id);
			if (pop instanceof HTMLDialogElement && pop.open) {
				pop.close();
			}
		}
		hideHoverCard();
		closePane();
	});
})();
