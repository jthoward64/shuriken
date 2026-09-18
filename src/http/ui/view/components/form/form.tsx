import type { ComponentChildren, JSX, VNode } from "preact";
import { cx } from "../cx.ts";

// ---------------------------------------------------------------------------
// Form controls - typed wrappers over the .form-* classes in styles/input.css.
//
// Each control passes unrecognized props straight through to the underlying
// element, so anything native (required, minlength, autocomplete, hx-*) keeps
// working without the wrapper having to know about it. `Field` owns the
// label/hint/error furniture so those three are laid out and wired to the
// control's id identically everywhere.
// ---------------------------------------------------------------------------

export interface FieldProps {
	/** Must match the id of the control inside, for label association. */
	readonly for: string;
	readonly label: string;
	/** Guidance shown under the control. */
	readonly hint?: string;
	/** Validation message; replaces the hint and marks the control invalid. */
	readonly error?: string;
	readonly required?: boolean;
	readonly class?: string;
	readonly children: ComponentChildren;
}

/** Label + control + hint/error, wired together by id */
export const Field = ({
	for: htmlFor,
	label,
	hint,
	error,
	required = false,
	class: cls,
	children,
}: FieldProps): VNode => {
	const message = error ?? hint;
	const describedBy =
		error !== undefined ? `${htmlFor}-error` : `${htmlFor}-hint`;
	return (
		<div class={cx("form-group", cls)}>
			<label for={htmlFor} class="form-label">
				{label}
				{required && (
					<span class="ml-0.5 text-danger" aria-hidden="true">
						*
					</span>
				)}
			</label>
			{children}
			{message !== undefined && (
				<p
					id={describedBy}
					class={error !== undefined ? "form-error" : "form-hint"}
					role={error !== undefined ? "alert" : undefined}
				>
					{message}
				</p>
			)}
		</div>
	);
};

/**
 * Input types this wraps. "date" is the plain native picker, for a field that
 * wants nothing more than that; `controls/date-picker.tsx`'s DateField is the
 * scripted alternative. Checkbox and file have their own controls.
 */
export type TextInputType =
	| "text"
	| "email"
	| "url"
	| "tel"
	| "password"
	| "number"
	| "search"
	| "date";

export type TextInputProps = Omit<
	JSX.InputHTMLAttributes<HTMLInputElement>,
	"class" | "type"
> & {
	readonly type?: TextInputType;
	readonly class?: string;
	/** Renders the invalid styling; pair with the matching `Field` error. */
	readonly invalid?: boolean;
};

export const TextInput = ({
	type = "text",
	class: cls,
	invalid = false,
	...rest
}: TextInputProps): VNode => (
	<input
		{...rest}
		type={type}
		aria-invalid={invalid ? "true" : undefined}
		class={cx("form-input", cls)}
	/>
);

export type TextareaProps = Omit<
	JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
	"class"
> & {
	readonly class?: string;
	readonly invalid?: boolean;
};

export const Textarea = ({
	class: cls,
	invalid = false,
	rows = 3,
	...rest
}: TextareaProps): VNode => (
	<textarea
		{...rest}
		rows={rows}
		aria-invalid={invalid ? "true" : undefined}
		class={cx("form-textarea", cls)}
	/>
);

export type CheckboxProps = Omit<
	JSX.InputHTMLAttributes<HTMLInputElement>,
	"class" | "type"
> & {
	readonly id: string;
	readonly label: string;
	/** Secondary line under the label. */
	readonly hint?: string;
	readonly class?: string;
};

/** Checkbox with its label and optional hint, as one clickable row */
export const Checkbox = ({
	id,
	label,
	hint,
	class: cls,
	...rest
}: CheckboxProps): VNode => (
	<div class={cx("form-check", cls)}>
		<input {...rest} id={id} type="checkbox" class="form-check-input" />
		<div class="form-check-text">
			<label for={id} class="form-check-label">
				{label}
			</label>
			{hint !== undefined && <p class="form-hint">{hint}</p>}
		</div>
	</div>
);

export type FileInputProps = Omit<
	JSX.InputHTMLAttributes<HTMLInputElement>,
	"class" | "type"
> & {
	readonly class?: string;
};

export const FileInput = ({ class: cls, ...rest }: FileInputProps): VNode => (
	<input {...rest} type="file" class={cx("form-file", cls)} />
);

// Validation-error summary. Rendered as an HTMX fragment on failed form posts;
// returns an empty fragment when there is nothing to show. `errors` is the
// field-keyed message map produced by `validationErrorToContext`.
export const FormErrors = ({ errors }: { errors: Record<string, string> }) => {
	const messages = Object.values(errors);
	if (messages.length === 0) {
		return null;
	}
	return (
		<div
			role="alert"
			class="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-danger text-sm"
		>
			<p class="mb-1 font-medium">Please correct the following errors:</p>
			<ul class="list-inside list-disc space-y-0.5">
				{messages.map((m) => (
					<li key={m}>{m}</li>
				))}
			</ul>
		</div>
	);
};
