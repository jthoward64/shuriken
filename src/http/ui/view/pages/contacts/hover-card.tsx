import type { VNode } from "preact";
import { photoSrcFor } from "#src/http/ui/helpers/contact-photo.ts";
import type {
	ContactFormData,
	ContactTypedValue,
} from "#src/services/card-edit/types.ts";
import { LinkButton } from "../../components/button.tsx";
import { IconEdit } from "../../components/icons.tsx";

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

/** The preferred value if one is marked, else the first. */
const primaryValue = (values: ReadonlyArray<ContactTypedValue>): string =>
	(values.find((v) => v.preferred) ?? values[0])?.value ?? "";

export const ContactHoverCard = ({
	form,
	instanceId,
	editHref,
}: {
	form: ContactFormData;
	instanceId: string;
	editHref: string;
}): VNode => {
	const email = primaryValue(form.emails);
	const tel = primaryValue(form.tels);
	const orgLine = [form.title, form.org].filter((s) => s !== "").join(", ");
	const photoSrc = photoSrcFor(form.photo, instanceId);
	return (
		<div class="flex items-start gap-3">
			{photoSrc !== "" ? (
				<img
					src={photoSrc}
					alt=""
					loading="lazy"
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
					<LinkButton
						href={editHref}
						variant="ghost"
						size="sm"
						data-edit-contact
						aria-label="Edit contact"
						class="shrink-0"
					>
						<IconEdit class="h-4 w-4" />
					</LinkButton>
				</div>
				{orgLine !== "" && <p class="truncate text-sm text-muted">{orgLine}</p>}
				{email !== "" && <p class="mt-2 truncate text-sm text-fg">{email}</p>}
				{tel !== "" && <p class="truncate text-sm text-fg">{tel}</p>}
			</div>
		</div>
	);
};
