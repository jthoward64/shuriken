import type { VNode } from "preact";
import { Badge, Card } from "#src/http/ui/view/components/display.tsx";

// ---------------------------------------------------------------------------
// Echo panel for the component gallery - shows exactly what the server parsed
// out of the gallery form, so each control's wire format is visible rather
// than assumed.
// ---------------------------------------------------------------------------

export interface ComponentEchoData {
	readonly tags: ReadonlyArray<string>;
	readonly altTags: ReadonlyArray<string>;
	readonly dueDate: string;
	readonly startsAt: string;
	readonly rangeStart: string;
	readonly rangeEnd: string;
	readonly shiftStart: string;
	readonly shiftEnd: string;
	readonly principalSlug: string;
	/** Sanitized markup, empty on the unscripted path. */
	readonly descriptionHtml: string;
	readonly descriptionText: string;
	/** Whether the editor's HTML field arrived, i.e. whether the script ran. */
	readonly scripted: boolean;
}

const Value = ({ children }: { children: string }): VNode =>
	children === "" ? (
		<span class="text-subtle italic">empty</span>
	) : (
		<code class="rounded bg-surface-2 px-1 text-xs">{children}</code>
	);

const Line = ({
	field,
	children,
}: {
	field: string;
	children: preact.ComponentChildren;
}): VNode => (
	<div class="flex flex-wrap items-baseline gap-2 py-1">
		<span class="w-40 shrink-0 font-medium text-muted text-xs">{field}</span>
		<span class="text-fg text-sm">{children}</span>
	</div>
);

const TagList = ({ tags }: { tags: ReadonlyArray<string> }): VNode =>
	tags.length === 0 ? (
		<span class="text-subtle italic">no tags</span>
	) : (
		<span class="flex flex-wrap gap-1">
			{tags.map((t) => (
				<Badge key={t}>{t}</Badge>
			))}
		</span>
	);

export const ComponentEchoPanel = ({
	data,
}: {
	data: ComponentEchoData;
}): VNode => (
	<Card
		class="space-y-4"
		title="What the server received"
		actions={
			<Badge tone={data.scripted ? "brand" : "neutral"}>
				{data.scripted ? "scripted path" : "no-JS path"}
			</Badge>
		}
	>
		<div class="divide-y divide-line">
			<Line field="categoriesCsv">
				<TagList tags={data.tags} />
			</Line>
			<Line field="altCategoriesCsv">
				<TagList tags={data.altTags} />
			</Line>
			<Line field="dueDate">
				<Value>{data.dueDate}</Value>
			</Line>
			<Line field="startsAt">
				<Value>{data.startsAt}</Value>
			</Line>
			<Line field="rangeStart / rangeEnd">
				<Value>{data.rangeStart}</Value> <Value>{data.rangeEnd}</Value>
			</Line>
			<Line field="shiftStart / shiftEnd">
				<Value>{data.shiftStart}</Value> <Value>{data.shiftEnd}</Value>
			</Line>
			<Line field="principalSlug">
				<Value>{data.principalSlug}</Value>
			</Line>
			<Line field="descriptionHtml">
				<Value>{data.descriptionHtml}</Value>
			</Line>
			<Line field="description">
				{data.descriptionText === "" ? (
					<span class="text-subtle italic">empty</span>
				) : (
					<pre class="whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">
						{data.descriptionText}
					</pre>
				)}
			</Line>
		</div>

		{data.descriptionHtml !== "" && (
			<div class="space-y-1">
				<p class="font-medium text-muted text-xs">Sanitized markup, rendered</p>
				<div
					class="rich-content rounded border border-line p-3 text-sm"
					dangerouslySetInnerHTML={{
						// biome-ignore lint/style/useNamingConvention: preact's own prop name
						__html: data.descriptionHtml,
					}}
				/>
			</div>
		)}
	</Card>
);
