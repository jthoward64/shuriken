import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option, Redacted } from "effect";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import type { PrincipalId, RequestId, UserId } from "#src/domain/ids.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { TemplateService } from "#src/http/ui/template/index.ts";
import { FileService } from "#src/platform/file.ts";
import { AclService } from "#src/services/acl/index.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";
import { CalEditService } from "#src/services/cal-edit/service.ts";
import { CalIndexRepository } from "#src/services/cal-index/repository.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { CollectionRepository as CollectionRepoTag } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import { GroupService } from "#src/services/group/index.ts";
import { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { InstanceRepository as InstanceRepoTag } from "#src/services/instance/repository.ts";
import { OidcService } from "#src/services/oidc/service.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";
import { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import { SessionService } from "#src/services/session/service.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";
import { UserService } from "#src/services/user/index.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { uiRouter } from "./router.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const die = () => Effect.die("stub");

const authenticated = new Authenticated({
	principal: {
		principalId: "00000000-0000-4000-8000-000000000001" as PrincipalId,
		userId: "00000000-0000-4000-8000-000000000002" as UserId,
		displayName: Option.some("Test User"),
	},
});

const makeCtx = (path: string, method = "GET"): HttpRequestContext => ({
	requestId: "00000000-0000-4000-8000-000000000000" as RequestId,
	method,
	url: new URL(`http://localhost${path}`),
	headers: new Headers(),
	auth: authenticated,
	clientIp: Option.none(),
	caldavTimezones: null,
});

const stubLayers = Layer.mergeAll(
	Layer.succeed(AppConfigService, {
		server: { port: 3000, host: "::" },
		metrics: { enabled: false, port: 9464 },
		database: { url: Redacted.make("postgres://localhost/test") },
		auth: {
			mode: "single-user" as const,
			trustedProxies: "*",
			adminEmail: Option.none(),
			adminPassword: Option.none(),
			adminSlug: Option.none(),
		},
		log: { level: undefined },
		nodeEnv: "test",
	} as unknown as AppConfigType),
	Layer.succeed(FileService, {
		readText: die,
		readBytes: die,
		exists: () => Effect.succeed(false),
		mimeType: () => undefined,
		glob: () => Effect.succeed([]),
	}),
	Layer.succeed(TemplateService, {
		render: (_name: string, _ctx: Record<string, unknown>, _isHtmx: boolean) =>
			Effect.succeed("<!DOCTYPE html><body>test</body>"),
		renderFragment: (_name: string, _ctx: Record<string, unknown>) =>
			Effect.succeed("<div>test</div>"),
	}),
	Layer.succeed(AclService, {
		check: die,
		currentUserPrivileges: () => Effect.succeed([]),
		batchCurrentUserPrivileges: () => Effect.succeed(new Map()),
		batchMemberPrivileges: () => Effect.succeed(new Map()),
		batchCheckMembers: () => Effect.succeed(new Set()),
		getAces: die,
		setAces: die,
	}),
	Layer.succeed(CollectionService, {
		findById: die,
		findBySlug: die,
		listByOwner: die,
		create: die,
		delete: die,
		updateProperties: die,
	}),
	Layer.succeed(PrincipalService, {
		findById: die,
		findBySlug: die,
		findPrincipalById: die,
		findPrincipalByIds: die,
		findByEmail: die,
		updateProperties: die,
	}),
	Layer.succeed(UserService, {
		create: die,
		list: die,
		findById: die,
		findBySlug: die,
		update: die,
		delete: die,
		addCredential: die,
		removeCredential: die,
		setCredential: die,
	}),
	Layer.succeed(GroupService, {
		create: die,
		findById: die,
		findBySlug: die,
		findByPrincipalId: die,
		list: die,
		listMembers: die,
		listByMember: die,
		update: die,
		delete: die,
		setMembers: die,
		addMember: die,
		removeMember: die,
	}),
	Layer.succeed(PrincipalRepository, {
		findById: die,
		findBySlug: die,
		findPrincipalById: die,
		findPrincipalByIds: die,
		findPrincipalBySlug: die,
		findByEmail: die,
		findUserByUserId: die,
		updateProperties: die,
		listAll: die,
		searchByDisplayName: die,
	}),
	Layer.succeed(ProvisioningService, {
		provisionUser: die,
		ensureAdminAces: die,
	}),
	Layer.succeed(ExternalCalendarRepository, {
		findById: die,
		findByUrl: die,
		upsertByUrl: die,
		softDelete: die,
		recordSyncResult: die,
		recomputeSyncInterval: die,
		findDue: die,
		findClaimById: die,
		findClaimByCollection: die,
		listClaimsForExternal: die,
		listClaimsWithExternalForPrincipal: () => Effect.succeed([]),
		countClaimsForExternal: die,
		insertClaim: die,
		clearHttpCache: die,
		updateClaim: die,
		deleteClaim: die,
	}),
	Layer.succeed(SubscriptionService, {
		subscribe: die,
		unsubscribe: die,
	}),
	Layer.succeed(AclRepository, {
		getAces: die,
		setAces: die,
		grantAce: die,
		hasPrivilege: die,
		getGrantedPrivileges: die,
		getGroupPrincipalIds: () => Effect.succeed([]),
		batchGetGrantedPrivileges: die,
		getResourceParent: die,
		getRoleForPrincipal: () => Effect.succeed("normal"),
	}),
	Layer.succeed(CollectionRepoTag, {
		findById: die,
		findByIds: die,
		findBySlug: die,
		listByOwner: die,
		listByAutoManagedKind: die,
		listSharedWithPrincipals: () => Effect.succeed([]),
		insert: die,
		softDelete: die,
		relocate: die,
		updateProperties: die,
	}),
	Layer.succeed(InstanceRepoTag, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		listSharedWithPrincipals: () => Effect.succeed([]),
		findChangedSince: die,
		findByIds: die,
		insert: die,
		updateEtag: die,
		softDelete: die,
		relocate: die,
		updateClientProperties: die,
	}),
	Layer.succeed(InstanceService, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		put: die,
		delete: die,
		updateClientProperties: die,
	}),
	Layer.succeed(CardIndexRepository, {
		findByText: () => Effect.succeed([]),
		listForCollection: () => Effect.succeed([]),
		listWithBday: () => Effect.succeed([]),
	}),
	Layer.succeed(CalIndexRepository, {
		findByTimeRange: () => Effect.succeed([]),
		findByComponentType: () => Effect.succeed([]),
		findOverlappingRange: () => Effect.succeed([]),
		indexRruleOccurrences: () => Effect.void,
	}),
	Layer.succeed(ComponentRepository, {
		insertTree: die,
		loadTree: () => Effect.succeed(Option.none()),
		loadTreesByIds: () => Effect.succeed(new Map()),
		deleteByEntity: die,
	}),
	Layer.succeed(CardEditService, {
		create: die,
		update: die,
		delete: die,
	}),
	Layer.succeed(CalEditService, {
		create: die,
		update: die,
		delete: die,
	}),
	Layer.succeed(EmailCredentialService, {
		resolveForUser: die,
		storeForUser: die,
		clearForUser: die,
	}),
	Layer.succeed(UserEmailCredentialRepository, {
		findByUserId: () => Effect.succeed(Option.none()),
		upsert: die,
		delete: die,
	}),
	Layer.succeed(ImipDispatchService, {
		dispatch: () =>
			Effect.succeed({
				sent: 0,
				skippedLocal: 0,
				skippedDisabled: 0,
				failed: 0,
			}),
	}),
	Layer.succeed(DatabaseClient, {} as unknown as DbClient),
	Layer.succeed(ShareLinkService, {
		listForUser: () => Effect.succeed([]),
		getById: () => Effect.succeed(Option.none()),
		getActiveByToken: () => Effect.succeed(Option.none()),
		create: die,
		update: die,
		regenerateToken: die,
		setVisibility: die,
		addCalendar: die,
		removeCalendar: die,
		delete: die,
	}),
	Layer.succeed(EntityRepository, {
		insert: die,
		findById: () => Effect.succeed(Option.none()),
		updateLogicalUid: () => Effect.void,
		softDelete: () => Effect.void,
		existsByUid: () => Effect.succeed(false),
		existsByUidForPrincipal: () => Effect.succeed(false),
		listActiveInstancesWithUid: () => Effect.succeed([]),
	}),
	Layer.succeed(AppPasswordService, {
		generate: die,
		list: () => Effect.succeed([]),
		revoke: () => Effect.void,
	}),
	Layer.succeed(OidcService, {
		beginLogin: die,
		completeLogin: die,
	}),
	Layer.succeed(OidcLoginRepository, {
		create: () => Effect.void,
		consume: () => Effect.succeed(Option.none()),
		deleteExpired: () => Effect.void,
	}),
	Layer.succeed(SessionService, {
		create: die,
		validate: () => Effect.succeed(Option.none()),
		revoke: () => Effect.void,
	}),
	Layer.succeed(UserRepository, {
		findById: () => Effect.succeed(Option.none()),
		findBySlug: () => Effect.succeed(Option.none()),
		findByEmail: () => Effect.succeed(Option.none()),
		list: () => Effect.succeed([]),
		softDelete: () => Effect.void,
		create: die,
		update: die,
		findCredential: () => Effect.succeed(Option.none()),
		insertCredential: die,
		deleteCredential: () => Effect.void,
	}),
);

const run = (path: string, method = "GET"): Promise<Response> => {
	const req = new Request(`http://localhost${path}`, { method });
	const ctx = makeCtx(path, method);
	return Effect.runPromise(Effect.provide(uiRouter(req, ctx), stubLayers));
};

describe("uiRouter", () => {
	it("routes / to home page (200 with HTML)", async () => {
		const res = await run("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
	});

	it("routes /ui to home page (200 with HTML)", async () => {
		const res = await run("/ui");
		expect(res.status).toBe(200);
	});

	it("routes /static/* to staticHandler (404 — no assets in test)", async () => {
		const res = await run("/static/app.js");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});

	it("returns 404 for unknown paths", async () => {
		const res = await run("/ui/unknown/path/that/does/not/exist");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});
