import type { VNode } from "preact";
import { CopyField } from "../copy.tsx";
import { Card, PageHeader } from "../ui.tsx";

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

const Breadcrumb = ({ title }: { title: string }) => (
	<nav aria-label="Breadcrumb" class="mb-2 flex items-center gap-2 text-sm">
		<a href="/ui/profile" class="link">
			Profile
		</a>
		<span class="text-subtle">/</span>
		<span class="text-muted">{title}</span>
	</nav>
);

export const AppPasswordsPage = ({
	appPasswords,
	generated,
}: AppPasswordsPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb title="App passwords" />
			<PageHeader
				title="App passwords"
				subtitle="Connect calendar and contact apps without sharing your sign-in."
			/>
		</div>

		<Card>
			<p class="text-sm text-muted">
				App passwords let clients (Thunderbird, iOS, DAVx⁵, …) authenticate
				without your single-sign-on credentials. Each is a separate, revocable
				secret. Use your generated username together with the app password when
				your client asks for a username and password.
			</p>
		</Card>

		{generated && (
			<div class="rounded-md border border-success/40 bg-success/10 p-5">
				<h2 class="text-sm font-semibold text-success">
					New app password created
				</h2>
				<p class="mt-1 mb-4 text-sm text-muted">
					Copy these now — the password is shown only once and cannot be
					retrieved later.
				</p>
				<div class="space-y-3">
					<CopyField label="Username" value={generated.username} />
					<CopyField label="Password" value={generated.password} />
				</div>
			</div>
		)}

		<Card title="Create an app password">
			<form
				method="POST"
				action="/ui/api/profile/app-passwords/create"
				class="space-y-4"
			>
				<div class="form-group">
					<label for="label" class="form-label">
						Label (optional)
					</label>
					<input
						type="text"
						id="label"
						name="label"
						maxlength={MAX_LABEL_LENGTH}
						placeholder="e.g. iPhone, Thunderbird"
						class="form-input"
					/>
				</div>
				<button type="submit" class="btn btn-primary">
					Generate
				</button>
			</form>
		</Card>

		<Card title="Your app passwords" pad={false}>
			{appPasswords.length > 0 ? (
				<ul class="divide-y divide-line">
					{appPasswords.map((ap) => (
						<li class="flex items-center justify-between gap-4 px-5 py-3.5">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-fg">
									{ap.label ? (
										ap.label
									) : (
										<span class="text-subtle">No label</span>
									)}
								</p>
								<p class="truncate font-mono text-xs text-muted">
									{ap.username}
								</p>
								<p class="text-xs text-subtle">
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
								<button type="submit" class="btn btn-danger btn-sm">
									Revoke
								</button>
							</form>
						</li>
					))}
				</ul>
			) : (
				<p class="card-pad text-sm text-muted">
					You don't have any app passwords yet.
				</p>
			)}
		</Card>
	</div>
);
