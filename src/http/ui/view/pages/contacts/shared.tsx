import type { VNode } from "preact";
import { Breadcrumb, PageHeader } from "../../components/page-header.tsx";
import { AssetTags, CONTACTS_ASSETS } from "../../shell/assets.tsx";

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
	<div>
		<Breadcrumb
			items={[{ label: "Contacts", href: backHref }, { label: title }]}
		/>
		<PageHeader title={title} />
	</div>
);
