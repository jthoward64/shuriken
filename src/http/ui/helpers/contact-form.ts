import type {
	ContactAddress,
	ContactFormData,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { emptyContactForm } from "#src/services/card-edit/types.ts";

// Bun's Request.formData() returns its own FormData-shaped object that
// doesn't structurally equal the DOM lib's FormData. The helpers below only
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

const buildTypedValues = (
	form: FormLike,
	field: string,
): ReadonlyArray<ContactTypedValue> => {
	const values = stringsFor(form, `${field}[].value`);
	const types = stringsFor(form, `${field}[].types`);
	const out: Array<ContactTypedValue> = [];
	for (let i = 0; i < values.length; i++) {
		const value = (values[i] ?? "").trim();
		const typesRaw = (types[i] ?? "").trim();
		const typeList = typesRaw
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t !== "");
		out.push({ value, types: typeList });
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
		out.push(row as unknown as ContactAddress);
	}
	return out;
};

export const parseContactForm = (form: FormLike): ContactFormData => {
	const single = (key: string) =>
		(form.get(key)?.toString() ?? "").trim();
	const urls = stringsFor(form, "urls[]")
		.map((u) => u.trim());
	return {
		...emptyContactForm,
		fn: single("fn"),
		familyName: single("familyName"),
		givenName: single("givenName"),
		emails: buildTypedValues(form, "emails"),
		tels: buildTypedValues(form, "tels"),
		urls,
		addresses: buildAddresses(form),
		bday: single("bday"),
		org: single("org"),
		title: single("title"),
		note: single("note"),
		categoriesCsv: single("categoriesCsv"),
		photo: single("photo"),
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
