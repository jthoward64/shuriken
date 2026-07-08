import type { VNode } from "preact";
import { Card, PageHeader } from "../ui.tsx";

// ---------------------------------------------------------------------------
// GET /ui/profile/email-credentials — manage per-user SMTP credentials and show
// which layer (user / profile / default / disabled) currently sends the user's
// outbound invitation mail.
// ---------------------------------------------------------------------------

const DEFAULT_SMTP_PORT = 587;
const MAX_TCP_PORT = 65535;

export type ActiveKind = "user" | "profile" | "default" | "disabled";

export interface ExistingCredential {
	readonly fromAddress: string;
	readonly fromName: string;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly security: string;
}

export interface EmailCredentialsPageProps {
	readonly userEmail: string;
	readonly existing: ExistingCredential | null;
	readonly mailEnabled: boolean;
	readonly credsKeyConfigured: boolean;
	readonly activeKind: ActiveKind;
	readonly activeFromAddress: string;
}

const STATUS_TEXT: Record<ActiveKind, string> = {
	user: "Sending mail with your own SMTP credentials.",
	profile:
		"Sending mail through a server-wide profile that matches your address.",
	default:
		"Sending mail through the server's default relay; replies go to your address.",
	disabled: "Mail is currently disabled on this server.",
};

const STATUS_BADGE: Record<ActiveKind, string> = {
	user: "badge badge-success",
	profile: "badge badge-brand",
	default: "badge",
	disabled: "badge badge-warning",
};

const Breadcrumb = ({ title }: { title: string }) => (
	<nav aria-label="Breadcrumb" class="mb-2 flex items-center gap-2 text-sm">
		<a href="/ui/profile" class="link">
			Profile
		</a>
		<span class="text-subtle">/</span>
		<span class="text-muted">{title}</span>
	</nav>
);

const SecurityOption = ({
	value,
	label,
	selected,
}: {
	value: string;
	label: string;
	selected: boolean;
}) =>
	selected ? (
		<option value={value} selected>
			{label}
		</option>
	) : (
		<option value={value}>{label}</option>
	);

export const EmailCredentialsPage = ({
	userEmail,
	existing,
	mailEnabled,
	credsKeyConfigured,
	activeKind,
	activeFromAddress,
}: EmailCredentialsPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb title="Email credentials" />
			<PageHeader
				title="Email credentials"
				subtitle="How outbound invitation mail is sent on your behalf."
			/>
		</div>

		<Card title="Current status">
			<div class="flex flex-wrap items-center gap-2">
				<span class={STATUS_BADGE[activeKind]}>{activeKind}</span>
				<span class="text-sm text-muted">{STATUS_TEXT[activeKind]}</span>
			</div>
			{activeFromAddress && (
				<p class="mt-3 text-sm">
					<span class="font-medium text-fg">Outgoing From:</span>{" "}
					<span class="font-mono text-muted">{activeFromAddress}</span>
				</p>
			)}
			{!mailEnabled && (
				<p class="mt-3 text-sm text-muted">
					Set <code class="font-mono">MAIL_ENABLED=true</code> in the server
					config to enable outbound mail.
				</p>
			)}
			{!credsKeyConfigured && (
				<p class="mt-1 text-sm text-muted">
					<code class="font-mono">EMAIL_CREDS_KEY</code> is not set, so per-user
					credentials cannot be saved.
				</p>
			)}
		</Card>

		<Card title="Override with your own SMTP server">
			<p class="mb-4 text-sm text-muted">
				If your provider gives you SMTP credentials, enter them here so mail
				goes out as you.
			</p>
			<form
				method="POST"
				action="/ui/api/profile/email-credentials/save"
				class="space-y-4"
			>
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div class="form-group">
						<label for="fromAddress" class="form-label">
							From address <span class="text-danger">*</span>
						</label>
						<input
							required
							type="email"
							id="fromAddress"
							name="fromAddress"
							value={existing ? existing.fromAddress : userEmail}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="fromName" class="form-label">
							From display name
						</label>
						<input
							type="text"
							id="fromName"
							name="fromName"
							value={existing ? existing.fromName : ""}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="host" class="form-label">
							SMTP host <span class="text-danger">*</span>
						</label>
						<input
							required
							type="text"
							id="host"
							name="host"
							value={existing ? existing.host : ""}
							placeholder="smtp.example.com"
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="port" class="form-label">
							Port <span class="text-danger">*</span>
						</label>
						<input
							required
							type="number"
							min={1}
							max={MAX_TCP_PORT}
							id="port"
							name="port"
							value={existing ? existing.port : DEFAULT_SMTP_PORT}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="username" class="form-label">
							Username <span class="text-danger">*</span>
						</label>
						<input
							required
							type="text"
							id="username"
							name="username"
							value={existing ? existing.username : ""}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="password" class="form-label">
							Password <span class="text-danger">*</span>
						</label>
						<input
							required
							type="password"
							id="password"
							name="password"
							autocomplete="new-password"
							placeholder={existing ? "Leave blank to keep current" : ""}
							class="form-input"
						/>
					</div>
					<div class="form-group md:col-span-2">
						<label for="security" class="form-label">
							Connection security
						</label>
						<select id="security" name="security" class="form-select">
							<SecurityOption
								value="none"
								label="None"
								selected={existing?.security === "none"}
							/>
							<SecurityOption
								value="starttls"
								label="STARTTLS"
								selected={existing ? existing.security === "starttls" : true}
							/>
							<SecurityOption
								value="tls"
								label="TLS / SSL"
								selected={existing?.security === "tls"}
							/>
						</select>
					</div>
				</div>

				<div class="flex flex-wrap gap-3 pt-1">
					<button type="submit" class="btn btn-primary">
						Save credentials
					</button>
					<a href="/ui/profile" class="btn btn-secondary">
						Cancel
					</a>
				</div>
			</form>
		</Card>

		{existing && (
			<Card title="Remove credentials">
				<p class="mb-4 text-sm text-muted">
					Fall back to the server profile or default relay.
				</p>
				<form
					method="POST"
					action="/ui/api/profile/email-credentials/clear"
					data-confirm="Remove your saved SMTP credentials? You will fall back to the server profile or default."
				>
					<button type="submit" class="btn btn-danger">
						Clear credentials
					</button>
				</form>
			</Card>
		)}
	</div>
);
