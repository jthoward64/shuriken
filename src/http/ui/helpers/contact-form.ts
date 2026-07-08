import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactServiceValue,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { emptyContactForm } from "#src/services/card-edit/types.ts";

// Request.formData() return types can vary by runtime / lib config, so we
// depend only on a structural subset (`get`/`getAll`). The helpers below only
// rely on the subset we actually use.
interface FormLike {
	get(key: string): unknown;
	getAll(key: string): ReadonlyArray<unknown>;
}

const PHOTO_BYTES_PER_KB = 1024;
const PHOTO_MAX_KB = 512;

// ---------------------------------------------------------------------------
// Parse a FormData payload posted by the contact form into ContactFormData.
//
// The browser submits repeated fields as `emails[].value=…`, `emails[].types=…`,
// etc. The arrays line up by index (FormData preserves insertion order). Same
// for `tels[]`, `urls[]`, and the structured `addresses[].field` shape.
//
// Empty inputs are kept in the array; build-vcard.ts drops them on the way
// out so the user can leave blank rows in the UI without producing empty
// EMAIL/TEL/URL properties.
// ---------------------------------------------------------------------------

const stringsFor = (form: FormLike, key: string): ReadonlyArray<string> =>
	form.getAll(key).map((v) => (typeof v === "string" ? v : ""));

/** Keep `preferred: true` on only the first such row; force the rest false. */
const dedupePreferred = <T extends { readonly preferred: boolean }>(
	rows: ReadonlyArray<T>,
): ReadonlyArray<T> => {
	let seen = false;
	return rows.map((row) => {
		if (!row.preferred) {
			return row;
		}
		if (seen) {
			return { ...row, preferred: false };
		}
		seen = true;
		return row;
	});
};

const buildTypedValues = (
	form: FormLike,
	field: string,
): ReadonlyArray<ContactTypedValue> => {
	const values = stringsFor(form, `${field}[].value`);
	const types = stringsFor(form, `${field}[].types`);
	const labels = stringsFor(form, `${field}[].label`);
	const preferred = stringsFor(form, `${field}[].preferred`);
	const out: Array<ContactTypedValue> = [];
	for (let i = 0; i < values.length; i++) {
		const value = (values[i] ?? "").trim();
		const typesRaw = (types[i] ?? "").trim();
		const typeList = typesRaw
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
		out.push({
			value,
			types: typeList,
			label: (labels[i] ?? "").trim(),
			preferred: (preferred[i] ?? "") !== "",
		});
	}
	return dedupePreferred(out);
};

const buildServiceValues = (
	form: FormLike,
	field: string,
): ReadonlyArray<ContactServiceValue> => {
	const services = stringsFor(form, `${field}[].service`);
	const values = stringsFor(form, `${field}[].value`);
	const out: Array<ContactServiceValue> = [];
	for (let i = 0; i < values.length; i++) {
		out.push({
			service: (services[i] ?? "").trim(),
			value: (values[i] ?? "").trim(),
		});
	}
	return out;
};

const buildOtherProps = (form: FormLike): ReadonlyArray<ContactOtherProp> => {
	const names = stringsFor(form, "other[].name");
	const groups = stringsFor(form, "other[].group");
	const values = stringsFor(form, "other[].value");
	const params = stringsFor(form, "other[].params");
	const out: Array<ContactOtherProp> = [];
	for (let i = 0; i < names.length; i++) {
		out.push({
			name: (names[i] ?? "").trim(),
			group: (groups[i] ?? "").trim(),
			value: (values[i] ?? "").trim(),
			params: (params[i] ?? "").trim(),
		});
	}
	return out;
};

const buildAddresses = (form: FormLike): ReadonlyArray<ContactAddress> => {
	const fields: ReadonlyArray<keyof ContactAddress> = [
		"poBox",
		"extended",
		"street",
		"locality",
		"region",
		"postalCode",
		"country",
	];
	// Use street as the canonical row marker — every address row exposes a
	// street input, even when blank.
	const streets = stringsFor(form, "addresses[].street");
	const preferred = stringsFor(form, "addresses[].preferred");
	const out: Array<ContactAddress> = [];
	for (let i = 0; i < streets.length; i++) {
		const row: Record<string, unknown> = {};
		for (const f of fields) {
			const all = stringsFor(form, `addresses[].${f}`);
			row[f] = (all[i] ?? "").trim();
		}
		const typesRaw = (stringsFor(form, "addresses[].types")[i] ?? "").trim();
		row.types = typesRaw
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
		row.label = (stringsFor(form, "addresses[].label")[i] ?? "").trim();
		row.preferred = (preferred[i] ?? "") !== "";
		out.push(row as unknown as ContactAddress);
	}
	return dedupePreferred(out);
};

export const parseContactForm = (form: FormLike): ContactFormData => {
	const single = (key: string) => (form.get(key)?.toString() ?? "").trim();
	const urls = stringsFor(form, "urls[]").map((u) => u.trim());
	return {
		...emptyContactForm,
		kind: single("kind"),
		fn: single("fn"),
		familyName: single("familyName"),
		givenName: single("givenName"),
		middleName: single("middleName"),
		prefix: single("prefix"),
		suffix: single("suffix"),
		nickname: single("nickname"),
		emails: buildTypedValues(form, "emails"),
		tels: buildTypedValues(form, "tels"),
		urls,
		addresses: buildAddresses(form),
		socialProfiles: buildServiceValues(form, "social"),
		impps: buildServiceValues(form, "impp"),
		bday: single("bday"),
		anniversary: single("anniversary"),
		gender: single("gender"),
		gramGender: single("gramGender"),
		pronouns: single("pronouns"),
		org: single("org"),
		title: single("title"),
		note: single("note"),
		categoriesCsv: single("categoriesCsv"),
		photo: single("photo"),
		otherProps: buildOtherProps(form),
	};
};

// ---------------------------------------------------------------------------
// Photo upload helper — when the multipart form ships a non-empty `photoFile`,
// inline it as a data URI on the form so build-vcard.ts emits PHOTO: data:…
// directly. Returns the form unchanged when no file was provided.
// ---------------------------------------------------------------------------

const MAX_PHOTO_BYTES = PHOTO_MAX_KB * PHOTO_BYTES_PER_KB;

export const applyPhotoUpload = async (
	form: FormLike,
	current: ContactFormData,
): Promise<ContactFormData> => {
	const file = form.get("photoFile");
	if (!(file instanceof File) || file.size === 0) {
		return current;
	}
	if (file.size > MAX_PHOTO_BYTES) {
		// Silently drop oversize uploads — UI-side validation should also
		// preempt this. The vCard PHOTO data URI explodes payload size, so we
		// cap server-side to protect the DB row.
		return current;
	}
	const buffer = await file.arrayBuffer();
	const base64 = btoa(
		new Uint8Array(buffer).reduce((acc, b) => acc + String.fromCharCode(b), ""),
	);
	const mime = file.type !== "" ? file.type : "application/octet-stream";
	return { ...current, photo: `data:${mime};base64,${base64}` };
};
