import type { JSX, VNode } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// Button / LinkButton - typed wrappers over the .btn classes.
//
// `Button` defaults to type="button" so a button dropped inside a form never
// submits it by accident; submits opt in with type="submit". `LinkButton` is
// the same styling on an <a>, for navigation rather than action.
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
	primary: "btn-primary",
	secondary: "btn-secondary",
	danger: "btn-danger",
	ghost: "btn-ghost",
};

// Class string for a button/link styled as a button
export const buttonClass = (
	variant: ButtonVariant = "secondary",
	extra?: string,
): string => cx("btn", VARIANT_CLASS[variant], extra);

export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ButtonSize, string | undefined> = {
	sm: "btn-sm",
	md: undefined,
	lg: "btn-lg",
};

export type ButtonProps = Omit<
	JSX.ButtonHTMLAttributes<HTMLButtonElement>,
	"class" | "type"
> & {
	readonly variant?: ButtonVariant;
	readonly size?: ButtonSize;
	readonly type?: "button" | "submit" | "reset";
	readonly class?: string;
};

export const Button = ({
	variant = "secondary",
	size = "md",
	type = "button",
	class: cls,
	...rest
}: ButtonProps): VNode => (
	<button
		{...rest}
		type={type}
		class={buttonClass(
			variant,
			[SIZE_CLASS[size], cls].filter(Boolean).join(" "),
		)}
	/>
);

export type LinkButtonProps = Omit<
	JSX.AnchorHTMLAttributes<HTMLAnchorElement>,
	"class"
> & {
	readonly href: string;
	readonly variant?: ButtonVariant;
	readonly size?: ButtonSize;
	readonly class?: string;
};

export const LinkButton = ({
	variant = "secondary",
	size = "md",
	class: cls,
	...rest
}: LinkButtonProps): VNode => (
	<a
		{...rest}
		class={buttonClass(
			variant,
			[SIZE_CLASS[size], cls].filter(Boolean).join(" "),
		)}
	/>
);
