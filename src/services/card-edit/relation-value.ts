import type { ContactRelationTarget } from "./types.ts";

// ---------------------------------------------------------------------------
// The RELATED value ↔ the editor's target union.
//
// RFC 6350 §6.6.6 gives RELATED a single URI value, resettable to text. Three
// shapes matter to the UI, and each renders differently:
//
//   urn:uuid:<uid>   a contact on this server → a link to it
//   mailto:<addr>    an email address         → a mailto: link
//   anything else    a person's name          → plain text
//
// Parsing happens once, here, so no view has to re-sniff a raw string.
// ---------------------------------------------------------------------------

const UUID_URN_PREFIX = "urn:uuid:";
const MAILTO_PREFIX = "mailto:";

// Deliberately loose: enough to tell "the user typed an address" from "the user
// typed a name", not a validity check on the address itself.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** Classify a stored RELATED value. */
export const relationTargetFromValue = (
	value: string,
): ContactRelationTarget => {
	const trimmed = value.trim();
	if (trimmed.toLowerCase().startsWith(UUID_URN_PREFIX)) {
		return { kind: "contact", uid: trimmed };
	}
	if (trimmed.toLowerCase().startsWith(MAILTO_PREFIX)) {
		return { kind: "email", address: trimmed.slice(MAILTO_PREFIX.length) };
	}
	return { kind: "text" };
};

/** The RELATED value for a target — the inverse of `relationTargetFromValue`. */
export const relationValueFromTarget = (
	target: ContactRelationTarget,
	name: string,
): string => {
	switch (target.kind) {
		case "contact":
			return target.uid;
		case "email":
			return `${MAILTO_PREFIX}${target.address}`;
		case "text":
			return name;
	}
};

/**
 * Classify what a user typed into the relation's value box. A picked contact
 * arrives as its own field (the type-ahead writes the uid there), so this only
 * has to separate an address from a name.
 */
export const relationTargetFromInput = (
	raw: string,
	uid: string,
): ContactRelationTarget => {
	const trimmedUid = uid.trim();
	if (trimmedUid !== "") {
		return {
			kind: "contact",
			uid: trimmedUid.toLowerCase().startsWith(UUID_URN_PREFIX)
				? trimmedUid
				: `${UUID_URN_PREFIX}${trimmedUid}`,
		};
	}
	const trimmed = raw.trim();
	const address = trimmed.toLowerCase().startsWith(MAILTO_PREFIX)
		? trimmed.slice(MAILTO_PREFIX.length)
		: trimmed;
	return LOOKS_LIKE_EMAIL.test(address)
		? { kind: "email", address }
		: { kind: "text" };
};
