import { Effect } from "effect";
import type { DatabaseClient } from "#src/db/client.ts";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import {
	BulkJobProgress,
	ImportResult,
} from "#src/http/ui/view/pages/contacts/list.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { fireAndForgetBirthdayRegenerate } from "#src/services/birthday/event-hook.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import {
	type BulkJobRepository,
	runChunkedJob,
} from "#src/services/bulk-job/index.ts";
import {
	detectConflicts,
	type ImportMode,
	importVcf,
	parseVcfCards,
	writeCard,
} from "#src/services/card-edit/import-vcf.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/repository.ts";
import type { EntityRepository } from "#src/services/entity/repository.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { InstanceService } from "#src/services/instance/service.ts";

const isImportMode = (raw: string): raw is ImportMode =>
	raw === "error" || raw === "skip" || raw === "merge";

export const contactsImportHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| BirthdayService
	| BulkJobRepository
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| ExternalCalendarRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:bind",
		);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const file = form.get("file");
		if (!(file instanceof File)) {
			return yield* Effect.fail(badRequest("missing 'file' upload"));
		}
		const modeRaw = form.get("mode")?.toString() ?? "error";
		if (!isImportMode(modeRaw)) {
			return yield* Effect.fail(badRequest("invalid mode"));
		}

		const text = yield* Effect.tryPromise({
			try: () => file.text(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const htmx = isHtmxRequest(ctx.headers);

		// htmx: parse + detect conflicts up front (so a rejected "error"-mode file
		// still surfaces immediately, matching the no-JS UX below) then chunk the
		// actual writes via runChunkedJob for progress + no request-timeout risk.
		if (htmx) {
			const parsed = yield* parseVcfCards(text);
			if (parsed.length === 0) {
				return yield* renderFragment(
					<ImportResult conflict={false} inserted={0} skipped={0} merged={0} />,
				);
			}
			const conflicts = yield* detectConflicts(collectionId, parsed);
			if (modeRaw === "error" && conflicts.length > 0) {
				// Conflicts only — nothing was written, so no list refresh needed.
				return yield* renderFragment(
					<ImportResult conflict conflicts={conflicts} />,
				);
			}
			const conflictSet = new Set(conflicts);
			let inserted = 0;
			let skipped = 0;
			let merged = 0;
			const job = yield* runChunkedJob<
				(typeof parsed)[number],
				DavError | DatabaseError,
				| BirthdayService
				| CollectionRepository
				| ComponentRepository
				| DatabaseClient
				| EntityRepository
				| ExternalCalendarRepository
				| InstanceService
			>({
				kind: "import",
				ownerPrincipalId: principal.principalId,
				collectionId,
				items: parsed,
				input: { mode: modeRaw },
				perItem: (p) => {
					const conflict = conflictSet.has(p.uid);
					if (conflict && modeRaw === "skip") {
						skipped += 1;
						return Effect.succeed({ ok: true });
					}
					const replaceExisting = conflict && modeRaw === "merge";
					return writeCard(collectionId, p.uid, p.root, replaceExisting).pipe(
						Effect.map(() => {
							if (replaceExisting) {
								merged += 1;
							} else {
								inserted += 1;
							}
							return { ok: true };
						}),
					);
				},
				onDone: () =>
					Effect.gen(function* () {
						if (inserted > 0 || merged > 0) {
							yield* fireAndForgetBirthdayRegenerate(collectionId);
						}
						return { result: { inserted, skipped, merged } };
					}),
			});
			return yield* renderFragment(<BulkJobProgress jobId={job.id} />);
		}

		// No-JS: fully synchronous, exactly as before.
		const result = yield* importVcf(collectionId, text, modeRaw);

		if (modeRaw === "error" && result.conflicts.length > 0) {
			return new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: {
					Location: `/ui/contacts?conflicts=${result.conflicts.length}`,
				},
			});
		}

		const params = new URLSearchParams({
			imported: String(result.inserted),
			skipped: String(result.skipped),
			merged: String(result.merged),
		});
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: `/ui/contacts?${params.toString()}` },
		});
	});
