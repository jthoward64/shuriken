import type { VNode } from "preact";
import { AssetTags, CONTACTS_ASSETS } from "../../assets.tsx";

// ---------------------------------------------------------------------------
// Shared bits for the contacts pages.
//
// `contactsExtraHead` loads the contacts progress-bar + navigate-away guard
// enhancement (static/contacts.js). Pass it as `extraHead` to renderPage on any
// contacts page that runs long HTMX operations. It is deferred so it never
// blocks first paint; the enhancement is pure progressive polish (see the file
// header in static/contacts.js).
// ---------------------------------------------------------------------------

export const contactsExtraHead: VNode = <AssetTags assets={CONTACTS_ASSETS} />;

// A breadcrumb-style page heading used by the sub-pages (form / merge / cleanup)
// so they share the same "Contacts / <title>" affordance back to the list.
export const ContactsCrumb = ({
	title,
	backHref = "/ui/contacts",
}: {
	title: string;
	backHref?: string;
}): VNode => (
	<div class="page-header">
		<div class="flex items-center gap-2 flex-wrap">
			<a href={backHref} class="text-sm text-muted hover:text-fg">
				Contacts
			</a>
			<span class="text-subtle" aria-hidden="true">
				/
			</span>
			<h1 class="page-title">{title}</h1>
		</div>
	</div>
);
