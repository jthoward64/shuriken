import type { VNode } from "preact";
import { CopyField } from "../copy.tsx";
import { IconExternalLink, IconKey, IconMail } from "../icons.tsx";
import { Card, PageHeader } from "../ui.tsx";

// ---------------------------------------------------------------------------
// GET /ui/profile — the signed-in user's account page: identity form, DAV
// client setup URLs (copyable), optional password change, and links out to the
// app-password / email-credential managers.
// ---------------------------------------------------------------------------

export interface ProfilePageProps {
	readonly principalId: string;
	readonly slug: string;
	readonly displayName: string;
	readonly email: string;
	readonly canEditSlug: boolean;
	readonly showPasswordForm: boolean;
	readonly showSignOut: boolean;
	readonly authSettingsUrl?: string;
	readonly authSettingsLabel: string;
	readonly dav: {
		readonly principal: string;
		readonly caldav: string;
		readonly carddav: string;
	};
}

const ManageLink = ({
	href,
	icon,
	title,
	desc,
}: {
	href: string;
	icon: VNode;
	title: string;
	desc: string;
}) => (
	<a
		href={href}
		class="group flex items-center gap-4 rounded-md border border-line bg-surface p-4 transition-colors hover:bg-surface-2"
	>
		<span class="shrink-0 text-muted">{icon}</span>
		<span class="min-w-0 flex-1">
			<span class="font-medium text-fg">{title}</span>
			<span class="block text-sm text-muted">{desc}</span>
		</span>
	</a>
);

export const ProfilePage = ({
	principalId,
	slug,
	displayName,
	email,
	canEditSlug,
	showPasswordForm,
	showSignOut,
	authSettingsUrl,
	authSettingsLabel,
	dav,
}: ProfilePageProps): VNode => (
	<div class="mx-auto max-w-3xl space-y-8">
		<PageHeader title="My profile" subtitle="Your account and client setup." />

		<Card title="Identity">
			<form
				method="POST"
				action={`/ui/api/users/${principalId}/update`}
				hx-post={`/ui/api/users/${principalId}/update`}
				hx-target="body"
				hx-swap="outerHTML"
				class="space-y-4"
			>
				<div class="form-group">
					<label for="displayName" class="form-label">
						Display name
					</label>
					<input
						type="text"
						id="displayName"
						name="displayName"
						value={displayName}
						class="form-input"
					/>
				</div>
				<div class="form-group">
					<label for="email" class="form-label">
						Email
					</label>
					<input
						type="email"
						id="email"
						name="email"
						value={email}
						class="form-input"
					/>
				</div>
				{canEditSlug && (
					<div class="form-group">
						<label for="slug" class="form-label">
							Username (slug)
						</label>
						<input
							type="text"
							id="slug"
							name="slug"
							value={slug}
							class="form-input"
						/>
					</div>
				)}
				<button type="submit" class="btn btn-primary">
					Save changes
				</button>
			</form>
		</Card>

		<Card title="DAV client setup">
			<p class="mb-4 text-sm text-muted">
				Point a CalDAV or CardDAV client at these URLs. If you sign in with SSO,
				use an{" "}
				<a href="/ui/profile/app-passwords" class="link">
					app password
				</a>{" "}
				in place of your normal password.
			</p>
			<div class="space-y-3">
				<CopyField label="Principal URL" value={dav.principal} />
				<CopyField label="CalDAV" value={dav.caldav} />
				<CopyField label="CardDAV" value={dav.carddav} />
			</div>
		</Card>

		{showPasswordForm && (
			<Card title="Change password">
				<form
					method="POST"
					action={`/ui/api/users/${principalId}/set-password`}
					hx-post={`/ui/api/users/${principalId}/set-password`}
					hx-target="body"
					hx-swap="outerHTML"
					class="space-y-4"
				>
					<div class="form-group">
						<label for="newPassword" class="form-label">
							New password
						</label>
						<input
							type="password"
							id="newPassword"
							name="newPassword"
							autocomplete="new-password"
							class="form-input"
						/>
					</div>
					<button type="submit" class="btn btn-primary">
						Update password
					</button>
				</form>
			</Card>
		)}

		<div class="grid gap-3 sm:grid-cols-2">
			<ManageLink
				href="/ui/profile/app-passwords"
				icon={<IconKey class="h-5 w-5" />}
				title="App passwords"
				desc="Per-device secrets for calendar and contact apps."
			/>
			<ManageLink
				href="/ui/profile/email-credentials"
				icon={<IconMail class="h-5 w-5" />}
				title="Email credentials"
				desc="How invitation mail is sent on your behalf."
			/>
		</div>

		{authSettingsUrl && (
			<Card title="Account settings">
				<p class="mb-4 text-sm text-muted">
					Password, recovery email, and MFA are managed by your identity
					provider.
				</p>
				<a
					href={authSettingsUrl}
					target="_blank"
					rel="noopener noreferrer"
					class="btn btn-secondary"
				>
					<IconExternalLink class="h-4 w-4" />
					{authSettingsLabel}
				</a>
			</Card>
		)}

		{showSignOut && (
			<Card title="Session">
				<form method="POST" action="/ui/auth/logout">
					<button type="submit" class="btn btn-secondary">
						Sign out
					</button>
				</form>
			</Card>
		)}
	</div>
);
