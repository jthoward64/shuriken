import { Effect, Option, Schema } from "effect";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, InstanceId, isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	CleanupDone,
	CleanupError,
} from "#src/http/ui/view/pages/contacts/cleanup.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/service.ts";
import { applyAreaCode } from "#src/services/contact-cleanup/phone.ts";
import { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";
import {
	type CleanupFix,
	CleanupFixSchema,
} from "#src/services/contact-cleanup/types.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/contacts/cleanup/fix
//
// Applies a single cleanup suggestion. The suggestion's `fix` intent is posted
// as JSON; area-code and label suggestions carry an extra input (`areaCode` /
// `newType`) that finalises the fix here. On success the suggestion's list item
// is swapped for a confirmation; a stale/precondition failure swaps in an inline
// error asking the user to rescan.
// ---------------------------------------------------------------------------

const decodeFix = Schema.decodeUnknownOption(CleanupFixSchema);

const errorFragment = (message: string) =>
	renderFragment(<CleanupError message={message} />);

export const contactsCleanupFixHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | ContactCleanupService | InstanceService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const cleanup = yield* ContactCleanupService;
		const instanceSvc = yield* InstanceService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const instanceIdRaw = form.get("instanceId")?.toString() ?? "";
		if (!isUuid(instanceIdRaw)) {
			return yield* Effect.fail(badRequest("invalid contact id"));
		}
		const instanceId = InstanceId(instanceIdRaw);

		const parsed = yield* Effect.try({
			try: () => JSON.parse(form.get("fix")?.toString() ?? ""),
			catch: () => badRequest("invalid fix payload"),
		});
		const baseFix = yield* Option.match(decodeFix(parsed), {
			onNone: () => Effect.fail(badRequest("invalid fix payload")),
			onSome: Effect.succeed,
		});

		// Authorise against the contact's collection (as the DAV PUT path does).
		const existing = yield* instanceSvc.findById(instanceId);
		yield* acl.check(
			principal.principalId,
			CollectionId(existing.collectionId),
			"collection",
			"DAV:write-content",
		);

		// Finalise fixes that depend on user input.
		const fixResult = finalizeFix(baseFix, form);
		if (!fixResult.ok) {
			return yield* errorFragment(fixResult.message);
		}

		return yield* cleanup.applyFix(instanceId, fixResult.fix).pipe(
			Effect.flatMap(() =>
				renderFragment(
					<CleanupDone contactFn={form.get("contactFn")?.toString() ?? ""} />,
				),
			),
			// Stale scan / precondition → inline "rescan" prompt instead of a 409 page.
			Effect.catchTag("DavError", (e) =>
				errorFragment(
					e.message ?? "This contact changed since the scan — rescan to retry.",
				),
			),
		);
	});

// Fill in the value that needed user input; returns a tagged result so the
// caller can render an inline error without failing the whole effect.
const finalizeFix = (
	fix: CleanupFix,
	form: FormData,
):
	| { readonly ok: true; readonly fix: CleanupFix }
	| { readonly ok: false; readonly message: string } => {
	if (fix._tag === "SetPhone" && fix.next === "") {
		const areaCode = form.get("areaCode")?.toString().trim() ?? "";
		if (areaCode === "") {
			return { ok: false, message: "Enter an area code first." };
		}
		const region = form.get("region")?.toString() ?? "";
		const next = applyAreaCode(fix.current, areaCode, region);
		if (next === null) {
			return {
				ok: false,
				message: "That area code didn't produce a valid number.",
			};
		}
		return { ok: true, fix: { ...fix, next } };
	}
	if (fix._tag === "SetLabel") {
		const chosen = form.get("newType")?.toString() ?? "";
		return {
			ok: true,
			fix: { ...fix, newType: chosen === "" ? null : chosen },
		};
	}
	if (fix._tag === "SetAbLabel") {
		const chosen = form.get("newType")?.toString() ?? "";
		return {
			ok: true,
			fix: { ...fix, newLabel: chosen === "" ? null : chosen },
		};
	}
	return { ok: true, fix };
};
