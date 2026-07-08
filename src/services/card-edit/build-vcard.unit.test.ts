import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	adrProp,
	bdayValue,
	buildVcardComponent,
	categoriesValue,
	nValue,
	typeParams,
} from "./build-vcard.ts";
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
				{ value: "alice@home.example", types: ["home"], preferred: false },
				{ value: "alice@work.example", types: ["work"], preferred: false },
			],
			tels: [
				{ value: "+1-555-0100", types: ["voice", "cell"], preferred: false },
			],
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
					preferred: false,
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

	it("round-trips per-value LABEL (RFC 9554) on email/tel/adr", () => {
		const form = {
			...emptyContactForm,
			fn: "A",
			emails: [
				{
					value: "a@x.com",
					types: ["home"],
					label: "Personal",
					preferred: false,
				},
			],
			tels: [{ value: "+1", types: ["cell"], label: "Cell", preferred: false }],
		};
		const back = parseVcardToForm(buildVcardComponent("u", form));
		expect(back.emails[0]?.label).toBe("Personal");
		expect(back.tels[0]?.label).toBe("Cell");
	});

	it("round-trips the Phase-2 friendly fields", () => {
		const form = {
			...emptyContactForm,
			fn: "A",
			kind: "individual",
			nickname: "Ace",
			socialProfiles: [{ service: "Mastodon", value: "https://m.example/@a" }],
			impps: [{ service: "Skype", value: "a.b" }],
			anniversary: "2020-01-02",
			gender: "F",
			gramGender: "feminine",
			pronouns: "she/her",
		};
		const back = parseVcardToForm(buildVcardComponent("u", form));
		expect(back.kind).toBe("individual");
		expect(back.nickname).toBe("Ace");
		expect(back.socialProfiles).toEqual([
			{ service: "Mastodon", value: "https://m.example/@a" },
		]);
		expect(back.impps).toEqual([{ service: "Skype", value: "a.b" }]);
		expect(back.anniversary).toBe("2020-01-02");
		expect(back.gender).toBe("F");
		expect(back.gramGender).toBe("feminine");
		expect(back.pronouns).toBe("she/her");
		// friendly fields are not misclassified as generic
		expect(back.otherProps).toEqual([]);
	});

	it("emits a minimal VCARD when only FN is provided", () => {
		const vcard = buildVcardComponent("only-fn", {
			...emptyContactForm,
			fn: "X",
		});
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

	it("emits yearless BDAY (--MMDD) as TEXT, normalised to --MMDD", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["--1224", "--1224"],
			["--12-24", "--1224"],
		];
		for (const [input, expected] of cases) {
			const vcard = buildVcardComponent("yearless", {
				...emptyContactForm,
				fn: "X",
				bday: input,
			});
			const bday = vcard.properties.find((p) => p.name === "BDAY");
			expect(bday?.value).toEqual({ type: "TEXT", value: expected });
		}
	});

	it("drops empty array entries silently", () => {
		const vcard = buildVcardComponent("empties", {
			...emptyContactForm,
			fn: "X",
			emails: [{ value: "", types: ["home"], preferred: false }],
			tels: [{ value: "", types: [], preferred: false }],
			urls: [""],
		});
		const propNames = vcard.properties.map((p) => p.name);
		expect(propNames).not.toContain("EMAIL");
		expect(propNames).not.toContain("TEL");
		expect(propNames).not.toContain("URL");
	});
});

describe("build-vcard exported helpers", () => {
	it("nValue lays out Family;Given;Additional;Prefix;Suffix", () => {
		expect(nValue("Smith", "John", "", "", "")).toBe("Smith;John;;;");
		expect(nValue("Smith", "John", "Q", "Dr.", "Jr.")).toBe(
			"Smith;John;Q;Dr.;Jr.",
		);
	});

	it("typeParams emits one comma-joined TYPE or none", () => {
		expect(typeParams([])).toEqual([]);
		expect(typeParams(["home", "work"])).toEqual([
			{ name: "TYPE", value: "home,work" },
		]);
	});

	it("adrProp joins the 7 components in order", () => {
		expect(
			adrProp({
				poBox: "",
				extended: "",
				street: "1 St",
				locality: "Town",
				region: "",
				postalCode: "ZZ1",
				country: "UK",
				types: [],
				preferred: false,
			}).value,
		).toEqual({ type: "TEXT", value: ";;1 St;Town;;ZZ1;UK" });
	});

	it("bdayValue: full → DATE, yearless → TEXT, junk → null", () => {
		expect(bdayValue("1990-07-04")).toMatchObject({ type: "DATE" });
		expect(bdayValue("--07-04")).toEqual({ type: "TEXT", value: "--0704" });
		expect(bdayValue("nonsense")).toBeNull();
		expect(bdayValue("")).toBeNull();
	});

	it("categoriesValue trims and drops blanks", () => {
		expect(categoriesValue(" a, b ,, c ")).toEqual(["a", "b", "c"]);
		expect(categoriesValue("")).toEqual([]);
	});
});
