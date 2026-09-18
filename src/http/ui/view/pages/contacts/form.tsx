// biome-ignore-all lint/suspicious/noArrayIndexKey: these repeated vCard properties have no id, and the markup is rendered once server-side with nothing to reconcile
import type { ComponentChildren, VNode } from "preact";
import {
	isInlinePhoto,
	photoSrcFor,
} from "#src/http/ui/helpers/contact-photo.ts";
import { encodeJson } from "#src/http/ui/helpers/json.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactRelation,
	ContactServiceValue,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { Button, LinkButton } from "../../components/button.tsx";
import { cx } from "../../components/cx.ts";
import { Alert, Card } from "../../components/display.tsx";
import {
	FileInput,
	Textarea,
	TextInput,
	type TextInputType,
} from "../../components/form/form.tsx";
import { Select } from "../../components/form/select.tsx";
import { CONTACTS_POPOVER_ID, ContactsPopoverHeader } from "./popover.tsx";
import { RELATION_NAME_FIELD, relationOptionsFor } from "./relations.tsx";
import { ContactsCrumb } from "./shared.tsx";

// ---------------------------------------------------------------------------
// Contact form — shared by the "new" and "edit" pages. A faithful port of the
// old Handlebars form onto the design-system form/card classes. The repeated
// value groups (emails, phones, addresses, …) each render as a "row list":
// existing rows + one blank trailing row, a <template> blank row for JS-driven
// cloning, and an "+ Add" button. The blank trailing row is marked
// `data-nojs-only` (input.css: `html.js [data-nojs-only] { display: none }`)
// so it's the no-JS fallback (submitting drops blank rows server-side, see
// contact-form.ts) but stays invisible once JS is active — JS users add rows
// only via "+ Add". Every row also carries a JS-only "Remove" button
// (contacts.js, event-delegated so it also works on rows added after load and
// inside the HTMX edit-dialog popover).
//
// The single-input helpers (TextField/SelectField/TextareaField) keep their
// <input>/<select>/<textarea> as a direct child of the <label> so the label is
// always associated with its control (both for real accessibility and static
// analysis).
// ---------------------------------------------------------------------------

const NOTE_ROWS = 3;

export interface ContactFormPageProps {
	readonly pageTitle: string;
	readonly mode: "new" | "edit";
	readonly addressbookId: string;
	readonly form: ContactFormData;
	readonly action: string;
	/** Present only in edit mode — used to stream an embedded photo. */
	readonly instanceId?: string;
	/** Present only in edit mode — the delete endpoint. */
	readonly deleteAction?: string;
	readonly errors?: ReadonlyArray<string>;
	/** "page" (default) renders a standalone page; "popover" renders the form for
	 * a modal popover (header instead of breadcrumb, HTMX submit that refreshes
	 * the list + closes on success). */
	readonly variant?: "page" | "popover";
	/** The popover this form lives in (for the header close + Cancel). */
	readonly popoverId?: string;
}

const KIND_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "", label: "(unspecified)" },
	{ value: "individual", label: "Individual" },
	{ value: "group", label: "Group" },
	{ value: "org", label: "Organisation" },
	{ value: "location", label: "Location" },
];

// Standard vCard GENDER (RFC 6350 §6.2.7) sex-component values — everything
// else is treated as custom free text via the "Custom / other…" branch.
const STANDARD_GENDER_VALUES: ReadonlySet<string> = new Set([
	"",
	"M",
	"F",
	"O",
	"N",
	"U",
]);
const GENDER_CUSTOM_SENTINEL = "__custom__";

const GENDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "", label: "(unspecified)" },
	{ value: "F", label: "Female" },
	{ value: "M", label: "Male" },
	{ value: "O", label: "Other" },
	{ value: "N", label: "Not applicable" },
	{ value: "U", label: "Unknown" },
	{ value: GENDER_CUSTOM_SENTINEL, label: "Custom / other…" },
];

// GRAMGENDER (RFC 9554 §4.7) doesn't map onto English, so the values need an
// example to mean anything to most users; the wire values themselves are
// fixed by the spec and can't be renamed.
const GRAM_GENDER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "", label: "(unspecified)" },
	{ value: "masculine", label: 'Masculine (e.g. Spanish "él")' },
	{ value: "feminine", label: 'Feminine (e.g. Spanish "ella")' },
	{ value: "neuter", label: 'Neuter (e.g. German "es")' },
	{ value: "common", label: "Common (shared masc/fem, e.g. Swedish/Danish)" },
	{ value: "animate", label: "Animate (living things, e.g. Polish, Ojibwe)" },
	{ value: "inanimate", label: "Inanimate (non-living things)" },
];

const EMAIL_TYPE_OPTIONS: ReadonlyArray<string> = ["home", "work"];
const TEL_TYPE_OPTIONS: ReadonlyArray<string> = [
	"home",
	"work",
	"cell",
	"voice",
	"fax",
	"pager",
];

const BLANK_TYPED_VALUE: ContactTypedValue = {
	value: "",
	types: [],
	label: "",
	preferred: false,
};

const BLANK_ADDRESS: ContactAddress = {
	poBox: "",
	extended: "",
	street: "",
	locality: "",
	region: "",
	postalCode: "",
	country: "",
	types: [],
	label: "",
	preferred: false,
};

const BLANK_SERVICE: ContactServiceValue = { service: "", value: "" };

const BLANK_RELATION: ContactRelation = {
	target: { kind: "text" },
	name: "",
	relation: "",
	preferred: false,
};

const TextField = ({
	label,
	name,
	value,
	type = "text",
	placeholder,
	required,
	class: cls,
}: {
	label: ComponentChildren;
	name: string;
	value: string;
	type?: TextInputType;
	placeholder?: string;
	required?: boolean;
	class?: string;
}): VNode => (
	<label class={cx("form-group block", cls)}>
		<span class="form-label">{label}</span>
		<TextInput
			type={type}
			name={name}
			value={value}
			placeholder={placeholder}
			required={required}
			class="mt-1"
		/>
	</label>
);

const SelectField = ({
	label,
	name,
	value,
	options,
	class: cls,
}: {
	label: ComponentChildren;
	name: string;
	value: string;
	options: ReadonlyArray<{ value: string; label: string }>;
	class?: string;
}): VNode => (
	<label class={cx("form-group block", cls)}>
		<span class="form-label">{label}</span>
		<Select name={name} options={options} value={value} class="mt-1" />
	</label>
);

const Section = ({
	title,
	children,
}: {
	title: string;
	children: ComponentChildren;
}): VNode => (
	<section class="space-y-2">
		<h2 class="font-semibold text-fg text-sm">{title}</h2>
		{children}
	</section>
);

/** A repeated-value section: existing rows + a JS "+ Add" button that clones a
 * blank row from a <template>. Rows carry their own JS-only Remove button. */
const RowSection = ({
	field,
	title,
	rows,
	blankRow,
	addLabel,
}: {
	field: string;
	title: string;
	rows: ComponentChildren;
	blankRow: VNode;
	addLabel: string;
}): VNode => (
	<Section title={title}>
		<div class="space-y-2" data-row-list={field}>
			{rows}
		</div>
		<template data-row-template={field}>{blankRow}</template>
		<Button size="sm" data-add-row={field}>
			{addLabel}
		</Button>
	</Section>
);

/** Splits `types` into (a) which of `known` (case-insensitively) are present,
 * and (b) a comma-joined string of everything else, verbatim. Lets checkbox
 * UIs cover the common cases without silently dropping unusual existing
 * values (e.g. an imported "iphone" TYPE) on next save. */
const splitKnownTypes = (
	types: ReadonlyArray<string>,
	known: ReadonlyArray<string>,
): { checked: ReadonlySet<string>; other: string } => {
	const knownSet = new Set(known.map((k) => k.toLowerCase()));
	const checked = new Set<string>();
	const other: Array<string> = [];
	for (const t of types) {
		const lower = t.toLowerCase();
		if (knownSet.has(lower)) {
			checked.add(lower);
		} else {
			other.push(t);
		}
	}
	return { checked, other: other.join(", ") };
};

const RemoveRowButton = (): VNode => (
	<Button size="sm" data-remove-row aria-label="Remove this row">
		Remove
	</Button>
);

const PreferredCheckbox = ({
	field,
	preferred,
}: {
	field: string;
	preferred: boolean;
}): VNode => (
	<label class="ml-auto inline-flex items-center gap-1">
		<input type="checkbox" checked={preferred} data-preferred-checkbox />
		Preferred
		<input
			type="hidden"
			name={`${field}[].preferred`}
			value={preferred ? "on" : ""}
			data-preferred-hidden
		/>
	</label>
);

const TypedValueRow = ({
	field,
	value,
	nojsOnly,
}: {
	field: "emails" | "tels";
	value: ContactTypedValue;
	/** No-JS fallback row — hidden once JS is active (see input.css's
	 * `html.js [data-nojs-only]` rule); JS users add rows via "+ Add" instead. */
	nojsOnly?: boolean;
}): VNode => {
	const options = field === "emails" ? EMAIL_TYPE_OPTIONS : TEL_TYPE_OPTIONS;
	const { checked, other } = splitKnownTypes(value.types, options);
	return (
		<div
			class="space-y-2 rounded-md border border-line p-3"
			data-row-item
			data-nojs-only={nojsOnly ? "" : undefined}
		>
			<div class="flex flex-wrap items-start gap-2">
				<TextInput
					type={field === "emails" ? "email" : "tel"}
					name={`${field}[].value`}
					value={value.value}
					placeholder={field === "emails" ? "address@example.com" : ""}
					class="min-w-48 flex-1"
				/>
				<TextInput
					name={`${field}[].label`}
					value={value.label ?? ""}
					placeholder="Label"
					class="w-32"
				/>
				<RemoveRowButton />
			</div>
			<div class="flex flex-wrap items-center gap-3 text-sm">
				{options.map((opt) => (
					<label key={opt} class="inline-flex items-center gap-1">
						<input
							type="checkbox"
							value={opt}
							checked={checked.has(opt)}
							data-type-checkbox
						/>
						{opt}
					</label>
				))}
				{/* Rows are cloned from a <template>, so there is no unique id to
				    point a `for` at - the label wraps its control instead, which
				    also keeps Biome's noLabelWithoutControl satisfied. */}
				<label class="inline-flex items-center gap-1">
					<span class="form-hint">Other:</span>
					<TextInput
						value={other}
						placeholder="custom, tags"
						data-type-other
						class="w-28"
					/>
				</label>
				<PreferredCheckbox field={field} preferred={value.preferred} />
			</div>
			<input
				type="hidden"
				name={`${field}[].types`}
				value={value.types.join(",")}
				data-type-hidden
			/>
		</div>
	);
};

const ServiceRow = ({
	field,
	value,
	servicePlaceholder,
	valuePlaceholder,
	nojsOnly,
}: {
	field: "social" | "impp";
	value: ContactServiceValue;
	servicePlaceholder: string;
	valuePlaceholder: string;
	nojsOnly?: boolean;
}): VNode => (
	<div
		class="flex flex-wrap gap-2"
		data-row-item
		data-nojs-only={nojsOnly ? "" : undefined}
	>
		<TextInput
			name={`${field}[].service`}
			value={value.service}
			placeholder={servicePlaceholder}
			class="w-48"
		/>
		<TextInput
			name={`${field}[].value`}
			value={value.value}
			placeholder={valuePlaceholder}
			class="min-w-48 flex-1"
		/>
		<RemoveRowButton />
	</div>
);

const UrlRow = ({
	value,
	nojsOnly,
}: {
	value: string;
	nojsOnly?: boolean;
}): VNode => (
	<div
		class="flex flex-wrap gap-2"
		data-row-item
		data-nojs-only={nojsOnly ? "" : undefined}
	>
		<TextInput
			type="url"
			name="urls[]"
			value={value}
			placeholder="https://example.com"
			class="min-w-48 flex-1"
		/>
		<RemoveRowButton />
	</div>
);

const AddressRow = ({
	value,
	nojsOnly,
}: {
	value: ContactAddress;
	nojsOnly?: boolean;
}): VNode => (
	<div
		class="grid grid-cols-1 gap-2 rounded-md border border-line p-3 md:grid-cols-2"
		data-row-item
		data-nojs-only={nojsOnly ? "" : undefined}
	>
		<TextInput
			name="addresses[].street"
			value={value.street}
			placeholder="Street"
			class="md:col-span-2"
		/>
		<TextInput
			name="addresses[].extended"
			value={value.extended}
			placeholder="Suite / unit"
		/>
		<TextInput
			name="addresses[].poBox"
			value={value.poBox}
			placeholder="PO Box"
		/>
		<TextInput
			name="addresses[].locality"
			value={value.locality}
			placeholder="City"
		/>
		<TextInput
			name="addresses[].region"
			value={value.region}
			placeholder="State / region"
		/>
		<TextInput
			name="addresses[].postalCode"
			value={value.postalCode}
			placeholder="Postal code"
		/>
		<TextInput
			name="addresses[].country"
			value={value.country}
			placeholder="Country"
		/>
		<TextInput
			name="addresses[].types"
			value={value.types.join(", ")}
			placeholder="home, work, billing, delivery"
		/>
		<TextInput
			name="addresses[].label"
			value={value.label ?? ""}
			placeholder="Label"
		/>
		<div class="flex items-center gap-3 md:col-span-2">
			<PreferredCheckbox field="addresses" preferred={value.preferred} />
			<RemoveRowButton />
		</div>
	</div>
);

/**
 * One relation. The value is a single text box with a `<datalist>` type-ahead
 * over the addressbook's contacts; picking a suggestion makes contacts.js write
 * the contact's UID into the hidden field, which is what turns the entry into a
 * link rather than a name. Typing anything else leaves the UID empty and the
 * server classifies it as an address or free text.
 *
 * `index` keys the datalist to this row. Rows cloned from the template take
 * their index from the DOM at add time (contacts.js), since a template cannot
 * know its future position.
 */
const RelationRow = ({
	value,
	index,
	addressbookId,
	nojsOnly,
}: {
	value: ContactRelation;
	index: number;
	addressbookId: string;
	nojsOnly?: boolean;
}): VNode => {
	const listId = `relation-options-${index}`;
	const kindsId = `relation-kinds-${index}`;
	const uid = value.target.kind === "contact" ? value.target.uid : "";
	const shown =
		value.target.kind === "email" && value.name === ""
			? value.target.address
			: value.name;
	return (
		<div
			class="flex flex-wrap items-center gap-2"
			data-row-item
			data-nojs-only={nojsOnly ? "" : undefined}
		>
			<TextInput
				name={RELATION_NAME_FIELD}
				value={shown}
				list={listId}
				placeholder="Name, or an email address"
				data-relation-input
				hx-get="/ui/contacts/relation-options"
				hx-trigger="input changed delay:200ms"
				hx-target={`#${listId}`}
				hx-swap="outerHTML"
				hx-vals={encodeJson({ addressbook: addressbookId, list: listId })}
				hx-params="*"
				class="min-w-48 flex-1"
			/>
			<datalist id={listId} />
			<input
				type="hidden"
				name="relations[].uid"
				value={uid}
				data-relation-uid
			/>
			{/* Combobox, not a select: the standard wordings are offered, this
			    row's own non-standard wording is offered back to it so editing
			    never coarsens it, and a new custom relation can still be typed. */}
			<TextInput
				name="relations[].relation"
				value={value.relation}
				list={kindsId}
				placeholder="Relation"
				class="w-40"
			/>
			<datalist id={kindsId}>
				{relationOptionsFor(value.relation).map((r) => (
					<option key={r} value={r} />
				))}
			</datalist>
			<PreferredCheckbox field="relations" preferred={value.preferred} />
			<RemoveRowButton />
		</div>
	);
};

const OtherPropRow = ({
	value,
	nojsOnly,
}: {
	value?: ContactOtherProp;
	nojsOnly?: boolean;
}): VNode => (
	<div
		class="grid grid-cols-1 gap-2 md:grid-cols-4"
		data-row-item
		data-nojs-only={nojsOnly ? "" : undefined}
	>
		<TextInput
			name="other[].name"
			value={value?.name ?? ""}
			placeholder="PROPERTY"
			class="font-mono uppercase"
		/>
		<TextInput
			name="other[].value"
			value={value?.value ?? ""}
			placeholder="value"
			class="md:col-span-2"
		/>
		<TextInput
			name="other[].params"
			value={value?.params ?? ""}
			placeholder="TYPE=work;PREF=1"
			class="font-mono"
		/>
		<input type="hidden" name="other[].group" value={value?.group ?? ""} />
		<div class="md:col-span-4">
			<RemoveRowButton />
		</div>
	</div>
);

// Pronouns, GENDER (with its custom-value escape hatch) and the optional
// grammatical gender, which starts hidden until asked for
const GenderSection = ({
	pronouns,
	gender,
	gramGender,
}: {
	pronouns: string;
	gender: string;
	gramGender: string;
}): VNode => {
	const isCustomGender = !STANDARD_GENDER_VALUES.has(gender);
	const hasGramGender = gramGender !== "";
	return (
		<section class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<TextField
				label="Pronouns"
				name="pronouns"
				value={pronouns}
				placeholder="they/them"
			/>
			<div class="form-group block" data-gender-field>
				<span class="form-label">Gender</span>
				<Select
					{...(isCustomGender ? {} : { name: "gender" })}
					options={GENDER_OPTIONS}
					value={isCustomGender ? GENDER_CUSTOM_SENTINEL : gender}
					class="mt-1"
					data-gender-select
				/>
				<TextInput
					{...(isCustomGender ? { name: "gender" } : {})}
					value={isCustomGender ? gender : ""}
					placeholder="Custom GENDER value"
					class="mt-2"
					hidden={!isCustomGender}
					data-gender-custom
				/>
			</div>
			<div class="flex items-end">
				<button
					type="button"
					class="text-muted text-sm underline"
					data-add-gram-gender
					hidden={hasGramGender}
				>
					+ Add grammatical gender
				</button>
			</div>
			<div
				class="form-group block md:col-span-3"
				data-gram-gender-field
				hidden={!hasGramGender}
			>
				<span class="form-label">Grammatical gender</span>
				<Select
					name="gramGender"
					options={GRAM_GENDER_OPTIONS}
					value={gramGender}
					class="mt-1 max-w-sm"
				/>
				<p class="form-hint mt-1">
					Used by some address book apps for grammatical agreement (e.g. in
					translated salutations) — usually safe to leave unspecified.
				</p>
			</div>
		</section>
	);
};

// The contact's photo: a streamed preview of the embedded one (or a remote URL),
// an upload box, and a URL box. An embedded photo round-trips in a hidden field.
const PhotoSection = ({
	photoSrc,
	inlinePhoto,
	photoUrl,
}: {
	photoSrc: string;
	inlinePhoto: string;
	photoUrl: string;
}): VNode => (
	<Section title="Photo">
		{photoSrc !== "" && (
			<img
				src={photoSrc}
				alt="Current contact avatar"
				loading="lazy"
				class="size-24 rounded-md object-cover"
			/>
		)}
		<label class="form-group block text-sm">
			<span class="form-hint">Upload (max 512 KB)</span>
			<FileInput name="photoFile" accept="image/*" class="mt-1 block" />
		</label>
		<label class="form-group block text-sm">
			<span class="form-hint">…or paste a URL</span>
			<TextInput
				type="url"
				name="photo"
				value={inlinePhoto === "" ? photoUrl : ""}
				placeholder={inlinePhoto === "" ? "" : "Replaces the photo above"}
				class="mt-1"
			/>
		</label>
		{/* An embedded photo is hundreds of KB of base64 — kept out of the
					    visible box (and off the page, since the preview streams from
					    the photo endpoint) but still round-tripped, so saving an
					    unrelated field does not drop it. A pasted URL wins over it. */}
		{inlinePhoto !== "" && (
			<input type="hidden" name="photoInline" value={inlinePhoto} />
		)}
	</Section>
);

export const ContactFormPage = ({
	pageTitle,
	mode,
	addressbookId,
	form,
	action,
	instanceId,
	deleteAction,
	errors = [],
	variant = "page",
	popoverId = CONTACTS_POPOVER_ID,
}: ContactFormPageProps): VNode => {
	const backHref = `/ui/contacts?addressbook=${addressbookId}`;
	const popover = variant === "popover";
	// In the popover the panel is already a `card card-pad`, and submits go over
	// HTMX (create returns `contacts:changed`, which refreshes the list + closes
	// the popover). The page variant keeps the standalone card + full POST.
	const formProps = popover
		? {
				"hx-post": action,
				"hx-encoding": "multipart/form-data",
				"data-guard": "",
			}
		: {};

	const computedFn = `${form.givenName} ${form.middleName} ${form.familyName}`
		.replace(/\s+/gu, " ")
		.trim();
	const isAutoFn = form.fn === "" || form.fn === computedFn;

	// An embedded photo is streamed from the photo endpoint rather than inlined
	// into the page; a remote URL is used directly. A brand-new contact has no
	// instance to stream from, so its photo can only be a URL.
	const inlinePhoto = isInlinePhoto(form.photo) ? form.photo : "";
	const photoSrc = photoSrcFor(form.photo, instanceId);

	return (
		<div class={popover ? "space-y-6" : "max-w-3xl space-y-6"}>
			{popover ? (
				<ContactsPopoverHeader title={pageTitle} popoverId={popoverId} />
			) : (
				<ContactsCrumb title={pageTitle} backHref={backHref} />
			)}

			{errors.length > 0 && (
				<Alert tone="danger" title="Please correct the following:">
					<ul class="list-inside list-disc space-y-0.5">
						{errors.map((e) => (
							<li key={e}>{e}</li>
						))}
					</ul>
				</Alert>
			)}

			<form
				method="POST"
				action={action}
				enctype="multipart/form-data"
				{...formProps}
				class={popover ? "space-y-6" : "card card-pad space-y-6"}
			>
				<input type="hidden" name="addressbookId" value={addressbookId} />

				<section class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<label class="form-group block">
						<span class="form-label flex items-center gap-2">
							Display name <span class="text-danger">*</span>
							<Button
								size="sm"
								data-fn-mode-toggle
								aria-pressed={isAutoFn}
								title={
									isAutoFn
										? "Following Given/Middle/Family name — click to edit manually"
										: "Set manually — click to auto-fill from Given/Middle/Family name"
								}
							>
								{isAutoFn ? "Auto" : "Manual"}
							</Button>
						</span>
						<input
							type="text"
							name="fn"
							value={isAutoFn ? computedFn : form.fn}
							required
							readOnly={isAutoFn}
							class={cx("form-input mt-1", isAutoFn && "bg-subtle text-muted")}
						/>
					</label>
					<TextField
						label="Family name"
						name="familyName"
						value={form.familyName}
					/>
					<TextField
						label="Given name"
						name="givenName"
						value={form.givenName}
					/>
					<TextField
						label="Middle name"
						name="middleName"
						value={form.middleName}
					/>
					<TextField label="Prefix" name="prefix" value={form.prefix} />
					<TextField label="Suffix" name="suffix" value={form.suffix} />
					<TextField label="Nickname" name="nickname" value={form.nickname} />
					<SelectField
						label="Kind"
						name="kind"
						value={form.kind}
						options={KIND_OPTIONS}
					/>
					<TextField
						label="Birthday"
						name="bday"
						value={form.bday}
						type="date"
					/>
					<TextField
						label="Anniversary"
						name="anniversary"
						value={form.anniversary}
						type="date"
					/>
				</section>

				<RowSection
					field="emails"
					title="Email"
					rows={[
						...form.emails.map((e, i) => (
							<TypedValueRow key={`email-${i}`} field="emails" value={e} />
						)),
						<TypedValueRow
							key="email-blank"
							field="emails"
							value={BLANK_TYPED_VALUE}
							nojsOnly
						/>,
					]}
					blankRow={<TypedValueRow field="emails" value={BLANK_TYPED_VALUE} />}
					addLabel="+ Add email"
				/>

				<RowSection
					field="tels"
					title="Phone"
					rows={[
						...form.tels.map((t, i) => (
							<TypedValueRow key={`tel-${i}`} field="tels" value={t} />
						)),
						<TypedValueRow
							key="tel-blank"
							field="tels"
							value={BLANK_TYPED_VALUE}
							nojsOnly
						/>,
					]}
					blankRow={<TypedValueRow field="tels" value={BLANK_TYPED_VALUE} />}
					addLabel="+ Add phone"
				/>

				<RowSection
					field="urls"
					title="URLs"
					rows={[
						...form.urls.map((u, i) => <UrlRow key={`url-${i}`} value={u} />),
						<UrlRow key="url-blank" value="" nojsOnly />,
					]}
					blankRow={<UrlRow value="" />}
					addLabel="+ Add URL"
				/>

				<RowSection
					field="addresses"
					title="Addresses"
					rows={[
						...form.addresses.map((a, i) => (
							<AddressRow key={`addr-${i}`} value={a} />
						)),
						<AddressRow key="addr-blank" value={BLANK_ADDRESS} nojsOnly />,
					]}
					blankRow={<AddressRow value={BLANK_ADDRESS} />}
					addLabel="+ Add address"
				/>

				<RowSection
					field="social"
					title="Social profiles"
					rows={[
						...form.socialProfiles.map((s, i) => (
							<ServiceRow
								key={`social-${i}`}
								field="social"
								value={s}
								servicePlaceholder="Service (Mastodon, Nextcloud…)"
								valuePlaceholder="URL or username"
							/>
						)),
						<ServiceRow
							key="social-blank"
							field="social"
							value={BLANK_SERVICE}
							servicePlaceholder="Service (Mastodon, Nextcloud…)"
							valuePlaceholder="URL or username"
							nojsOnly
						/>,
					]}
					blankRow={
						<ServiceRow
							field="social"
							value={BLANK_SERVICE}
							servicePlaceholder="Service (Mastodon, Nextcloud…)"
							valuePlaceholder="URL or username"
						/>
					}
					addLabel="+ Add social profile"
				/>

				<RowSection
					field="impp"
					title="Instant messaging"
					rows={[
						...form.impps.map((s, i) => (
							<ServiceRow
								key={`impp-${i}`}
								field="impp"
								value={s}
								servicePlaceholder="Service (Skype, XMPP…)"
								valuePlaceholder="handle or URI"
							/>
						)),
						<ServiceRow
							key="impp-blank"
							field="impp"
							value={BLANK_SERVICE}
							servicePlaceholder="Service (Skype, XMPP…)"
							valuePlaceholder="handle or URI"
							nojsOnly
						/>,
					]}
					blankRow={
						<ServiceRow
							field="impp"
							value={BLANK_SERVICE}
							servicePlaceholder="Service (Skype, XMPP…)"
							valuePlaceholder="handle or URI"
						/>
					}
					addLabel="+ Add IM handle"
				/>

				<RowSection
					field="relations"
					title="Related people"
					rows={[
						...form.relations.map((r, i) => (
							<RelationRow
								key={`relation-${i}`}
								value={r}
								index={i}
								addressbookId={addressbookId}
							/>
						)),
						<RelationRow
							key="relation-blank"
							value={BLANK_RELATION}
							index={form.relations.length}
							addressbookId={addressbookId}
							nojsOnly
						/>,
					]}
					blankRow={
						<RelationRow
							value={BLANK_RELATION}
							index={form.relations.length}
							addressbookId={addressbookId}
						/>
					}
					addLabel="+ Add related person"
				/>

				<GenderSection
					pronouns={form.pronouns}
					gender={form.gender}
					gramGender={form.gramGender}
				/>

				<section class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<TextField label="Organisation" name="org" value={form.org} />
					<TextField label="Title" name="title" value={form.title} />
					<TextField
						label="Categories (comma-separated)"
						name="categoriesCsv"
						value={form.categoriesCsv}
						class="md:col-span-2"
					/>
					<label class="form-group block md:col-span-2">
						<span class="form-label">Note</span>
						<Textarea
							name="note"
							rows={NOTE_ROWS}
							value={form.note}
							class="mt-1"
						/>
					</label>
				</section>

				<PhotoSection
					photoSrc={photoSrc}
					inlinePhoto={inlinePhoto}
					photoUrl={form.photo}
				/>

				<section>
					<details class="text-sm" open={form.otherProps.length > 0}>
						<summary class="cursor-pointer font-semibold text-fg text-sm">
							Other fields ({form.otherProps.length})
						</summary>
						<p class="form-hint mt-1 mb-2">
							Any other vCard property. Parameters go in the last box as{" "}
							<code>NAME=value;NAME=value</code>. Clear the name to remove a
							row.
						</p>
						<div class="space-y-2" data-row-list="other">
							{form.otherProps.map((p, i) => (
								<OtherPropRow key={`other-${i}`} value={p} />
							))}
							<OtherPropRow key="other-blank" nojsOnly />
						</div>
						<template data-row-template="other">
							<OtherPropRow />
						</template>
						<Button size="sm" class="mt-2" data-add-row="other">
							+ Add field
						</Button>
					</details>
				</section>

				<div class="flex flex-wrap gap-3 pt-2">
					<Button type="submit" variant="primary">
						{mode === "edit" ? "Save changes" : "Create contact"}
					</Button>
					{popover ? (
						<Button commandfor={popoverId} command="request-close">
							Cancel
						</Button>
					) : (
						<LinkButton href={backHref}>Cancel</LinkButton>
					)}
				</div>
			</form>

			{mode === "edit" && deleteAction && (
				<Card class="border-danger/40" pad={false}>
					<form
						method="POST"
						action={deleteAction}
						hx-post={deleteAction}
						hx-confirm="Delete this contact?"
						hx-disable="find button"
						data-guard=""
						class="card-pad space-y-2"
					>
						<h2 class="font-semibold text-danger text-sm">Danger zone</h2>
						<Button type="submit" variant="danger">
							Delete contact
						</Button>
					</form>
				</Card>
			)}
		</div>
	);
};
