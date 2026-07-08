import { PageHeader } from "../ui.tsx";

// ---------------------------------------------------------------------------
// Error pages. Rendered without nav context (they can occur pre-auth), so the
// layout shows minimal chrome. Each links back to a safe place.
// ---------------------------------------------------------------------------

const ErrorBody = ({
	code,
	title,
	message,
}: {
	code: string;
	title: string;
	message: string;
}) => (
	<div class="mx-auto max-w-lg py-8 text-center">
		<p class="text-5xl font-bold text-subtle">{code}</p>
		<div class="mt-4">
			<PageHeader title={title} />
		</div>
		<p class="text-muted">{message}</p>
		<p class="mt-6">
			<a href="/ui" class="btn btn-primary">
				Back to dashboard
			</a>
		</p>
	</div>
);

export const ForbiddenPage = () => (
	<ErrorBody
		code="403"
		title="Forbidden"
		message="You don't have permission to view this page."
	/>
);

export const NotFoundPage = () => (
	<ErrorBody
		code="404"
		title="Not found"
		message="The page you're looking for doesn't exist."
	/>
);

export const ServerErrorPage = () => (
	<ErrorBody
		code="500"
		title="Something went wrong"
		message="An unexpected error occurred. Please try again."
	/>
);
