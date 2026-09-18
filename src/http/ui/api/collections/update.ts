import { Effect } from "effect";
import type { ClarkName, IrDeadProperties } from "#src/data/ir.ts";
import { CALENDAR_COLOR, fromCssHex } from "#src/domain/calendar-color.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { sanitizeReturnTo } from "#src/http/ui/handlers/auth/helpers.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/update
// ---------------------------------------------------------------------------

// Editing a collection's properties needs write-properties on it, or admin
// rights on either virtual directory
const authorizeEdit = Effect.fn("ui.collections.update.authorize")(function* (
	callerPrincipalId: PrincipalId,
	collectionId: CollectionId,
) {
	const acl = yield* AclService;
	const [collPrivs, usersPrivs, groupsPrivs] = yield* Effect.all([
		acl.currentUserPrivileges(callerPrincipalId, collectionId, "collection"),
		acl.currentUserPrivileges(
			callerPrincipalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
		),
		acl.currentUserPrivileges(
			callerPrincipalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		),
	]);
	const isAdmin =
		usersPrivs.includes("DAV:write-properties") ||
		groupsPrivs.includes("DAV:write-properties");
	if (collPrivs.includes("DAV:write-properties") || isAdmin) {
		return;
	}
	yield* acl.check(
		callerPrincipalId,
		collectionId,
		"collection",
		"DAV:write-properties",
	);
});

// Preserve existing dead properties - updateProperties replaces the whole
// clientProperties JSONB, so they are merged rather than wiped (which would lose
// calendar-color and any other DAV-client-set dead prop)
const mergedClientProperties = (
	existing: IrDeadProperties | null,
	form: FormData,
): Record<ClarkName, unknown> => {
	const merged: Record<ClarkName, unknown> = { ...(existing ?? {}) };
	if (!form.has("color")) {
		return merged;
	}
	const appleColor = fromCssHex(form.get("color")?.toString() ?? "");
	if (appleColor === undefined) {
		delete merged[CALENDAR_COLOR];
		return merged;
	}
	merged[CALENDAR_COLOR] = appleColor;
	return merged;
};

export const collectionsUpdateHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CollectionService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const collectionService = yield* CollectionService;

		const collection = yield* collectionService.findById(collectionId);
		yield* authorizeEdit(principal.principalId, collectionId);

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const displayName = form.get("displayName")?.toString().trim() || undefined;
		const description = form.get("description")?.toString().trim() || undefined;
		const timezoneTzid =
			form.get("timezoneTzid")?.toString().trim() || undefined;
		const clientProperties = mergedClientProperties(
			collection.clientProperties as IrDeadProperties | null,
			form,
		);

		yield* collectionService.updateProperties(collectionId, {
			clientProperties,
			displayName: displayName ?? null,
			description: description ?? null,
			timezoneTzid: timezoneTzid ?? null,
		});

		// The calendar sidebar's Edit popover passes returnTo=/ui/calendar so it
		// lands back on the calendar view instead of the full edit page.
		const redirectTo = sanitizeReturnTo(
			form.get("returnTo")?.toString() ?? null,
			`/ui/collections/${collectionId}`,
		);
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirectTo },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: redirectTo },
		});
	});
