import {
	type CountryCode,
	parsePhoneNumberFromString,
} from "libphonenumber-js";
import { digitsOf } from "./fields.ts";

// ---------------------------------------------------------------------------
// Phone normalisation — the single place libphonenumber-js is used. Everything
// is region-relative: a bare national number is interpreted using the default
// region the user picked on the cleanup page.
// ---------------------------------------------------------------------------

/**
 * Canonical E.164 form of a phone number, or null when it cannot be parsed to a
 * valid number under `region`. Used to detect reformatting suggestions.
 */
// A bare national number shorter than this (US: 7 digits without area code)
// with no country code is treated as "missing an area code".
const MIN_NATIONAL_DIGITS = 4;
const MAX_NATIONAL_DIGITS = 8;

export const normalizePhone = (
	current: string,
	region: string,
): string | null => {
	const parsed = parsePhoneNumberFromString(current, region as CountryCode);
	if (!parsed?.isValid()) {
		return null;
	}
	return parsed.number;
};

/**
 * True when a value looks like a national number missing its area code: it has
 * digits but is too short to be valid, and carries no explicit country code.
 * Such numbers cannot be auto-fixed — the UI must prompt for the area code.
 */
export const looksMissingAreaCode = (
	current: string,
	region: string,
): boolean => {
	if (current.trim().startsWith("+")) {
		return false;
	}
	if (normalizePhone(current, region) !== null) {
		return false;
	}
	const len = digitsOf(current).length;
	return len >= MIN_NATIONAL_DIGITS && len <= MAX_NATIONAL_DIGITS;
};

/**
 * Prepend an area code to a local number and normalise to E.164, or null when
 * the combination still isn't valid under `region`.
 */
export const applyAreaCode = (
	current: string,
	areaCode: string,
	region: string,
): string | null => {
	const national = digitsOf(areaCode) + digitsOf(current);
	return normalizePhone(national, region);
};
