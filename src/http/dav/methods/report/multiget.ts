// ---------------------------------------------------------------------------
// Shared multiget logic — RFC 4791 §7.9 (calendar) + RFC 6352 §8.7 (card)
//
// Given a list of hrefs from the REPORT body, resolves each to an instance
// in the target collection, loads the component tree, applies subsetting,
// and builds a 207 Multi-Status response.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import type { ClarkName, IrDocument } from "#src/data/ir.ts";
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
	readonly entityType: "icalendar" | "vcard";
	/** Origin for ACL checks. */
	readonly origin: string;
	/** Apply subsetting and serialize the IrDocument to a string. */
	readonly serializeData: (
		doc: IrDocument,
		tree: unknown,
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

		const responses: Array<DavResponse> = [];

		for (const href of params.hrefs) {
			// Extract the last path segment (slug or UUID)
			const seg = href.split("/").filter(Boolean).at(-1) ?? "";

			// Resolve to an InstanceRow
			const instOpt = yield* isUuid(seg)
				? instSvc.findById(InstanceId(seg)).pipe(
						Effect.map(Option.some),
						Effect.orElseSucceed(() => Option.none()),
					)
				: instSvc.findBySlug(params.collectionId, seg as Slug).pipe(
						Effect.map(Option.some),
						Effect.orElseSucceed(() => Option.none()),
					);

			if (Option.isNone(instOpt)) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
				continue;
			}

			const inst = instOpt.value;

			// Verify the instance belongs to this collection
			if (inst.collectionId !== params.collectionId) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
				continue;
			}

			// ACL check — per-resource 403 on failure (RFC 4791 §7.9.1)
			const canRead = yield* acl
				.check(
					params.actingPrincipalId,
					InstanceId(inst.id),
					"instance",
					"DAV:read",
				)
				.pipe(
					Effect.map(() => true),
					Effect.catchTag("DavError", () => Effect.succeed(false)),
				);
			if (!canRead) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 403 }],
				});
				continue;
			}

			// Load component tree
			const treeOpt = yield* compRepo.loadTree(
				inst.entityId as unknown as EntityId,
				params.entityType,
			);

			if (Option.isNone(treeOpt)) {
				responses.push({
					href,
					propstats: [{ props: {} as Record<ClarkName, unknown>, status: 404 }],
				});
				continue;
			}

			const irDoc: IrDocument =
				params.entityType === "icalendar"
					? { kind: "icalendar", root: treeOpt.value }
					: { kind: "vcard", root: treeOpt.value };

			// Serialize (with subsetting applied inside serializeData)
			const dataStr = yield* params.serializeData(irDoc, params.dataTree);

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
