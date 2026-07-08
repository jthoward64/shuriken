// ---------------------------------------------------------------------------
// Region options for the contact-cleanup page. The code is an ISO 3166-1
// alpha-2 country used as the default region for phone-number parsing
// (libphonenumber-js `CountryCode`). Kept intentionally small — a common
// subset — since the user only needs the region their contacts' bare national
// numbers belong to.
// ---------------------------------------------------------------------------

export interface RegionOption {
	readonly code: string;
	readonly name: string;
}

export const REGION_OPTIONS: ReadonlyArray<RegionOption> = [
	{ code: "US", name: "United States" },
	{ code: "CA", name: "Canada" },
	{ code: "GB", name: "United Kingdom" },
	{ code: "IE", name: "Ireland" },
	{ code: "AU", name: "Australia" },
	{ code: "NZ", name: "New Zealand" },
	{ code: "DE", name: "Germany" },
	{ code: "FR", name: "France" },
	{ code: "ES", name: "Spain" },
	{ code: "IT", name: "Italy" },
	{ code: "NL", name: "Netherlands" },
	{ code: "SE", name: "Sweden" },
	{ code: "IN", name: "India" },
	{ code: "JP", name: "Japan" },
	{ code: "BR", name: "Brazil" },
	{ code: "ZA", name: "South Africa" },
];

export const DEFAULT_REGION = "US";
