import type { ComponentChildren, VNode } from "preact";
import { photoSrcFor } from "#src/http/ui/helpers/contact-photo.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactServiceValue,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { Button, LinkButton } from "../../components/button.tsx";
import { Badge } from "../../components/display.tsx";
import { IconChevronLeft, IconEdit } from "../../components/icons.tsx";
import { RelationList, type ResolvedRelation } from "./relations.tsx";

// ---------------------------------------------------------------------------
// Contact preview pane — a read-only view of every populated contact field.
//
// Rendered three ways by contactsPreviewHandler:
//   - as a fragment swapped into `#contacts-pane-body` (desktop split column /
//     mobile slide-over), driven by contacts.js on a row click;
//   - as a full standalone page (the no-JS "open in new tab" fallback).
// The compact hover card (hover-card.tsx) is a separate, smaller preview.
//
// Strictly read-only: it renders no named form inputs, so it never pollutes
// the `closest("form")` queries the mounted New/Edit forms rely on.
// ---------------------------------------------------------------------------

export const CONTACTS_PANE_ID = "contacts-pane";
export const CONTACTS_PANE_BODY_ID = "contacts-pane-body";

// Preference is the single canonical `preferred` flag (parse-vcard folds any
// legacy `TYPE=pref` into it and strips the token), so `types` never carries `pref`.
const typeLabels = (types: ReadonlyArray<string>): string => types.join(", ");

const PreferredBadge = (): VNode => (
	<Badge tone="brand" class="shrink-0">
		Preferred
	</Badge>
);

// A titled group, rendered only when it has content.
const PaneSection = ({
	title,
	children,
}: {
	title: string;
	children: ComponentChildren;
}): VNode => (
	<section class="space-y-1.5">
		<h3 class="font-semibold text-subtle text-xs uppercase tracking-wider">
			{title}
		</h3>
		{children}
	</section>
);

// A single label/value line for scalar fields.
const DetailRow = ({
	label,
	value,
}: {
	label: string;
	value: string;
}): VNode => (
	<div class="flex items-baseline justify-between gap-3">
		<span class="shrink-0 text-muted text-sm">{label}</span>
		<span class="min-w-0 break-words text-right text-fg text-sm">{value}</span>
	</div>
);

const TypedValueList = ({
	values,
	href,
}: {
	values: ReadonlyArray<ContactTypedValue>;
	/** Build an href (mailto:/tel:) for the value, or omit for plain text. */
	href?: (value: string) => string;
}): VNode => (
	<ul class="space-y-1.5">
		{values.map((v, i) => {
			const labels = typeLabels(v.types) || v.label || "";
			return (
				<li key={`${v.value}-${i}`} class="flex items-center gap-2">
					<div class="min-w-0 flex-1">
						{href ? (
							<a href={href(v.value)} class="link break-words text-sm">
								{v.value}
							</a>
						) : (
							<span class="break-words text-fg text-sm">{v.value}</span>
						)}
						{labels !== "" && (
							<span class="ml-2 text-subtle text-xs">{labels}</span>
						)}
					</div>
					{v.preferred ? <PreferredBadge /> : null}
				</li>
			);
		})}
	</ul>
);

const AddressList = ({
	addresses,
}: {
	addresses: ReadonlyArray<ContactAddress>;
}): VNode => (
	<ul class="space-y-2">
		{addresses.map((a, i) => {
			const lines = [
				a.poBox,
				a.extended,
				a.street,
				[a.locality, a.region, a.postalCode].filter((s) => s !== "").join(" "),
				a.country,
			].filter((s) => s.trim() !== "");
			const labels = typeLabels(a.types) || a.label || "";
			return (
				<li key={i} class="flex items-start gap-2">
					<address class="min-w-0 flex-1 text-fg text-sm not-italic">
						{lines.map((line, j) => (
							<div key={j} class="break-words">
								{line}
							</div>
						))}
						{labels !== "" && <div class="text-subtle text-xs">{labels}</div>}
					</address>
					{a.preferred ? <PreferredBadge /> : null}
				</li>
			);
		})}
	</ul>
);

const ServiceList = ({
	values,
}: {
	values: ReadonlyArray<ContactServiceValue>;
}): VNode => (
	<ul class="space-y-1.5">
		{values.map((v, i) => (
			<li key={`${v.value}-${i}`} class="flex items-baseline gap-2 text-sm">
				{v.service !== "" && (
					<span class="shrink-0 text-muted">{v.service}</span>
				)}
				<span class="min-w-0 break-words text-fg">{v.value}</span>
			</li>
		))}
	</ul>
);

// The structured-name line, shown only when it adds detail beyond FN.
const fullName = (form: ContactFormData): string =>
	[form.prefix, form.givenName, form.middleName, form.familyName, form.suffix]
		.map((s) => s.trim())
		.filter((s) => s !== "")
		.join(" ");

export const ContactPreviewPane = ({
	form,
	instanceId,
	relations = [],
	standalone = false,
}: {
	form: ContactFormData;
	instanceId: string;
	/** Relations with their UID targets already resolved to links. */
	relations?: ReadonlyArray<ResolvedRelation>;
	/** True for the no-JS full-page render (Back links to the list instead of
	 * closing an overlay). */
	standalone?: boolean;
}): VNode => {
	const editHref = `/ui/contacts/${instanceId}`;
	const photoSrc = photoSrcFor(form.photo, instanceId);
	const orgLine = [form.title, form.org]
		.filter((s) => s.trim() !== "")
		.join(", ");
	const structured = fullName(form);
	const dates = [
		form.bday !== "" ? { label: "Birthday", value: form.bday } : undefined,
		form.anniversary !== ""
			? { label: "Anniversary", value: form.anniversary }
			: undefined,
	].filter((d): d is { label: string; value: string } => d !== undefined);
	const identity = [
		form.nickname !== ""
			? { label: "Nickname", value: form.nickname }
			: undefined,
		structured !== "" && structured !== form.fn.trim()
			? { label: "Name", value: structured }
			: undefined,
		form.pronouns !== ""
			? { label: "Pronouns", value: form.pronouns }
			: undefined,
		form.gender !== "" ? { label: "Gender", value: form.gender } : undefined,
		form.kind !== "" ? { label: "Kind", value: form.kind } : undefined,
	].filter((d): d is { label: string; value: string } => d !== undefined);
	const categories = form.categoriesCsv
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");

	// Back control: on the standalone page it returns to the list (all sizes);
	// in the pane it closes the overlay and is only needed on mobile (desktop
	// keeps the pane open beside the list).
	const backBar = standalone ? (
		<div class="mb-3">
			<LinkButton href="/ui/contacts" variant="ghost" size="sm">
				<IconChevronLeft class="size-4" />
				Back
			</LinkButton>
		</div>
	) : (
		<div class="mb-3 lg:hidden">
			<Button
				variant="ghost"
				size="sm"
				popovertarget={CONTACTS_PANE_ID}
				popovertargetaction="hide"
				aria-label="Close preview"
			>
				<IconChevronLeft class="size-4" />
				Back
			</Button>
		</div>
	);

	return (
		<div class="flex h-full min-h-0 flex-col">
			{backBar}
			<div class="min-h-0 flex-1 space-y-5 overflow-y-auto">
				<div class="flex items-start gap-3">
					{photoSrc !== "" ? (
						<img
							src={photoSrc}
							alt=""
							loading="lazy"
							class="size-16 shrink-0 rounded-full bg-surface-2 object-cover"
						/>
					) : (
						<span
							class="flex size-16 shrink-0 items-center justify-center rounded-full bg-surface-2 font-medium text-muted text-xl"
							aria-hidden="true"
						>
							{(form.fn.trim().charAt(0) || "?").toUpperCase()}
						</span>
					)}
					<div class="min-w-0 flex-1">
						<h2 class="break-words font-semibold text-fg text-lg">
							{form.fn || "(no name)"}
						</h2>
						{orgLine !== "" && (
							<p class="break-words text-muted text-sm">{orgLine}</p>
						)}
					</div>
					<LinkButton
						href={editHref}
						size="sm"
						data-edit-contact
						class="shrink-0"
					>
						<IconEdit class="size-4" />
						Edit
					</LinkButton>
				</div>

				{form.emails.length > 0 && (
					<PaneSection title="Email">
						<TypedValueList values={form.emails} href={(v) => `mailto:${v}`} />
					</PaneSection>
				)}
				{form.tels.length > 0 && (
					<PaneSection title="Phone">
						<TypedValueList values={form.tels} href={(v) => `tel:${v}`} />
					</PaneSection>
				)}
				{form.addresses.length > 0 && (
					<PaneSection title="Address">
						<AddressList addresses={form.addresses} />
					</PaneSection>
				)}
				{form.urls.length > 0 && (
					<PaneSection title="Websites">
						<ul class="space-y-1.5">
							{form.urls.map((u, i) => (
								<li key={`${u}-${i}`}>
									<a
										href={u}
										target="_blank"
										rel="noopener"
										class="link break-words text-sm"
									>
										{u}
									</a>
								</li>
							))}
						</ul>
					</PaneSection>
				)}
				{form.socialProfiles.length > 0 && (
					<PaneSection title="Social">
						<ServiceList values={form.socialProfiles} />
					</PaneSection>
				)}
				{form.impps.length > 0 && (
					<PaneSection title="Instant messaging">
						<ServiceList values={form.impps} />
					</PaneSection>
				)}
				{relations.length > 0 && (
					<PaneSection title="Related people">
						<RelationList relations={relations} />
					</PaneSection>
				)}
				{dates.length > 0 && (
					<PaneSection title="Dates">
						{dates.map((d) => (
							<DetailRow key={d.label} label={d.label} value={d.value} />
						))}
					</PaneSection>
				)}
				{identity.length > 0 && (
					<PaneSection title="Details">
						{identity.map((d) => (
							<DetailRow key={d.label} label={d.label} value={d.value} />
						))}
					</PaneSection>
				)}
				{categories.length > 0 && (
					<PaneSection title="Categories">
						<div class="flex flex-wrap gap-1.5">
							{categories.map((c) => (
								<Badge key={c}>{c}</Badge>
							))}
						</div>
					</PaneSection>
				)}
				{form.note !== "" && (
					<PaneSection title="Note">
						<p class="whitespace-pre-wrap break-words text-fg text-sm">
							{form.note}
						</p>
					</PaneSection>
				)}
				{form.otherProps.length > 0 && (
					<PaneSection title="Other">
						<ul class="space-y-1.5">
							{form.otherProps.map((p, i) => (
								<li
									key={`${p.name}-${i}`}
									class="flex items-baseline gap-2 text-sm"
								>
									<span class="shrink-0 font-mono text-muted text-xs">
										{p.name}
									</span>
									<span class="min-w-0 break-words text-fg">{p.value}</span>
								</li>
							))}
						</ul>
					</PaneSection>
				)}
			</div>
		</div>
	);
};

// The pane shell rendered once on the list page — a popover (`popover="auto"`)
// so a backdrop click / Escape dismisses it natively. contacts.js opens it via
// showPopover() on a row click and swaps the preview into its body.
export const ContactsPaneContainer = (): VNode => (
	<dialog
		id={CONTACTS_PANE_ID}
		popover="auto"
		aria-label="Contact preview"
		class="contacts-pane"
	>
		<div
			id={CONTACTS_PANE_BODY_ID}
			class="contacts-pane-panel card card-pad h-full"
		>
			<PanePlaceholder />
		</div>
	</dialog>
);

// Empty state shown in the desktop pane before a contact is selected.
export const PanePlaceholder = (): VNode => (
	<div class="flex h-full items-center justify-center p-6 text-center text-muted text-sm">
		Select a contact to preview.
	</div>
);
