import type { IrValueType } from "../ir.ts";

// ---------------------------------------------------------------------------
// vCard property default-type lookup (RFC 6350 §5)
//
// Keys are uppercase property names. Using a Map avoids naming-convention lint
// issues with ALL_CAPS keys in object literals.
// ---------------------------------------------------------------------------

export const VCARD_DEFAULT_TYPES = new Map<string, IrValueType>([
	// General
	["VERSION", "TEXT"],
	["SOURCE", "URI"],
	["KIND", "TEXT"],
	["XML", "TEXT"],
	// Identification
	["FN", "TEXT"],
	["N", "TEXT"], // structured name: Surname;Given;Additional;Prefix;Suffix
	["NICKNAME", "TEXT_LIST"],
	["PHOTO", "URI"],
	["BDAY", "DATE_AND_OR_TIME"],
	["ANNIVERSARY", "DATE_AND_OR_TIME"],
	["GENDER", "TEXT"],
	// Delivery addressing
	["ADR", "TEXT"],
	// Communications
	["TEL", "TEXT"],
	["EMAIL", "TEXT"],
	["IMPP", "URI"],
	["LANG", "TEXT"],
	// Geographical
	["TZ", "TEXT"],
	["GEO", "URI"],
	// Organizational
	["TITLE", "TEXT"],
	["ROLE", "TEXT"],
	["LOGO", "URI"],
	["ORG", "TEXT"],
	["MEMBER", "URI"],
	["RELATED", "URI"],
	// Explanatory
	["CATEGORIES", "TEXT_LIST"],
	["NOTE", "TEXT"],
	["PRODID", "TEXT"],
	["REV", "DATE_AND_OR_TIME"],
	["SOUND", "URI"],
	["UID", "URI"],
	["CLIENTPIDMAP", "TEXT"],
	["URL", "URI"],
	// Security / Calendar
	["KEY", "URI"],
	["FBURL", "URI"],
	["CALADRURI", "URI"],
	["CALURI", "URI"],
]);

/**
 * Returns true if the property name is a known vCard property (RFC 6350 §5).
 * Returns false for X- prefixed and unrecognized IANA properties.
 * Derived at runtime so that newly added entries automatically become "known".
 */
export const isKnownVcardProperty = (name: string): boolean =>
	VCARD_DEFAULT_TYPES.has(name);
