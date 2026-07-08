import { Context } from "effect";

// ---------------------------------------------------------------------------
// PageCacheService — a random token minted once at server startup.
//
// Folded into every page ETag alongside a request-specific data fingerprint,
// so a deploy/restart invalidates all previously-cached pages immediately —
// independent of whether the fingerprint's inputs happen to capture
// everything that changed in that release.
// ---------------------------------------------------------------------------

export interface PageCacheServiceShape {
	readonly startupToken: string;
}

export class PageCacheService extends Context.Service<
	PageCacheService,
	PageCacheServiceShape
>()("PageCacheService") {}
