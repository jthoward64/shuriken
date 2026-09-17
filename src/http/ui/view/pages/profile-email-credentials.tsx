import type { VNode } from "preact";
import { Button, LinkButton } from "../components/button.tsx";
import { Badge, type BadgeTone, Card } from "../components/display.tsx";
import { Field, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

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

const STATUS_TONE: Record<ActiveKind, BadgeTone> = {
	user: "success",
	profile: "brand",
	default: "neutral",
	disabled: "warning",
};

const SECURITY_OPTIONS = [
	{ value: "none", label: "None" },
	{ value: "starttls", label: "STARTTLS" },
	{ value: "tls", label: "TLS / SSL" },
];

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
			<Breadcrumb
				items={[
					{ label: "Profile", href: "/ui/profile" },
					{ label: "Email credentials" },
				]}
			/>
			<PageHeader
				title="Email credentials"
				subtitle="How outbound invitation mail is sent on your behalf."
			/>
		</div>

		<Card title="Current status">
			<div class="flex flex-wrap items-center gap-2">
				<Badge tone={STATUS_TONE[activeKind]}>{activeKind}</Badge>
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
					<Field for="fromAddress" label="From address" required>
						<TextInput
							required
							type="email"
							id="fromAddress"
							name="fromAddress"
							value={existing ? existing.fromAddress : userEmail}
						/>
					</Field>
					<Field for="fromName" label="From display name">
						<TextInput
							id="fromName"
							name="fromName"
							value={existing ? existing.fromName : ""}
						/>
					</Field>
					<Field for="host" label="SMTP host" required>
						<TextInput
							required
							id="host"
							name="host"
							value={existing ? existing.host : ""}
							placeholder="smtp.example.com"
						/>
					</Field>
					<Field for="port" label="Port" required>
						<TextInput
							required
							type="number"
							min={1}
							max={MAX_TCP_PORT}
							id="port"
							name="port"
							value={existing ? existing.port : DEFAULT_SMTP_PORT}
						/>
					</Field>
					<Field for="username" label="Username" required>
						<TextInput
							required
							id="username"
							name="username"
							value={existing ? existing.username : ""}
						/>
					</Field>
					<Field for="password" label="Password" required>
						<TextInput
							required
							type="password"
							id="password"
							name="password"
							autocomplete="new-password"
							placeholder={existing ? "Leave blank to keep current" : ""}
						/>
					</Field>
					<Field
						for="security"
						label="Connection security"
						class="md:col-span-2"
					>
						<Select
							id="security"
							name="security"
							options={SECURITY_OPTIONS}
							value={existing ? existing.security : "starttls"}
						/>
					</Field>
				</div>

				<div class="flex flex-wrap gap-3 pt-1">
					<Button type="submit" variant="primary">
						Save credentials
					</Button>
					<LinkButton href="/ui/profile">Cancel</LinkButton>
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
					<Button type="submit" variant="danger">
						Clear credentials
					</Button>
				</form>
			</Card>
		)}
	</div>
);
