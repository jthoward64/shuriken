import type { VNode } from "preact";
import { Button } from "../components/button.tsx";
import { CopyField } from "../components/copy.tsx";
import { Alert, Card } from "../components/display.tsx";
import { Field, TextInput } from "../components/form/form.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

// ---------------------------------------------------------------------------
// GET /ui/profile/app-passwords — manage per-device DAV credentials. A freshly
// generated secret is shown exactly once (via `generated`) with copy buttons.
// ---------------------------------------------------------------------------

const MAX_LABEL_LENGTH = 100;

export interface AppPasswordRow {
	readonly id: string;
	readonly username: string;
	readonly label: string | null;
	readonly created: string;
	readonly lastUsed: string | null;
}

export interface AppPasswordsPageProps {
	readonly appPasswords: ReadonlyArray<AppPasswordRow>;
	readonly generated: {
		readonly username: string;
		readonly password: string;
	} | null;
}

export const AppPasswordsPage = ({
	appPasswords,
	generated,
}: AppPasswordsPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[
					{ label: "Profile", href: "/ui/profile" },
					{ label: "App passwords" },
				]}
			/>
			<PageHeader
				title="App passwords"
				subtitle="Connect calendar and contact apps without sharing your sign-in."
			/>
		</div>

		<Card>
			<p class="text-muted text-sm">
				App passwords let clients (Thunderbird, iOS, DAVx⁵, …) authenticate
				without your single-sign-on credentials. Each is a separate, revocable
				secret. Use your generated username together with the app password when
				your client asks for a username and password.
			</p>
		</Card>

		{generated ? (
			<Alert tone="success" title="New app password created">
				<p class="mb-4 text-muted">
					Copy these now — the password is shown only once and cannot be
					retrieved later.
				</p>
				<div class="space-y-3">
					<CopyField label="Username" value={generated.username} />
					<CopyField label="Password" value={generated.password} />
				</div>
			</Alert>
		) : null}

		<Card title="Create an app password">
			<form
				method="POST"
				action="/ui/api/profile/app-passwords/create"
				class="space-y-4"
			>
				<Field for="label" label="Label (optional)">
					<TextInput
						id="label"
						name="label"
						maxlength={MAX_LABEL_LENGTH}
						placeholder="e.g. iPhone, Thunderbird"
					/>
				</Field>
				<Button type="submit" variant="primary">
					Generate
				</Button>
			</form>
		</Card>

		<Card title="Your app passwords" pad={false}>
			{appPasswords.length > 0 ? (
				<ul class="divide-y divide-line">
					{appPasswords.map((ap) => (
						<li
							key={ap.id}
							class="flex items-center justify-between gap-4 px-5 py-3.5"
						>
							<div class="min-w-0">
								<p class="truncate font-medium text-fg text-sm">
									{ap.label ? (
										ap.label
									) : (
										<span class="text-subtle">No label</span>
									)}
								</p>
								<p class="truncate font-mono text-muted text-xs">
									{ap.username}
								</p>
								<p class="text-subtle text-xs">
									Created {ap.created}
									{ap.lastUsed
										? ` · Last used ${ap.lastUsed}`
										: " · Never used"}
								</p>
							</div>
							<form
								method="POST"
								action="/ui/api/profile/app-passwords/revoke"
								data-confirm="Revoke this app password? Any client using it will stop working."
							>
								<input type="hidden" name="id" value={ap.id} />
								<Button type="submit" variant="danger" size="sm">
									Revoke
								</Button>
							</form>
						</li>
					))}
				</ul>
			) : (
				<p class="card-pad text-muted text-sm">
					You don't have any app passwords yet.
				</p>
			)}
		</Card>
	</div>
);
