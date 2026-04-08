import { Effect, ParseResult, Schema } from "effect";
import {
	type ContentLine,
	ContentLineSchema,
	ContentLinesCodec,
} from "./content-line.ts";

// ---------------------------------------------------------------------------
// RawComponent — structurally parsed but properties not yet type-inferred
//
// This is the stack-based BEGIN:/END: layer shared by both iCalendar and vCard.
// Properties remain as ContentLines here; format-specific value-type inference
// is applied by the format codec on top.
// ---------------------------------------------------------------------------

export interface RawComponent {
	readonly name: string;
	readonly contentLines: ReadonlyArray<ContentLine>;
	readonly children: ReadonlyArray<RawComponent>;
}

export const RawComponentSchema: Schema.Schema<RawComponent> = Schema.Struct({
	name: Schema.String,
	contentLines: Schema.Array(ContentLineSchema),
	children: Schema.Array(Schema.suspend(() => RawComponentSchema)),
});

// ---------------------------------------------------------------------------
// Parsing helpers (pure — throw on error)
// ---------------------------------------------------------------------------

interface MutableComponent {
	name: string;
	contentLines: Array<ContentLine>;
	children: Array<MutableComponent>;
}

/**
 * Drive a stack to convert a flat ContentLine sequence into a RawComponent tree.
 * BEGIN:X pushes a new frame; END:X pops and attaches it to the parent.
 * Throws a descriptive string on structural errors.
 */
const buildTree = (lines: ReadonlyArray<ContentLine>): RawComponent => {
	const stack: Array<MutableComponent> = [];
	let root: RawComponent | null = null;

	for (const line of lines) {
		if (line.name === "BEGIN") {
			const componentName = line.rawValue.toUpperCase();
			stack.push({ name: componentName, contentLines: [], children: [] });
		} else if (line.name === "END") {
			const componentName = line.rawValue.toUpperCase();
			const top = stack.pop();
			if (top === undefined) {
				throw new Error(`Unexpected END:${componentName} — no open component`);
			}
			if (top.name !== componentName) {
				throw new Error(
					`Mismatched END: expected END:${top.name} but got END:${componentName}`,
				);
			}
			if (stack.length === 0) {
				if (root !== null) {
					throw new Error(
						`Multiple root components: found a second root "${componentName}" after "${root.name}"`,
					);
				}
				root = top;
			} else {
				(stack.at(-1) as MutableComponent).children.push(top);
			}
		} else {
			const current = stack.at(-1);
			if (current === undefined) {
				throw new Error(
					`Property "${line.name}" appears outside any component`,
				);
			}
			current.contentLines.push(line);
		}
	}

	if (stack.length > 0) {
		const unclosed = stack.map((c) => c.name).join(", ");
		throw new Error(`Unclosed components at end of input: ${unclosed}`);
	}
	if (root === null) {
		throw new Error("No root component found — input is empty or has no BEGIN");
	}

	return root;
};

/**
 * Flatten a RawComponent tree back to a ContentLine sequence.
 * Emits BEGIN:name, the component's own contentLines, all children
 * (recursively), then END:name.
 */
const flattenTree = (component: RawComponent): Array<ContentLine> => [
	{ name: "BEGIN", params: [], rawValue: component.name },
	...component.contentLines,
	...component.children.flatMap(flattenTree),
	{ name: "END", params: [], rawValue: component.name },
];

// ---------------------------------------------------------------------------
// RawComponentCodec
//
// Schema<RawComponent, ReadonlyArray<ContentLine>>
//   decode: ReadonlyArray<ContentLine> → RawComponent
//   encode: RawComponent → ReadonlyArray<ContentLine>
// ---------------------------------------------------------------------------

export const RawComponentCodec: Schema.Schema<
	RawComponent,
	ReadonlyArray<ContentLine>
> = Schema.transformOrFail(
	Schema.Array(ContentLineSchema),
	RawComponentSchema,
	{
		strict: true,
		decode: (lines, _options, ast) =>
			Effect.try({
				try: () => buildTree(lines),
				catch: (e) => new ParseResult.Type(ast, lines, String(e)),
			}),
		encode: (component, _options, ast) =>
			Effect.try({
				try: () => flattenTree(component),
				catch: (e) => new ParseResult.Type(ast, component, String(e)),
			}),
	},
);

// ---------------------------------------------------------------------------
// TextToRawComponentCodec
//
// Convenience composition: Schema<RawComponent, string>
// Composes ContentLinesCodec → RawComponentCodec so format codecs can build
// on top of a single string-to-tree stage.
// ---------------------------------------------------------------------------

export const TextToRawComponentCodec: Schema.Schema<RawComponent, string> =
	ContentLinesCodec.pipe(Schema.compose(RawComponentCodec));
