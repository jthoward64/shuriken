// ---------------------------------------------------------------------------
// Shared multiget logic — RFC 4791 §7.9 (calendar) + RFC 6352 §8.7 (card)
//
// Given a list of hrefs from the REPORT body, resolves each to an instance
// in the target collection, loads the component tree, applies subsetting,
// and builds a 207 Multi-Status response.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";
import { InstanceId, isUuid } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import {
	buildInstanceProps,
	type PropfindKind,
	splitPropstats,
} from "#src/http/dav/methods/instance-props.ts";
import type { DavResponse } from "#src/http/dav/xml/multistatus.ts";
import { multistatusResponse } from "#src/http/dav/xml/multistatus.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// Multiget params
// ---------------------------------------------------------------------------

export interface MultigetParams {
	/** Hrefs from <D:href> elements in the REPORT body. */
	readonly hrefs: ReadonlyArray<string>;
	/** The collection being queried. */
	readonly collectionId: CollectionId;
	/** Acting principal (for ACL checks). */
	readonly actingPrincipalId: PrincipalId;
	/** Prop names from <D:prop> in the body (empty set → allprop). */
	readonly propNames: ReadonlySet<ClarkName>;
	/** Entity type to pass to ComponentRepository.loadTree. */
	readonly entityType: EntityType;
	/** Origin for ACL checks. */
	readonly origin: string;
	/**
	 * Apply subsetting and serialize the IrDocument to a string. `hasFullRead`
	 * is false when the caller holds only CALDAV:read-free-busy (not
	 * DAV:read) on this member — callers should redact private fields in
	 * that case (see src/data/icalendar/visibility.ts).
	 */
	readonly serializeData: (
		doc: IrDocument,
		tree: unknown,
		hasFullRead: boolean,
	) => Effect.Effect<string, never>;
	/** Clark name of the data property to include (e.g. {caldav}calendar-data). */
	readonly dataClarkName: ClarkName;
	/** Raw calendar-data / address-data element tree from the REPORT body. */
	readonly dataTree: unknown;
}

// ---------------------------------------------------------------------------
// multigetHandler
// ---------------------------------------------------------------------------

/**
 * Resolve each href to an instance, load its component tree, apply data
 * subsetting, and return a 207 Multi-Status response.
 *
 * For instances that cannot be found (or belong to a different collection),
 * a 404 DavResponse is included in the result.
 *
 * The response href mirrors the request href (CLAUDE.md DAV URL policy).
 */
export const multigetHandler = (
	params: MultigetParams,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	InstanceService | ComponentRepository | AclService
> =>
	Effect.gen(function* () {
		const instSvc = yield* InstanceService;
		const compRepo = yield* ComponentRepository;
		const acl = yield* AclService;

		const propfind: PropfindKind =
			params.propNames.size > 0
				? { type: "prop", names: params.propNames }
				: { type: "allprop" };

		// Pass 1 — resolve every href to an instance (or mark it 404). Resolution
		// is a point lookup per href; we collect the found instances so their
		// component trees can be batch-loaded in 3 queries instead of 3 per href.
		const resolved = yield* Effect.forEach(params.hrefs, (href) => {
			// Extract the last path segment (slug or UUID)
			const seg = href.split("/").filter(Boolean).at(-1) ?? "";
			return (
				isUuid(seg)
					? instSvc.findById(InstanceId(seg)).pipe(
							Effect.map(Option.some),
							Effect.orElseSucceed(() => Option.none()),
						)
					: instSvc.findBySlug(params.collectionId, seg as Slug).pipe(
							Effect.map(Option.some),
							Effect.orElseSucceed(() => Option.none()),
						)
			).pipe(
				Effect.map((instOpt) => {
					// Treat instances outside this collection as not found.
					const inCollection = Option.filter(
						instOpt,
						(inst) => inst.collectionId === params.collectionId,
					);
					return { href, inst: Option.getOrNull(inCollection) };
				}),
			);
		});

		// Batch-load trees for every resolved instance (3 queries total).
		const trees = yield* compRepo.loadTreesByIds(
			resolved.flatMap((r) =>
				r.inst === null ? [] : [r.inst.entityId as unknown as EntityId],
			),
			params.entityType,
		);

		// Authorize all resolved members in one batch (every member shares this
		// collection as its ACL parent) instead of a per-href check. Preserves the
		// per-resource 403 semantics of RFC 4791 §7.9.1. Two batches (both
		// role-bypass-aware via batchCheckMembers, unlike batchMemberPrivileges)
		// rather than one: `readable` gates enumeration at all (satisfied by
		// CALDAV:read-free-busy or DAV:read), `fullReadable` gates whether the
		// body is redacted.
		const memberIds = resolved.flatMap((r) =>
			r.inst === null ? [] : [InstanceId(r.inst.id)],
		);
		const readable = yield* acl.batchCheckMembers(
			params.actingPrincipalId,
			params.collectionId,
			"collection",
			memberIds,
			"instance",
			"CALDAV:read-free-busy",
		);
		const fullReadable = yield* acl.batchCheckMembers(
			params.actingPrincipalId,
			params.collectionId,
			"collection",
			memberIds,
			"instance",
			"DAV:read",
		);

		// Pass 2 — build a response per href, preserving request order.
		const responses: Array<DavResponse> = [];
		for (const { href, inst } of resolved) {
			if (inst === null) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
				continue;
			}

			// ACL check — per-resource 403 on failure (RFC 4791 §7.9.1)
			const hasFullRead = fullReadable.has(InstanceId(inst.id));
			// Free-busy-only access has no meaning for CardDAV contacts — treat as
			// unreadable rather than leak the full vCard.
			if (
				!readable.has(InstanceId(inst.id)) ||
				(params.entityType !== "icalendar" && !hasFullRead)
			) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 403 }],
				});
				continue;
			}

			const tree = trees.get(inst.entityId as unknown as EntityId);
			if (tree === undefined) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
				continue;
			}

			const irDoc: IrDocument =
				params.entityType === "icalendar"
					? { kind: "icalendar", root: tree }
					: { kind: "vcard", root: tree };

			// Serialize (with subsetting applied inside serializeData)
			const dataStr = yield* params.serializeData(
				irDoc,
				params.dataTree,
				hasFullRead,
			);

			// Build propstat
			const baseProps = buildInstanceProps(inst);
			const allProps: Record<ClarkName, unknown> = {
				...baseProps,
				[params.dataClarkName]: dataStr,
			};

			responses.push({
				href,
				propstats: splitPropstats(allProps, propfind),
			});
		}

		return yield* multistatusResponse(responses);
	});
