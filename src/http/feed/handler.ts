import { Effect, Option } from "effect";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	HTTP_OK,
} from "#src/http/status.ts";
import type { ComponentRepository } from "#src/services/component/repository.ts";
import { renderFeed } from "#src/services/feed/render.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// feedHandler — `GET /feed/<token>.ics`
//
// Public, unauthenticated endpoint. The token is the share_link.token value.
// Returns 200 text/calendar on success, 404 for unknown / disabled / expired
// tokens, and 405 for non-GET methods.
// ---------------------------------------------------------------------------

const NOT_FOUND_RESPONSE = (): Response =>
	new Response("Not Found", { status: HTTP_NOT_FOUND });

const sanitizeFilename = (raw: string): string =>
	raw.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "feed";

export const feedHandler = (
	req: Request,
	url: URL,
): Effect.Effect<
	Response,
	DatabaseError | InternalError,
	ShareLinkService | InstanceRepository | ComponentRepository
> =>
	Effect.gen(function* () {
		if (req.method !== "GET" && req.method !== "HEAD") {
			return new Response("Method Not Allowed", {
				status: HTTP_METHOD_NOT_ALLOWED,
				headers: { Allow: "GET, HEAD" },
			});
		}

		// Expect /feed/<token>.ics
		const match = url.pathname.match(/^\/feed\/([^/]+?)\.ics$/);
		if (match === null) {
			return NOT_FOUND_RESPONSE();
		}
		const rawToken = match[1];
		if (rawToken === undefined || rawToken.length === 0) {
			return NOT_FOUND_RESPONSE();
		}
		const token = decodeURIComponent(rawToken);

		const svc = yield* ShareLinkService;
		const summaryOpt = yield* svc.getActiveByToken(token);
		if (Option.isNone(summaryOpt)) {
			return NOT_FOUND_RESPONSE();
		}

		const body = yield* renderFeed(summaryOpt.value);
		const bytes = new TextEncoder().encode(body);
		const filename = sanitizeFilename(
			summaryOpt.value.link.displayName ?? "feed",
		);
		const headers = new Headers({
			"Content-Type": "text/calendar; charset=utf-8",
			"Content-Length": String(bytes.byteLength),
			"Content-Disposition": `inline; filename="${filename}.ics"`,
			"Cache-Control": "private, max-age=60",
		});
		return new Response(req.method === "HEAD" ? null : bytes, {
			status: HTTP_OK,
			headers,
		});
	});

export const isFeedPath = (pathname: string): boolean =>
	pathname.startsWith("/feed/");
