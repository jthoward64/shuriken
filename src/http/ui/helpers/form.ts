import { Data, Effect } from "effect";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";

// ---------------------------------------------------------------------------
// FormValidationError — carries field-keyed validation messages
// ---------------------------------------------------------------------------

export class FormValidationError extends Data.TaggedError(
	"FormValidationError",
)<{
	readonly fields: ReadonlyMap<string, string>;
}> {}

const fail = (field: string, message: string) =>
	Effect.fail(new FormValidationError({ fields: new Map([[field, message]]) }));

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

export const parseSlug = (
	value: string | undefined,
	field = "slug",
): Effect.Effect<Slug, FormValidationError> => {
	const v = value?.trim();
	if (!v) {
		return fail(field, "Slug is required");
	}
	if (!/^[a-z0-9-]+$/.test(v)) {
		return fail(
			field,
			"Slug may only contain lowercase letters, digits, and hyphens",
		);
	}
	return Effect.succeed(v as Slug);
};

export const parseEmail = (
	value: string | undefined,
	field = "email",
): Effect.Effect<Email, FormValidationError> => {
	const v = value?.trim();
	if (!v) {
		return fail(field, "Email is required");
	}
	if (!v.includes("@")) {
		return fail(field, "Invalid email address");
	}
	return Effect.succeed(v as Email);
};

export const parseDisplayName = (
	value: string | undefined,
	field = "displayName",
): Effect.Effect<string, FormValidationError> => {
	const v = value?.trim();
	if (!v) {
		return fail(field, "Display name is required");
	}
	return Effect.succeed(v);
};

export const parseOptionalDisplayName = (
	value: string | undefined,
): Effect.Effect<string | undefined, never> =>
	Effect.succeed(value?.trim() || undefined);

const MIN_PASSWORD_LENGTH = 8;

export const parsePassword = (
	value: string | undefined,
	field = "newPassword",
): Effect.Effect<string, FormValidationError> => {
	const v = value;
	if (!v || v.length < MIN_PASSWORD_LENGTH) {
		return fail(field, "Password must be at least 8 characters");
	}
	return Effect.succeed(v);
};

/** Convert a FormValidationError to a field-keyed plain object for templates. */
export const validationErrorToContext = (
	err: FormValidationError,
): Record<string, string> => Object.fromEntries(err.fields);
