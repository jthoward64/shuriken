// Shuriken UI progressive-enhancement script. Served from /static/ui.js and
// loaded (render-blocking) in <head> so the theme is applied before first paint.
// No build step — plain browser JS. Keep it tiny.

(() => {
	// Mark the document as script-enabled before first paint (this file is
	// render-blocking in <head>). CSS keys `[data-nojs-only]` controls off the
	// absence of this class, so no-JS fallback buttons (e.g. the calendar
	// Switch/Upload submits, redundant once JS auto-submits) hide with no flash.
	document.documentElement.classList.add("js");

	// --- Theme: apply persisted (or system) preference before paint. ---------
	// JS users get an explicit .dark/.light class so the effective theme is
	// unambiguous; no-JS users fall back to prefers-color-scheme in the CSS.
	try {
		const stored = localStorage.getItem("theme");
		const systemDark = window.matchMedia(
			"(prefers-color-scheme: dark)",
		).matches;
		const dark = stored ? stored === "dark" : systemDark;
		document.documentElement.classList.add(dark ? "dark" : "light");
	} catch {
		// localStorage/matchMedia unavailable — CSS media query still applies.
	}

	const toggleTheme = () => {
		const el = document.documentElement;
		const dark = el.classList.contains("dark");
		el.classList.remove("dark", "light");
		el.classList.add(dark ? "light" : "dark");
		try {
			localStorage.setItem("theme", dark ? "light" : "dark");
		} catch {
			// Persisting the choice is best-effort.
		}
	};

	// Delegated so it works for any [data-theme-toggle] control on the page.
	document.addEventListener("click", (e) => {
		if (e.target.closest("[data-theme-toggle]")) {
			toggleTheme();
		}
	});

	// --- Dropdown menus (<details class="menu">) -----------------------------
	// Close on outside-click and keep only one open at a time. Menus still
	// open/close on their own without this.
	document.addEventListener("click", (e) => {
		for (const d of document.querySelectorAll("details.menu[open]")) {
			if (!d.contains(e.target)) {
				d.removeAttribute("open");
			}
		}
	});
	document.addEventListener(
		"toggle",
		(e) => {
			const t = e.target;
			if (t.tagName === "DETAILS" && t.classList.contains("menu") && t.open) {
				for (const d of document.querySelectorAll("details.menu[open]")) {
					if (d !== t) {
						d.removeAttribute("open");
					}
				}
			}
		},
		true,
	);

	// --- Confirm destructive submits (form[data-confirm]) --------------------
	// Capture phase so we can veto the submit before HTMX's own bubble-phase
	// handler fires an ajax request. No-JS users submit without a prompt (the
	// server still performs the action), which is an acceptable degradation.
	document.addEventListener(
		"submit",
		(e) => {
			const form = e.target.closest("form[data-confirm]");
			if (form && !window.confirm(form.getAttribute("data-confirm"))) {
				e.preventDefault();
				e.stopImmediatePropagation();
			}
		},
		true,
	);

	// --- Confirm before discarding an edited dialog form ----------------------
	// All modals are native <dialog>s opened with showModal(), which already
	// makes the rest of the page inert — no background click-through to guard
	// against. If a field inside one was touched, confirm before it closes.
	// Every dismissal path (Escape, `command="request-close"` Cancel/close
	// buttons, `dialog.requestClose()`) funnels through the dialog's `cancel`
	// event, which — unlike `beforetoggle` — *is* cancelable on close. `command=
	// "close"` and a successful submit bypass `cancel` entirely (unconditional),
	// which is what we want for a completed save.
	const dirtyDialogs = new WeakSet();
	document.addEventListener("input", (e) => {
		const dialog = e.target instanceof Element && e.target.closest("dialog");
		if (dialog) {
			dirtyDialogs.add(dialog);
		}
	});
	document.addEventListener(
		"submit",
		(e) => {
			const dialog = e.target instanceof Element && e.target.closest("dialog");
			if (dialog) {
				dirtyDialogs.delete(dialog);
			}
		},
		true,
	);
	document.addEventListener(
		"beforetoggle",
		(e) => {
			if (e.target instanceof HTMLDialogElement && e.newState === "open") {
				dirtyDialogs.delete(e.target);
			}
		},
		true,
	);
	document.addEventListener(
		"cancel",
		(e) => {
			const dialog = e.target;
			if (
				dialog instanceof HTMLDialogElement &&
				dirtyDialogs.has(dialog) &&
				!window.confirm("Discard unsaved changes?")
			) {
				e.preventDefault();
			} else if (dialog instanceof HTMLDialogElement) {
				dirtyDialogs.delete(dialog);
			}
		},
		true,
	);

	// --- Copy-to-clipboard ([data-copy]) -------------------------------------
	// Enhancement over already-selectable text: write the button's data-copy
	// value to the clipboard, then briefly swap its idle/done spans. No-JS users
	// still select + copy the text manually.
	const copyFeedbackMs = 1500;
	document.addEventListener("click", (e) => {
		const btn = e.target.closest("[data-copy]");
		if (!btn || !navigator.clipboard) {
			return;
		}
		navigator.clipboard
			.writeText(btn.getAttribute("data-copy") || "")
			.then(() => {
				const idle = btn.querySelector(".copy-idle");
				const done = btn.querySelector(".copy-done");
				if (!idle || !done) {
					return;
				}
				idle.hidden = true;
				done.hidden = false;
				window.setTimeout(() => {
					idle.hidden = false;
					done.hidden = true;
				}, copyFeedbackMs);
			})
			.catch(() => {
				// Clipboard write can reject (permissions / insecure context); the
				// text remains selectable as a fallback.
			});
	});
})();
