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
	/** Display `TYPE=` tokens (e.g. "home", "work"); never contains `pref`. Empty = none. */
	readonly types: ReadonlyArray<string>;
	/** Optional free-text `LABEL=` parameter (RFC 9554 §4.5). */
	readonly label?: string;
	/** Sole preference channel — highest-preference marker (`PREF=1`, RFC 6350 §5.3). The
	 * underlying numeric `PREF` ranking lives in storage, not this UI model. */
	readonly preferred: boolean;
}

export interface ContactTypedValue {
	readonly value: string;
	/** Display `TYPE=` tokens; never contains `pref` (preference is the `preferred` flag). */
	readonly types: ReadonlyArray<string>;
	/** Optional free-text `LABEL=` parameter (RFC 9554 §4.5). */
	readonly label?: string;
	/** Sole preference channel — highest-preference marker (`PREF=1`, RFC 6350 §5.3). The
	 * underlying numeric `PREF` ranking lives in storage, not this UI model. */
	readonly preferred: boolean;
}

/**
 * A value tagged with an online-service name — SOCIALPROFILE / IMPP, where the
 * service is carried in the `SERVICE-TYPE` parameter (RFC 9554 §4.9).
 */
export interface ContactServiceValue {
	readonly service: string;
	readonly value: string;
}

export interface ContactFormData {
	readonly kind: string;
	readonly fn: string;
	/** Family name (N.0) */
	readonly familyName: string;
	/** Given name (N.1) */
	readonly givenName: string;
	/** Additional/middle names (N.2) */
	readonly middleName: string;
	/** Honorific prefix, e.g. "Dr." (N.3) */
	readonly prefix: string;
	/** Honorific suffix, e.g. "Jr." (N.4) */
	readonly suffix: string;
	readonly nickname: string;
	readonly emails: ReadonlyArray<ContactTypedValue>;
	readonly tels: ReadonlyArray<ContactTypedValue>;
	readonly urls: ReadonlyArray<string>;
	readonly addresses: ReadonlyArray<ContactAddress>;
	readonly socialProfiles: ReadonlyArray<ContactServiceValue>;
	readonly impps: ReadonlyArray<ContactServiceValue>;
	/** ISO date string ("YYYY-MM-DD") or empty. */
	readonly bday: string;
	/** ISO date string or empty (ANNIVERSARY). */
	readonly anniversary: string;
	/** GENDER value (sex component: M/F/O/N/U or free text). */
	readonly gender: string;
	/** GRAMGENDER enum: animate/common/feminine/inanimate/masculine/neuter. */
	readonly gramGender: string;
	readonly pronouns: string;
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
	/**
	 * Every other (non-friendly, non-metadata) property, editable raw: name,
	 * optional group prefix, value, and its parameters serialised as
	 * `NAME=value;NAME=value`. Covers RFC 6350/9554 tail + arbitrary X-.
	 */
	readonly otherProps: ReadonlyArray<ContactOtherProp>;
}

export interface ContactOtherProp {
	readonly name: string;
	readonly group: string;
	readonly value: string;
	/** `NAME=value;NAME=value` — every parameter, round-tripped. */
	readonly params: string;
}

/** Empty form scaffold used by the "new contact" page. */
export const emptyContactForm: ContactFormData = {
	kind: "",
	fn: "",
	familyName: "",
	givenName: "",
	middleName: "",
	prefix: "",
	suffix: "",
	nickname: "",
	emails: [],
	tels: [],
	urls: [],
	addresses: [],
	socialProfiles: [],
	impps: [],
	bday: "",
	anniversary: "",
	gender: "",
	gramGender: "",
	pronouns: "",
	org: "",
	title: "",
	note: "",
	categoriesCsv: "",
	photo: "",
	otherProps: [],
};
