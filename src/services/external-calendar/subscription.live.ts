import { Effect, Layer, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	type ConflictError,
	conflict,
	type DatabaseError,
	DavError,
	forbidden,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type UuidString } from "#src/domain/ids.ts";
import { isValidSlug, Slug } from "#src/domain/types/path.ts";
import { HTTP_BAD_REQUEST } from "#src/http/status.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ExternalCalendarRepository } from "./repository.ts";
import {
	type SubscribeInput,
	type SubscribeResult,
	SubscriptionService,
} from "./subscription.ts";

// ---------------------------------------------------------------------------
// Live SubscriptionService — concrete subscribe + unsubscribe flows.
// ---------------------------------------------------------------------------

/**
 * Reject obviously-bad subscription URLs at the edge. Lets non-http(s)
 * schemes (file:, gopher:, javascript:) and malformed URLs fail with a
 * useful message rather than reaching the HttpClient and erroring with a
 * stack trace.
 */
const validateUrl = (raw: string): Effect.Effect<URL, DavError> =>
	Effect.try({
		try: () => new URL(raw),
		catch: () =>
			new DavError({
				status: HTTP_BAD_REQUEST,
				message: `Invalid URL: ${raw}`,
			}),
	}).pipe(
		Effect.flatMap((u) =>
			u.protocol === "http:" || u.protocol === "https:"
				? Effect.succeed(u)
				: Effect.fail(
						new DavError({
							status: HTTP_BAD_REQUEST,
							message: `Unsupported scheme: ${u.protocol}`,
						}),
					),
		),
	);

const subscribe = (
	input: SubscribeInput,
): Effect.Effect<
	SubscribeResult,
	DatabaseError | DavError | ConflictError | InternalError,
	ExternalCalendarRepository | CollectionService | AppConfigService
> =>
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const repo = yield* ExternalCalendarRepository;
		const collSvc = yield* CollectionService;

		yield* validateUrl(input.url);
		if (!isValidSlug(input.slug)) {
			return yield* forbidden();
		}

		// 1. Find-or-insert the shared external_calendar row. `upsertByUrl`
		//    races safely on concurrent subscribers.
		const external = yield* repo.upsertByUrl({
			url: input.url,
			syncIntervalS: input.syncIntervalS,
		});

		// 2. Soft cap — refuse the (N+1)th claim per URL.
		const existingClaims = yield* repo.countClaimsForExternal(external.id);
		if (existingClaims >= config.externalCalendar.claimCap) {
			return yield* conflict(
				undefined,
				`External calendar already has ${existingClaims} subscribers (cap: ${config.externalCalendar.claimCap}).`,
			);
		}

		// 3. Provision the local dav_collection that surfaces this subscription
		//    to the current user. supportedComponents matches a normal calendar
		//    so clients render it the same way.
		const collection = yield* collSvc.create({
			ownerPrincipalId: input.principalId,
			collectionType: "calendar",
			slug: Slug(input.slug),
			displayName:
				input.displaynameOverride ?? external.defaultDisplayname ?? undefined,
			supportedComponents: ["VEVENT", "VTODO", "VJOURNAL"],
		});

		// 4. Insert the claim. uniqueness on (external_calendar_id, collection_id)
		//    means a retry of the same subscribe is a 409 — caller can map to UI.
		const claim = yield* repo.insertClaim({
			externalCalendarId: external.id,
			collectionId: CollectionId(collection.id),
			syncIntervalS: input.syncIntervalS,
			...(input.colorOverride !== undefined
				? { colorOverride: input.colorOverride }
				: {}),
			...(input.displaynameOverride !== undefined
				? { displaynameOverride: input.displaynameOverride }
				: {}),
		});

		// 5. The new claim may want a tighter interval than the parent's
		//    current setting — MIN-recompute keeps the scheduler's findDue
		//    query producing the right rows.
		yield* repo.recomputeSyncInterval(external.id);

		// 6. CRITICAL: clear the parent's conditional-GET validators. If a
		//    previous claim's sync already populated etag/last_modified, the
		//    next fetch would return 304 and skip parsing — meaning the new
		//    claim's collection would never get its events. Clearing forces
		//    an unconditional refetch next tick.
		yield* repo.clearHttpCache(external.id);

		return {
			externalCalendarId: external.id,
			claimId: claim.id,
			collectionId: CollectionId(collection.id),
		};
	});

const unsubscribe = (
	claimId: UuidString,
): Effect.Effect<
	void,
	DatabaseError | DavError | InternalError,
	ExternalCalendarRepository | CollectionService
> =>
	Effect.gen(function* () {
		const repo = yield* ExternalCalendarRepository;
		const collSvc = yield* CollectionService;

		const claimOpt = yield* repo.findClaimById(claimId);
		if (Option.isNone(claimOpt)) {
			return yield* Effect.fail(
				new InternalError({ cause: new Error("claim not found") }),
			);
		}
		const claim = claimOpt.value;

		yield* repo.deleteClaim(claimId);
		yield* collSvc.delete(CollectionId(claim.collectionId));

		const remaining = yield* repo.countClaimsForExternal(
			claim.externalCalendarId,
		);
		if (remaining === 0) {
			yield* repo.softDelete(claim.externalCalendarId);
		} else {
			yield* repo.recomputeSyncInterval(claim.externalCalendarId);
		}
	});

export const SubscriptionServiceLive = Layer.effect(
	SubscriptionService,
	Effect.gen(function* () {
		const repo = yield* ExternalCalendarRepository;
		const collSvc = yield* CollectionService;
		const config = yield* AppConfigService;
		return {
			subscribe: (input) =>
				subscribe(input).pipe(
					Effect.provideService(ExternalCalendarRepository, repo),
					Effect.provideService(CollectionService, collSvc),
					Effect.provideService(AppConfigService, config),
				),
			unsubscribe: (id) =>
				unsubscribe(id).pipe(
					Effect.provideService(ExternalCalendarRepository, repo),
					Effect.provideService(CollectionService, collSvc),
				),
		};
	}),
);
