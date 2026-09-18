import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { Select } from "../form/select.tsx";
import { DateField } from "./date-picker.tsx";
import { RichTextField } from "./rich-text.tsx";
import { SearchPicker } from "./search-picker.tsx";
import { TagCombobox } from "./tag-combobox.tsx";
import { TagPicker } from "./tag-picker.tsx";

// These assert the markup contracts the controls' fallbacks depend on: which
// element carries the submitted name, which is disabled, and which native
// attributes survive. Built with `h` rather than JSX so this stays a `.ts`
// file, which is what the *.unit.test.ts glob matches.

describe("Select", () => {
	it("emits the customizable-select trigger", () => {
		const html = render(
			h(Select, { name: "priority", options: [{ value: "a", label: "A" }] }),
		);
		expect(html).toContain('<button type="button"><selectedcontent>');
	});

	it("gives a rich option a label attribute for the native fallback", () => {
		const html = render(
			h(Select, {
				name: "priority",
				options: [
					{ value: "high", label: "High", description: "Today", icon: "!" },
				],
			}),
		);
		// Without this, a native dropdown would show "!HighToday" run together
		expect(html).toContain('label="High"');
		expect(html).toContain("select-option-desc");
	});

	it("leaves a plain option as plain text with no label attribute", () => {
		const html = render(
			h(Select, { name: "p", options: [{ value: "a", label: "A" }] }),
		);
		expect(html).toContain('<option value="a">A</option>');
	});

	it("marks the matching option selected", () => {
		const html = render(
			h(Select, {
				name: "p",
				value: "b",
				options: [
					{ value: "a", label: "A" },
					{ value: "b", label: "B" },
				],
			}),
		);
		expect(html).toContain('<option value="b" selected>B</option>');
	});
});

describe("TagPicker", () => {
	it("submits the tags as one CSV field", () => {
		const html = render(
			h(TagPicker, {
				id: "t",
				name: "categoriesCsv",
				value: ["Work", "Home"],
			}),
		);
		expect(html).toContain('name="categoriesCsv"');
		expect(html).toContain('value="Work, Home"');
	});

	it("renders the current tags as chips up front", () => {
		const html = render(
			h(TagPicker, { id: "t", name: "categoriesCsv", value: ["Work"] }),
		);
		expect(html).toContain('data-tag="Work"');
	});

	it("leaves the add dropdown unnamed so it submits nothing of its own", () => {
		const html = render(
			h(TagPicker, {
				id: "t",
				name: "categoriesCsv",
				value: [],
				suggestions: ["Work"],
			}),
		);
		const select = html.slice(html.indexOf("<select"));
		expect(select.slice(0, select.indexOf(">"))).not.toContain("name=");
	});
});

describe("TagCombobox", () => {
	const html = render(
		h(TagCombobox, {
			id: "t",
			name: "categoriesCsv",
			value: ["Work", "Home"],
			suggestions: ["Work", "Home", "Travel"],
			allowCustom: true,
		}),
	);

	it("submits the tags as one CSV field, same contract as TagPicker", () => {
		expect(html).toContain('name="categoriesCsv"');
		expect(html).toContain('value="Work, Home"');
	});

	it("renders the current tags as tokens inside the box", () => {
		const box = html.slice(html.indexOf("tag-combobox-box"));
		expect(box).toContain('data-tag="Work"');
		expect(box).toContain('data-tag="Home"');
		// The entry must follow the tokens, so the cursor sits after them
		expect(box.indexOf('data-tag="Home"')).toBeLessThan(
			box.indexOf("data-tag-entry"),
		);
	});

	it("carries the suggestions as JSON rather than an inline script", () => {
		expect(html).toContain("data-suggestions=");
		expect(html).not.toContain("<script");
	});

	it("gives the entry its own id so the label can be repointed to it", () => {
		expect(html).toContain('id="t-entry"');
		expect(html).toContain('id="t-listbox"');
	});

	it("falls back to a plain CSV text input without JavaScript", () => {
		// The CSV input is the control when the script is absent: it carries the
		// field name, the current value, and is the half that stays visible
		const csv = html.slice(
			html.indexOf("<input"),
			html.indexOf("tag-combobox-ui"),
		);
		expect(csv).toContain('name="categoriesCsv"');
		expect(csv).toContain('value="Work, Home"');
		expect(csv).toContain("data-nojs-only");
		// and the enhanced half is the one that disappears
		expect(html).toContain("data-js-only");
	});

	it("never submits the entry field itself", () => {
		// The entry is a scratch field inside the box; only the CSV input has a
		// name, so the scripted and unscripted paths post identical form data
		const entry = html.slice(html.indexOf("data-tag-entry") - 300);
		const tag = entry.slice(0, entry.indexOf(">"));
		expect(tag).not.toContain("name=");
	});

	it("marks free entry with a flag rather than a value", () => {
		const without = render(h(TagCombobox, { id: "t", name: "c", value: [] }));
		expect(html).toContain("data-allow-custom");
		expect(without).not.toContain("data-allow-custom");
	});
});

describe("TagPicker", () => {
	it("offers no Add button, since the script commits on Enter", () => {
		const html = render(
			h(TagPicker, {
				id: "t",
				name: "categoriesCsv",
				value: [],
				suggestions: ["Work"],
				allowCustom: true,
			}),
		);
		expect(html).not.toContain("data-tag-add-custom");
		expect(html).toContain("data-tag-custom");
	});
});

describe("DateField", () => {
	it("uses the native date type with a pattern fallback", () => {
		const html = render(h(DateField, { id: "d", name: "due" }));
		expect(html).toContain('type="date"');
		// Applies only when the browser drops the element into text state
		expect(html).toContain('pattern="\\d{4}-\\d{2}-\\d{2}"');
	});

	it("uses datetime-local in datetime mode", () => {
		const html = render(
			h(DateField, { id: "d", name: "start", mode: "datetime" }),
		);
		expect(html).toContain('type="datetime-local"');
		expect(html).toContain('pattern="\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}"');
	});
});

describe("SearchPicker", () => {
	it("is a plain named text input carrying the endpoint as data", () => {
		const html = render(
			h(SearchPicker, {
				id: "s",
				name: "principalSlug",
				endpoint: "/lookup",
				value: "ada",
			}),
		);
		expect(html).toContain('type="text"');
		expect(html).toContain('name="principalSlug"');
		expect(html).toContain('value="ada"');
		expect(html).toContain('data-endpoint="/lookup"');
	});
});

describe("RichTextField", () => {
	const html = render(
		h(RichTextField, {
			id: "r",
			name: "description",
			valueHtml: "<p>hi</p>",
			valueText: "hi",
		}),
	);

	it("submits plain text from the textarea on the unscripted path", () => {
		expect(html).toContain('name="description"');
		expect(html).toContain("<textarea");
	});

	it("keeps both hidden fields disabled until the script enables them", () => {
		// Otherwise two controls named "description" would submit at once.
		// Rendered without values so escaped markup cannot confuse the match.
		const bare = render(h(RichTextField, { id: "r", name: "description" }));
		const hidden = bare.match(/<input type="hidden"[^>]*>/gu) ?? [];
		expect(hidden.length).toBe(2);
		for (const input of hidden) {
			expect(input).toContain("disabled");
		}
	});

	it("names the markup field after the plain one by default", () => {
		expect(html).toContain('name="descriptionHtml"');
	});

	it("loads the stored markup into the editing surface", () => {
		expect(html).toContain("<p>hi</p>");
	});
});
