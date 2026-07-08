import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	type InstanceId,
	type PrincipalId,
} from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { BulkJobProgress } from "#src/http/ui/view/pages/contacts/list.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService, type AclServiceShape } from "#src/services/acl/service.ts";
import {
	type BulkJobRepository,
	runChunkedJob,
} from "#src/services/bulk-job/index.ts";
import type { CardEditServiceShape } from "#src/services/card-edit/service.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import type { InstanceRepositoryShape } from "#src/services/instance/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { contactsRedirect, parseBulkSelection } from "./bulk-shared.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/bulk-clear-photo
//
// Removes the PHOTO property from every selected contact (a structural edit
// that preserves all other vCard properties), chunked via runChunkedJob for
// htmx requests. Missing contacts are skipped; an unauthorized contact fails
// the whole batch.
// ---------------------------------------------------------------------------

const clearPhotoOne = (
	principalId: PrincipalId,
	acl: AclServiceShape,
	cardEdit: CardEditServiceShape,
	instanceRepo: InstanceRepositoryShape,
	id: InstanceId,
): Effect.Effect<
	{ ok: boolean },
	DavError | DatabaseError | InternalError,
	never
> =>
	Effect.gen(function* () {
		const instanceOpt = yield* instanceRepo.findById(id);
		if (Option.isNone(instanceOpt)) {
			return { ok: false };
		}
		yield* acl.check(
			principalId,
			CollectionId(instanceOpt.value.collectionId),
			"collection",
			"DAV:write-content",
		);
		yield* cardEdit.removePhoto(id);
		return { ok: true };
	});

export const contactsBulkClearPhotoHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | BulkJobRepository | CardEditService | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cardEdit = yield* CardEditService;
		const instanceRepo = yield* InstanceRepository;

		const { ids, addressbook } = yield* parseBulkSelection(req);
		const redirect = contactsRedirect(addressbook);

		if (isHtmxRequest(ctx.headers)) {
			const job = yield* runChunkedJob({
				kind: "bulk_clear_photo",
				ownerPrincipalId: principal.principalId,
				items: ids,
				input: { addressbook },
				perItem: (id) =>
					clearPhotoOne(principal.principalId, acl, cardEdit, instanceRepo, id),
				onDone: () => Effect.succeed({}),
			});
			return yield* renderFragment(<BulkJobProgress jobId={job.id} />);
		}

		yield* Effect.forEach(
			ids,
			(id) =>
				clearPhotoOne(principal.principalId, acl, cardEdit, instanceRepo, id),
			{ discard: true },
		);
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
