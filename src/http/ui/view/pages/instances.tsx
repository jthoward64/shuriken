import type { VNode } from "preact";
import type { AclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { Breadcrumb, Card, PageHeader } from "../ui.tsx";
import { AclPanel } from "./acl-panel.tsx";

// ---------------------------------------------------------------------------
// Per-instance ACL editor — share or unshare a single event without granting
// access to the whole calendar. Mirrors the panel on collection-edit.
// ---------------------------------------------------------------------------

export interface InstanceAclPageProps {
	readonly title: string;
	readonly slug: string;
	readonly collectionId: string;
	readonly aclPanel: AclPanelData | undefined;
}

export const InstanceAclPage = ({
	title,
	slug,
	collectionId,
	aclPanel,
}: InstanceAclPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[{ label: "Calendar", href: "/ui/calendar" }, { label: title }]}
			/>
			<PageHeader title={title} />
		</div>

		<Card>
			<div class="space-y-2">
				<p class="text-sm text-muted">
					Resource slug: <span class="font-mono text-fg">{slug}</span>
				</p>
				<p class="text-sm text-muted">
					Parent calendar:{" "}
					<a href={`/ui/collections/${collectionId}`} class="link">
						{collectionId}
					</a>
				</p>
			</div>
		</Card>

		<AclPanel data={aclPanel} />
	</div>
);
