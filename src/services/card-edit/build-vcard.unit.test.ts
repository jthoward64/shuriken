import { describe, expect, it } from "bun:test";
import { buildVcardComponent } from "./build-vcard.ts";
import { parseVcardToForm } from "./parse-vcard.ts";
import { emptyContactForm } from "./types.ts";

describe("buildVcardComponent / parseVcardToForm round-trip", () => {
	it("preserves a fully-populated form", () => {
		const form = {
			...emptyContactForm,
			fn: "Alice Smith",
			familyName: "Smith",
			givenName: "Alice",
			emails: [
				{ value: "alice@home.example", types: ["home"] },
				{ value: "alice@work.example", types: ["work"] },
			],
			tels: [{ value: "+1-555-0100", types: ["voice", "cell"] }],
			urls: ["https://alice.example"],
			addresses: [
				{
					poBox: "",
					extended: "Suite 5",
					street: "1 Main St",
					locality: "Portland",
					region: "OR",
					postalCode: "97201",
					country: "USA",
					types: ["home"],
				},
			],
			bday: "1985-04-12",
			org: "Acme",
			title: "Engineer",
			note: "Met at conference",
			categoriesCsv: "friend, conference",
			photo: "https://example.com/alice.jpg",
		};
		const vcard = buildVcardComponent("alice-uid", form);
		const back = parseVcardToForm(vcard);
		expect(back.fn).toBe(form.fn);
		expect(back.familyName).toBe(form.familyName);
		expect(back.givenName).toBe(form.givenName);
		expect(back.emails).toEqual(form.emails);
		expect(back.tels).toEqual(form.tels);
		expect(back.urls).toEqual(form.urls);
		expect(back.addresses).toEqual(form.addresses);
		expect(back.bday).toBe(form.bday);
		expect(back.org).toBe(form.org);
		expect(back.title).toBe(form.title);
		expect(back.note).toBe(form.note);
		// CSV normalises whitespace after each comma.
		expect(back.categoriesCsv).toBe("friend, conference");
		expect(back.photo).toBe(form.photo);
	});

	it("emits a minimal VCARD when only FN is provided", () => {
		const vcard = buildVcardComponent("only-fn", { ...emptyContactForm, fn: "X" });
		const names = vcard.properties.map((p) => p.name).sort();
		expect(names).toEqual(["FN", "UID", "VERSION"]);
	});

	it("ignores malformed BDAY", () => {
		const vcard = buildVcardComponent("bad-bday", {
			...emptyContactForm,
			fn: "X",
			bday: "not-a-date",
		});
		expect(vcard.properties.find((p) => p.name === "BDAY")).toBeUndefined();
	});

	it("drops empty array entries silently", () => {
		const vcard = buildVcardComponent("empties", {
			...emptyContactForm,
			fn: "X",
			emails: [{ value: "", types: ["home"] }],
			tels: [{ value: "", types: [] }],
			urls: [""],
		});
		const propNames = vcard.properties.map((p) => p.name);
		expect(propNames).not.toContain("EMAIL");
		expect(propNames).not.toContain("TEL");
		expect(propNames).not.toContain("URL");
	});
});
