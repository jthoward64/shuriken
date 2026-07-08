// ---------------------------------------------------------------------------
// CardDAV / vCard types
// ---------------------------------------------------------------------------

/** vCard specification version */
export type VCardVersion = "3.0" | "4.0";

/** Content-Type values for vCard resources */
export type AddressContentType =
	| "text/vcard"
	| "text/vcard; charset=utf-8"
	| "text/vcard;version=3.0"
	| "text/vcard;version=4.0";
