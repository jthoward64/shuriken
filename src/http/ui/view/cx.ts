// Tiny class-name joiner for JSX views. Filters out falsy entries so callers can
// write `cx("btn", active && "is-active")` without stray "false" strings.
export const cx = (
	...parts: ReadonlyArray<string | false | null | undefined>
): string => parts.filter((p): p is string => Boolean(p)).join(" ");
