import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import { CollectionId, type PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { CollectionService } from "#src/services/collection/service.ts";
import { virtualGrants } from "#src/services/role/policy.ts";
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
		const db = yield* DatabaseClient;

		return ProvisioningService.of({
			provisionUser: Effect.fn("ProvisioningService.provisionUser")(function* (
				input: ProvisionUserInput,
			) {
				yield* Effect.annotateCurrentSpan({
					"user.slug": input.slug,
					"user.email": input.email,
				});
				yield* Effect.logInfo("provisioning user", { email: input.email });

				const result = yield* withTransaction(
					Effect.gen(function* () {
						const user = yield* users.create({
							slug: input.slug,
							email: input.email,
							displayName: input.name,
							credentials: input.credentials,
							role: input.role,
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
						// Point the inbox's schedule-default-calendar (RFC 6638 §9.2) at the
						// primary calendar so incoming iTIP REQUESTs are auto-placed there
						// (§3.4.2). Without this the inbox has no default calendar and
						// auto-scheduling silently no-ops for every user.
						const inbox = yield* collections.create({
							ownerPrincipalId: principalId,
							collectionType: "inbox",
							slug: Slug("inbox"),
							displayName: "Scheduling Inbox",
							scheduleDefaultCalendarId: CollectionId(calendar.id),
						});

						const outbox = yield* collections.create({
							ownerPrincipalId: principalId,
							collectionType: "outbox",
							slug: Slug("outbox"),
							displayName: "Scheduling Outbox",
						});

						// Server-managed Birthdays calendar. Marked auto-managed
						// so DAV mutations are rejected; the BirthdayService
						// scheduler regenerates its contents from BDAY props on
						// the user's vCards.
						yield* collections.create({
							ownerPrincipalId: principalId,
							collectionType: "calendar",
							slug: Slug("birthdays"),
							displayName: "Birthdays",
							supportedComponents: ["VEVENT"],
							autoManagedKind: "birthdays",
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

						// Apply role-driven virtual-resource grants. Same set is
						// re-applied by `ensureAdminAces` if the role is later
						// changed, so we only need it here for the initial create.
						let ordinal = 10;
						for (const grant of virtualGrants(input.role ?? "normal")) {
							yield* acl.grantAce({
								resourceType: grant.resourceType,
								resourceId: grant.resourceId,
								principalType: "principal",
								principalId,
								privilege: grant.privilege,
								grantDeny: "grant",
								protected: true,
								ordinal,
							});
							ordinal += 10;
						}

						return { user, calendar, addressBook, inbox, outbox };
					}),
				).pipe(Effect.provideService(DatabaseClient, db));

				yield* Effect.logInfo("user provisioned", {
					email: input.email,
					userId: result.user.user.id,
				});

				return result;
			}),

			ensureAdminAces: Effect.fn("ProvisioningService.ensureAdminAces")(
				function* (principalId: PrincipalId) {
					yield* Effect.logDebug("ensuring admin virtual resource ACEs", {
						principalId,
					});
					for (const resourceId of [
						USERS_VIRTUAL_RESOURCE_ID,
						GROUPS_VIRTUAL_RESOURCE_ID,
					]) {
						const has = yield* acl.hasPrivilege(
							[principalId],
							resourceId,
							"virtual",
							["DAV:all"],
							true,
						);
						if (!has) {
							yield* acl.grantAce({
								resourceType: "virtual",
								resourceId,
								principalType: "principal",
								principalId,
								privilege: "DAV:all",
								grantDeny: "grant",
								protected: true,
								ordinal: 0,
							});
							yield* Effect.logInfo("granted DAV:all on virtual resource", {
								principalId,
								resourceId,
							});
						}
					}
				},
			),
		});
	}),
);
