import { Effect, Layer } from "effect";
import type { PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { CollectionService } from "#src/services/collection/service.ts";
import { UserService } from "#src/services/user/service.ts";
import { ProvisioningService, type ProvisionUserInput } from "./service.ts";

// ---------------------------------------------------------------------------
// ProvisioningService — live implementation
// ---------------------------------------------------------------------------

export const ProvisioningServiceLive = Layer.effect(
	ProvisioningService,
	Effect.gen(function* () {
		const users = yield* UserService;
		const collections = yield* CollectionService;

		const acl = yield* AclRepository;

		return ProvisioningService.of({
			provisionUser: Effect.fn("ProvisioningService.provisionUser")(function* (
				input: ProvisionUserInput,
			) {
				yield* Effect.logInfo("provisioning user", { email: input.email });

				const user = yield* users.create({
					slug: input.slug,
					email: input.email,
					displayName: input.name,
				});

				// Drizzle infers the uuid column as string; cast to branded type
				const principalId = user.principal.id as PrincipalId;

				const calendar = yield* collections.create({
					ownerPrincipalId: principalId,
					collectionType: "calendar",
					slug: Slug("primary"),
					displayName: "Primary Calendar",
					supportedComponents: ["VEVENT", "VTODO", "VJOURNAL"],
				});

				const addressBook = yield* collections.create({
					ownerPrincipalId: principalId,
					collectionType: "addressbook",
					slug: Slug("primary"),
					displayName: "Primary Address Book",
					supportedComponents: ["VCARD"],
				});

				// RFC 6638 §2.2: each CalDAV principal must have a scheduling inbox and outbox.
				const inbox = yield* collections.create({
					ownerPrincipalId: principalId,
					collectionType: "inbox",
					slug: Slug("inbox"),
					displayName: "Scheduling Inbox",
				});

				const outbox = yield* collections.create({
					ownerPrincipalId: principalId,
					collectionType: "outbox",
					slug: Slug("outbox"),
					displayName: "Scheduling Outbox",
				});

				// Grant the owner full access to their own principal resource.
				// This is the root of the ACL inheritance hierarchy; all collection
				// and instance ACEs inherit from the owner principal's ACL.
				yield* acl.grantAce({
					resourceType: "principal",
					resourceId: principalId,
					principalType: "principal",
					principalId,
					privilege: "DAV:all",
					grantDeny: "grant",
					protected: true,
					ordinal: 0,
				});

				yield* Effect.logInfo("user provisioned", {
					email: input.email,
					userId: user.user.id,
				});

				return { user, calendar, addressBook, inbox, outbox };
			}),
		});
	}),
);
