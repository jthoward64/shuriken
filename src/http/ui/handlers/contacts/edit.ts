import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { notFound } from "#src/domain/errors.ts";
import { EntityId, type InstanceId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { parseVcardToForm } from "#src/services/card-edit/parse-vcard.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/contacts/<instanceId>
// ---------------------------------------------------------------------------

export const contactsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	instanceId: InstanceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| ComponentRepository
	| InstanceService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const instance = yield* instanceSvc.findById(instanceId);
		const tree = yield* componentRepo.loadTree(
			EntityId(instance.entityId),
			"vcard",
		);
		if (Option.isNone(tree)) {
			return yield* Effect.fail(notFound("Contact not found"));
		}
		const form = parseVcardToForm(tree.value);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			"pages/contacts/form",
			{
				...nav,
				pageTitle: form.fn || "Contact",
				mode: "edit",
				instanceId,
				addressbookId: instance.collectionId,
				form,
				action: `/ui/api/contacts/${instanceId}/update`,
				deleteAction: `/ui/api/contacts/${instanceId}/delete`,
			},
			ctx.headers,
		);
	});
