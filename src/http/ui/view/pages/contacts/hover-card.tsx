import type { VNode } from "preact";
import type {
	ContactFormData,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { IconEdit } from "../../icons.tsx";

// ---------------------------------------------------------------------------
// Contact hover card — a read-only preview shown on both hover and click (see
// contacts.js), separate from the click-to-edit dialog in edit-dialog.tsx.
// `popover="manual"`, not a `<dialog>`: non-modal, so it can appear on hover
// without stealing focus. Its Edit button opens the real edit dialog.
// ---------------------------------------------------------------------------

export const CONTACT_HOVER_CARD_ID = "contact-hover-card";
export const CONTACT_HOVER_CARD_BODY_ID = "contact-hover-card-body";

export const ContactHoverCardContainer = (): VNode => (
	<div
		id={CONTACT_HOVER_CARD_ID}
		popover="manual"
		role="tooltip"
		class="hover-card"
	>
		<div
			id={CONTACT_HOVER_CARD_BODY_ID}
			class="hover-card-panel card card-pad"
		/>
	</div>
);

/** The "pref"-typed value if one exists, else the first — there's no explicit
 * primary flag on `ContactTypedValue`, just a `types` list. */
const primaryValue = (values: ReadonlyArray<ContactTypedValue>): string =>
	(values.find((v) => v.types.includes("pref")) ?? values[0])?.value ?? "";

export const ContactHoverCard = ({
	form,
	editHref,
}: {
	form: ContactFormData;
	editHref: string;
}): VNode => {
	const email = primaryValue(form.emails);
	const tel = primaryValue(form.tels);
	const orgLine = [form.title, form.org].filter((s) => s !== "").join(", ");
	return (
		<div class="flex items-start gap-3">
			{form.photo !== "" ? (
				<img
					src={form.photo}
					alt=""
					class="h-12 w-12 shrink-0 rounded-full bg-surface-2 object-cover"
				/>
			) : (
				<span
					class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base font-medium text-muted"
					aria-hidden="true"
				>
					{(form.fn.trim().charAt(0) || "?").toUpperCase()}
				</span>
			)}
			<div class="min-w-0 flex-1">
				<div class="flex items-start justify-between gap-3">
					<h3 class="truncate font-semibold text-fg">
						{form.fn || "(no name)"}
					</h3>
					<a
						href={editHref}
						data-edit-contact
						aria-label="Edit contact"
						class="btn btn-ghost btn-sm shrink-0"
					>
						<IconEdit class="h-4 w-4" />
					</a>
				</div>
				{orgLine !== "" && <p class="truncate text-sm text-muted">{orgLine}</p>}
				{email !== "" && <p class="mt-2 truncate text-sm text-fg">{email}</p>}
				{tel !== "" && <p class="truncate text-sm text-fg">{tel}</p>}
			</div>
		</div>
	);
};
