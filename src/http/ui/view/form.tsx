import type { ComponentChildren, JSX, VNode } from "preact";
import { cx } from "./cx.ts";

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
			{error !== undefined ? (
				<p id={describedBy} class="form-error" role="alert">
					{error}
				</p>
			) : (
				hint !== undefined && (
					<p id={describedBy} class="form-hint">
						{hint}
					</p>
				)
			)}
		</div>
	);
};

/** Input types that take free text; date/checkbox/file have their own controls. */
export type TextInputType =
	| "text"
	| "email"
	| "url"
	| "tel"
	| "password"
	| "number"
	| "search";

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
