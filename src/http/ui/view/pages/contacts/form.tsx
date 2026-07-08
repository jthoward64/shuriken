import type { ComponentChildren, VNode } from "preact";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactServiceValue,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { cx } from "../../cx.ts";
import { Card } from "../../ui.tsx";
import { CONTACTS_POPOVER_ID, ContactsPopoverHeader } from "./popover.tsx";
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
	type?: string;
	placeholder?: string;
	required?: boolean;
	class?: string;
}): VNode => (
	<label class={cx("form-group block", cls)}>
		<span class="form-label">{label}</span>
		<input
			type={type}
			name={name}
			value={value}
			placeholder={placeholder}
			required={required}
			class="form-input mt-1"
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
		<select name={name} class="form-select mt-1">
			{options.map((o) => (
				<option key={o.value} value={o.value} selected={value === o.value}>
					{o.label}
				</option>
			))}
		</select>
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
		<h2 class="text-sm font-semibold text-fg">{title}</h2>
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
		<button type="button" class="btn btn-secondary btn-sm" data-add-row={field}>
			{addLabel}
		</button>
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
	<button
		type="button"
		class="btn btn-secondary btn-sm"
		data-remove-row
		aria-label="Remove this row"
	>
		Remove
	</button>
);

const PreferredCheckbox = ({
	field,
	preferred,
}: {
	field: string;
	preferred: boolean;
}): VNode => (
	<label class="inline-flex items-center gap-1 ml-auto">
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
			class="border border-line rounded-md p-3 space-y-2"
			data-row-item
			data-nojs-only={nojsOnly || undefined}
		>
			<div class="flex flex-wrap gap-2 items-start">
				<input
					type={field === "emails" ? "email" : "tel"}
					name={`${field}[].value`}
					value={value.value}
					placeholder={field === "emails" ? "address@example.com" : ""}
					class="form-input flex-1 min-w-[12rem]"
				/>
				<input
					type="text"
					name={`${field}[].label`}
					value={value.label ?? ""}
					placeholder="Label"
					class="form-input w-32"
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
				<label class="inline-flex items-center gap-1">
					<span class="form-hint">Other:</span>
					<input
						type="text"
						value={other}
						placeholder="custom, tags"
						class="form-input w-28"
						data-type-other
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
		data-nojs-only={nojsOnly || undefined}
	>
		<input
			type="text"
			name={`${field}[].service`}
			value={value.service}
			placeholder={servicePlaceholder}
			class="form-input w-48"
		/>
		<input
			type="text"
			name={`${field}[].value`}
			value={value.value}
			placeholder={valuePlaceholder}
			class="form-input flex-1 min-w-[12rem]"
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
		data-nojs-only={nojsOnly || undefined}
	>
		<input
			type="url"
			name="urls[]"
			value={value}
			placeholder="https://example.com"
			class="form-input flex-1 min-w-[12rem]"
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
		class="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 border border-line rounded-md"
		data-row-item
		data-nojs-only={nojsOnly || undefined}
	>
		<input
			type="text"
			name="addresses[].street"
			value={value.street}
			placeholder="Street"
			class="form-input md:col-span-2"
		/>
		<input
			type="text"
			name="addresses[].extended"
			value={value.extended}
			placeholder="Suite / unit"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].poBox"
			value={value.poBox}
			placeholder="PO Box"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].locality"
			value={value.locality}
			placeholder="City"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].region"
			value={value.region}
			placeholder="State / region"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].postalCode"
			value={value.postalCode}
			placeholder="Postal code"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].country"
			value={value.country}
			placeholder="Country"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].types"
			value={value.types.join(", ")}
			placeholder="home, work, billing, delivery"
			class="form-input"
		/>
		<input
			type="text"
			name="addresses[].label"
			value={value.label ?? ""}
			placeholder="Label"
			class="form-input"
		/>
		<div class="flex items-center gap-3 md:col-span-2">
			<PreferredCheckbox field="addresses" preferred={value.preferred} />
			<RemoveRowButton />
		</div>
	</div>
);

const OtherPropRow = ({
	value,
	nojsOnly,
}: {
	value?: ContactOtherProp;
	nojsOnly?: boolean;
}): VNode => (
	<div
		class="grid grid-cols-1 md:grid-cols-4 gap-2"
		data-row-item
		data-nojs-only={nojsOnly || undefined}
	>
		<input
			type="text"
			name="other[].name"
			value={value?.name ?? ""}
			placeholder="PROPERTY"
			class="form-input font-mono uppercase"
		/>
		<input
			type="text"
			name="other[].value"
			value={value?.value ?? ""}
			placeholder="value"
			class="form-input md:col-span-2"
		/>
		<input
			type="text"
			name="other[].params"
			value={value?.params ?? ""}
			placeholder="TYPE=work;PREF=1"
			class="form-input font-mono"
		/>
		<input type="hidden" name="other[].group" value={value?.group ?? ""} />
		<div class="md:col-span-4">
			<RemoveRowButton />
		</div>
	</div>
);

export const ContactFormPage = ({
	pageTitle,
	mode,
	addressbookId,
	form,
	action,
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
		.replace(/\s+/g, " ")
		.trim();
	const isAutoFn = form.fn === "" || form.fn === computedFn;

	const isCustomGender = !STANDARD_GENDER_VALUES.has(form.gender);
	const hasGramGender = form.gramGender !== "";

	return (
		<div class={popover ? "space-y-6" : "space-y-6 max-w-3xl"}>
			{popover ? (
				<ContactsPopoverHeader title={pageTitle} popoverId={popoverId} />
			) : (
				<ContactsCrumb title={pageTitle} backHref={backHref} />
			)}

			{errors.length > 0 && (
				<div
					role="alert"
					class="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
				>
					<p class="font-medium mb-1">Please correct the following:</p>
					<ul class="list-disc list-inside space-y-0.5">
						{errors.map((e) => (
							<li key={e}>{e}</li>
						))}
					</ul>
				</div>
			)}

			<form
				method="POST"
				action={action}
				enctype="multipart/form-data"
				{...formProps}
				class={popover ? "space-y-6" : "card card-pad space-y-6"}
			>
				<input type="hidden" name="addressbookId" value={addressbookId} />

				<section class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<label class="form-group block">
						<span class="form-label flex items-center gap-2">
							Display name <span class="text-danger">*</span>
							<button
								type="button"
								class="btn btn-secondary btn-sm"
								data-fn-mode-toggle
								aria-pressed={isAutoFn}
								title={
									isAutoFn
										? "Following Given/Middle/Family name — click to edit manually"
										: "Set manually — click to auto-fill from Given/Middle/Family name"
								}
							>
								{isAutoFn ? "Auto" : "Manual"}
							</button>
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

				<section class="grid grid-cols-1 md:grid-cols-3 gap-4">
					<TextField
						label="Pronouns"
						name="pronouns"
						value={form.pronouns}
						placeholder="they/them"
					/>
					<div class="form-group block" data-gender-field>
						<span class="form-label">Gender</span>
						<select
							{...(isCustomGender ? {} : { name: "gender" })}
							class="form-select mt-1"
							data-gender-select
						>
							{GENDER_OPTIONS.map((o) => (
								<option
									key={o.value}
									value={o.value}
									selected={
										isCustomGender
											? o.value === GENDER_CUSTOM_SENTINEL
											: form.gender === o.value
									}
								>
									{o.label}
								</option>
							))}
						</select>
						<input
							type="text"
							{...(isCustomGender ? { name: "gender" } : {})}
							value={isCustomGender ? form.gender : ""}
							placeholder="Custom GENDER value"
							class="form-input mt-2"
							hidden={!isCustomGender}
							data-gender-custom
						/>
					</div>
					<div class="flex items-end">
						<button
							type="button"
							class="text-sm text-muted underline"
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
						<select name="gramGender" class="form-select mt-1 max-w-sm">
							{GRAM_GENDER_OPTIONS.map((o) => (
								<option
									key={o.value}
									value={o.value}
									selected={form.gramGender === o.value}
								>
									{o.label}
								</option>
							))}
						</select>
						<p class="form-hint mt-1">
							Used by some address book apps for grammatical agreement (e.g. in
							translated salutations) — usually safe to leave unspecified.
						</p>
					</div>
				</section>

				<section class="grid grid-cols-1 md:grid-cols-2 gap-4">
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
						<textarea name="note" rows={NOTE_ROWS} class="form-textarea mt-1">
							{form.note}
						</textarea>
					</label>
				</section>

				<Section title="Photo">
					{form.photo !== "" && (
						<img
							src={form.photo}
							alt="Current contact avatar"
							class="w-24 h-24 object-cover rounded-md"
						/>
					)}
					<label class="form-group block text-sm">
						<span class="form-hint">Upload (max 512 KB)</span>
						<input
							type="file"
							name="photoFile"
							accept="image/*"
							class="mt-1 block"
						/>
					</label>
					<label class="form-group block text-sm">
						<span class="form-hint">…or paste a URL</span>
						<input
							type="url"
							name="photo"
							value={form.photo}
							class="form-input mt-1"
						/>
					</label>
				</Section>

				<section>
					<details class="text-sm" open={form.otherProps.length > 0}>
						<summary class="cursor-pointer text-sm font-semibold text-fg">
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
						<button
							type="button"
							class="btn btn-secondary btn-sm mt-2"
							data-add-row="other"
						>
							+ Add field
						</button>
					</details>
				</section>

				<div class="flex flex-wrap gap-3 pt-2">
					<button type="submit" class="btn btn-primary">
						{mode === "edit" ? "Save changes" : "Create contact"}
					</button>
					{popover ? (
						<button
							type="button"
							commandfor={popoverId}
							command="request-close"
							class="btn btn-secondary"
						>
							Cancel
						</button>
					) : (
						<a href={backHref} class="btn btn-secondary">
							Cancel
						</a>
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
						<h2 class="text-sm font-semibold text-danger">Danger zone</h2>
						<button type="submit" class="btn btn-danger">
							Delete contact
						</button>
					</form>
				</Card>
			)}
		</div>
	);
};
