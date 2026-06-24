import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Layer, Option, Redacted } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService, type AppConfigType } from "#src/config.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { AuthError, DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import { Authenticated, type Unauthenticated } from "#src/domain/types/dav.ts";
import { TemplateService } from "#src/http/ui/template/index.ts";
import {
	CollectionRepository as CollectionRepoTag,
	InstanceRepository,
	PrincipalRepository,
} from "#src/layers.ts";
import { FileService } from "#src/platform/file.ts";
import { AclService } from "#src/services/acl/index.ts";
import { AclRepository as AclRepoTag } from "#src/services/acl/repository.ts";
import { CalEditService } from "#src/services/cal-edit/service.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { CardIndexRepository } from "#src/services/card-index/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import { GroupRepository, GroupService } from "#src/services/group/index.ts";
import { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";
import { SchedulingService } from "#src/services/scheduling/service.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";
import { IanaTimezoneServiceLive } from "#src/services/timezone/iana.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { TombstoneRepository } from "#src/services/tombstone/index.ts";
import { UserRepository, UserService } from "#src/services/user/index.ts";
import { handleRequest } from "./router.ts";

// ---------------------------------------------------------------------------
// Mock client address
// ---------------------------------------------------------------------------

const mockClientAddress: string | undefined = "127.0.0.1";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

const die = () => Effect.die("stub");

const authLayer = (
	result: Effect.Effect<
		Authenticated | Unauthenticated,
		AuthError | DatabaseError
	>,
) =>
	Layer.succeed(AuthService, {
		authenticate: (_headers, _ip) => result,
	});

const authenticated = new Authenticated({
	principal: {
		principalId: "00000000-0000-4000-8000-000000000001" as PrincipalId,
		userId: "00000000-0000-4000-8000-000000000002" as UserId,
		displayName: Option.some("Test User"),
	},
});

const noOpRouterDb = {
	transaction: async <T>(fn: (tx: DbClient) => Promise<T>): Promise<T> =>
		fn(noOpRouterDb as unknown as DbClient),
} as unknown as DbClient;

// All-die stub layers for services that must be provided but won't be called.
// These stubs satisfy the type system; any actual call would crash the test fast.
const stubLayers = Layer.mergeAll(
	Layer.succeed(PrincipalRepository, {
		findById: die,
		findBySlug: die,
		findPrincipalById: die,
		findPrincipalBySlug: die,
		findByEmail: die,
		findUserByUserId: die,
		updateProperties: die,
		listAll: die,
		searchByDisplayName: die,
	}),
	Layer.succeed(CollectionRepoTag, {
		findById: die,
		findBySlug: die,
		listByOwner: die,
		listByAutoManagedKind: die,
		listSharedWithPrincipals: die,
		insert: die,
		softDelete: die,
		relocate: die,
		updateProperties: die,
	}),
	Layer.succeed(InstanceRepository, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		listSharedWithPrincipals: die,
		findChangedSince: die,
		findByIds: die,
		insert: die,
		updateEtag: die,
		softDelete: die,
		relocate: die,
		updateClientProperties: die,
	}),
	Layer.succeed(CollectionService, {
		findById: die,
		findBySlug: die,
		listByOwner: die,
		create: die,
		delete: die,
		updateProperties: die,
	}),
	Layer.succeed(InstanceService, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		put: die,
		delete: die,
		updateClientProperties: die,
	}),
	Layer.succeed(AclService, {
		check: die,
		currentUserPrivileges: die,
		batchCurrentUserPrivileges: die,
		getAces: die,
		setAces: die,
	}),
	Layer.succeed(PrincipalService, {
		findById: die,
		findBySlug: die,
		findPrincipalById: die,
		findByEmail: die,
		updateProperties: die,
	}),
	Layer.succeed(EntityRepository, {
		insert: die,
		findById: die,
		updateLogicalUid: die,
		softDelete: die,
		existsByUid: die,
		existsByUidForPrincipal: die,
		listActiveInstancesWithUid: die,
	}),
	Layer.succeed(ComponentRepository, {
		insertTree: die,
		loadTree: die,
		deleteByEntity: die,
	}),
	Layer.succeed(CalTimezoneRepository, {
		findByTzid: die,
		upsert: die,
	}),
	Layer.succeed(TombstoneRepository, {
		findSinceRevision: die,
	}),
	Layer.succeed(CalIndexRepository, {
		findByTimeRange: die,
		findByComponentType: die,
		indexRruleOccurrences: die,
	}),
	Layer.succeed(CardIndexRepository, {
		findByText: die,
		listWithBday: die,
	}),
	Layer.succeed(UserRepository, {
		findById: die,
		findBySlug: die,
		findByEmail: die,
		list: die,
		softDelete: die,
		create: die,
		update: die,
		findCredential: die,
		insertCredential: die,
		deleteCredential: die,
	}),
	Layer.succeed(GroupRepository, {
		findById: die,
		findBySlug: die,
		findByPrincipalId: die,
		list: die,
		listMembers: die,
		listByMember: die,
		softDelete: die,
		setMembers: die,
		create: die,
		update: die,
		addMember: die,
		removeMember: die,
		hasMember: die,
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
	Layer.succeed(SchedulingService, {
		processAfterPut: die,
		validateSchedulingChange: die,
		processAfterDelete: die,
		processOutboxPost: die,
	}),
	IanaTimezoneServiceLive,
	Layer.succeed(DatabaseClient, noOpRouterDb),
	Layer.succeed(AppConfigService, {
		server: { port: 3000, host: "::" },
		database: { url: Redacted.make("postgres://localhost/test") },
		auth: {
			autoLogin: Option.none(),
			proxyHeader: Option.none(),
			proxyRoleHeader: Option.none(),
			trustedProxies: "*",
			basicAuthEnabled: true,
			adminEmail: Option.none(),
			adminPassword: Option.none(),
			adminSlug: Option.none(),
			authSettingsUrl: Option.none(),
			authSettingsLabel: Option.none(),
			proxyAutoProvision: false,
		},
		log: { level: undefined },
		externalCalendar: {
			schedulerTickS: 60,
			fetchConcurrency: 4,
			claimCap: 100,
		},
		birthday: { schedulerTickS: 600, concurrency: 4 },
		mail: {
			enabled: false,
			defaultFromAddress: "",
			defaultFromName: "",
			defaultHost: "",
			defaultPort: 587,
			defaultUsername: "",
			defaultPassword: "",
			defaultSecurity: "starttls",
			credsKey: "",
			lmtpEnabled: false,
			lmtpPort: 2400,
			lmtpHost: "127.0.0.1",
			profiles: [],
			proxyUsernameHeader: Option.none(),
			proxyPasswordHeader: Option.none(),
			proxyHostHeader: Option.none(),
			proxyPortHeader: Option.none(),
			proxySecurityHeader: Option.none(),
		},
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
		findClaimByCollection: () => Effect.succeed(Option.none()),
		listClaimsForExternal: die,
		listClaimsWithExternalForPrincipal: die,
		countClaimsForExternal: die,
		insertClaim: die,
		updateClaim: die,
		deleteClaim: die,
		clearHttpCache: die,
	}),
	Layer.succeed(SubscriptionService, {
		subscribe: die,
		unsubscribe: die,
	}),
	Layer.succeed(AclRepoTag, {
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
);

const runWith = (
	req: Request,
	auth: Effect.Effect<
		Authenticated | Unauthenticated,
		AuthError | DatabaseError
	>,
): Promise<Response> => {
	const layer = Layer.merge(authLayer(auth), stubLayers);
	return Effect.runPromise(
		Effect.provide(handleRequest(req, mockClientAddress), layer),
	);
};

const okAuth = Effect.succeed(authenticated);
const req = (method: string, path: string) =>
	new Request(`http://localhost${path}`, { method });

// ---------------------------------------------------------------------------
// Routing — non-DAV, non-UI paths
// ---------------------------------------------------------------------------

describe("handleRequest — routing", () => {
	it("returns 404 for unknown paths (not DAV, not UI)", async () => {
		const res = await runWith(req("GET", "/other"), okAuth);
		expect(res.status).toBe(404);
	});

	it("returns 404 for /api (not DAV, not UI)", async () => {
		const res = await runWith(req("GET", "/api/something"), okAuth);
		expect(res.status).toBe(404);
	});

	it("routes / to UI (200 HTML)", async () => {
		const res = await runWith(req("GET", "/"), okAuth);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("<!DOCTYPE html>");
	});

	it("routes /ui to UI (200 HTML)", async () => {
		const res = await runWith(req("GET", "/ui"), okAuth);
		expect(res.status).toBe(200);
	});

	it("routes /static/ prefix to UI (staticHandler placeholder → 404)", async () => {
		const res = await runWith(req("GET", "/static/app.js"), okAuth);
		expect(res.status).toBe(404);
	});

	it("routes /ui/ sub-paths to UI router (→ 404 from uiRouter)", async () => {
		const res = await runWith(req("GET", "/ui/dashboard"), okAuth);
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Error mapping — mapErrorToResponse
// ---------------------------------------------------------------------------

describe("handleRequest — mapErrorToResponse", () => {
	it("AuthError → 401 with WWW-Authenticate header", async () => {
		const res = await runWith(
			req("GET", "/other"),
			Effect.fail(new AuthError({ reason: "bad credentials" })),
		);
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
	});

	it("DatabaseError from auth → 500 Internal Server Error", async () => {
		const res = await runWith(
			req("GET", "/other"),
			Effect.fail(new DatabaseError({ cause: new Error("connection lost") })),
		);
		expect(res.status).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// isDavPath edge cases
// ---------------------------------------------------------------------------

describe("isDavPath coverage", () => {
	it("exactly /dav is a DAV path (tries to route, stubs die → defect → 500)", async () => {
		// /dav with auth success → davRouter is called → needs real DAV services.
		// With stubs that die, this will result in a defect → 500.
		// The test confirms that /dav IS routed into the DAV handler (not 404).
		const res = await runWith(req("OPTIONS", "/dav"), okAuth);
		// davRouter will try to parse the path and use services → stubs die → 500
		// OR davRouter returns a response before needing any service (unlikely)
		// Either way, status should NOT be 404 (which is the fallback for unknown paths)
		expect(res.status).not.toBe(404);
	});

	it("/.well-known/caldav is a DAV path (not a 404)", async () => {
		const res = await runWith(req("GET", "/.well-known/caldav"), okAuth);
		expect(res.status).not.toBe(404);
	});

	it("/.well-known/carddav is a DAV path (not a 404)", async () => {
		const res = await runWith(req("GET", "/.well-known/carddav"), okAuth);
		expect(res.status).not.toBe(404);
	});
});

// ---------------------------------------------------------------------------
// mapErrorToResponse — DavError without precondition
// ---------------------------------------------------------------------------

// We test this by triggering a DavError from a real DAV path handler.
// Since we're in a unit test with stubs, most DAV paths will die on first
// service call. The DavError-without-precondition path is covered separately
// by integration tests where the handler explicitly returns such errors.
//
// ConflictError, XmlParseError, InternalError, ConfigError cannot be easily
// triggered without a full DAV service stack — they are exercised by integration
// tests. These are documented here for tracking coverage intent:
//
//   ConflictError → 409 (duplicate slug/email)
//   XmlParseError → 400 (malformed XML body)
//   InternalError → 500
//   ConfigError   → 500
