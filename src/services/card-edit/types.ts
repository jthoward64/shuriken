// ---------------------------------------------------------------------------
// ContactFormData — UI-shaped fields a contact form posts to the server.
// `build-vcard.ts` is the single converter between this shape and an
// IrComponent VCARD; `parse-vcard.ts` does the reverse for edit-page
// pre-population. Keeping a discrete UI shape means the form handler never
// touches IR directly.
// ---------------------------------------------------------------------------

export interface ContactAddress {
	readonly poBox: string;
	readonly extended: string;
	readonly street: string;
	readonly locality: string;
	readonly region: string;
	readonly postalCode: string;
	readonly country: string;
	/** Optional `TYPE=` parameter values (e.g. "home", "work"). Empty = none. */
	readonly types: ReadonlyArray<string>;
}

export interface ContactTypedValue {
	readonly value: string;
	readonly types: ReadonlyArray<string>;
}

export interface ContactFormData {
	readonly fn: string;
	/** Family name (N.0) */
	readonly familyName: string;
	/** Given name (N.1) */
	readonly givenName: string;
	readonly emails: ReadonlyArray<ContactTypedValue>;
	readonly tels: ReadonlyArray<ContactTypedValue>;
	readonly urls: ReadonlyArray<string>;
	readonly addresses: ReadonlyArray<ContactAddress>;
	/** ISO date string ("YYYY-MM-DD") or empty. */
	readonly bday: string;
	readonly org: string;
	readonly title: string;
	readonly note: string;
	/** Comma-separated user input; persisted as a TEXT_LIST CATEGORIES. */
	readonly categoriesCsv: string;
	/**
	 * PHOTO value — either an http(s) URL or a data: URI carrying inline
	 * base64. Empty string means no photo.
	 */
	readonly photo: string;
}

/** Empty form scaffold used by the "new contact" page. */
export const emptyContactForm: ContactFormData = {
	fn: "",
	familyName: "",
	givenName: "",
	emails: [],
	tels: [],
	urls: [],
	addresses: [],
	bday: "",
	org: "",
	title: "",
	note: "",
	categoriesCsv: "",
	photo: "",
};
