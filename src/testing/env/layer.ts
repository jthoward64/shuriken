import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { AclServiceLive } from "#src/services/acl/service.live.ts";
import { BirthdayService } from "#src/services/birthday/service.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { CollectionServiceLive } from "#src/services/collection/service.live.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { GroupRepository } from "#src/services/group/repository.ts";
import { GroupServiceLive } from "#src/services/group/service.live.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { InstanceServiceLive } from "#src/services/instance/service.live.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";
import { PrincipalServiceLive } from "#src/services/principal/service.live.ts";
import { SchedulingService } from "#src/services/scheduling/service.ts";
import { IanaTimezoneServiceLive } from "#src/services/timezone/iana.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { UserServiceLive } from "#src/services/user/service.live.ts";
import { asDouble } from "#src/testing/doubles.ts";
import { makeAclRepo } from "./acl-repo.ts";
import { makeCalIndexRepo, makeCalTimezoneRepo } from "./calendar-repos.ts";
import { makeCollectionRepo } from "./collection-repo.ts";
import { TestCryptoLayer } from "./crypto.ts";
import { makeComponentRepo, makeEntityRepo } from "./entity-repo.ts";
import { makeGroupRepo } from "./group-repo.ts";
import { makeInstanceRepo } from "./instance-repo.ts";
import { makePrincipalRepo } from "./principal-repo.ts";
import type { TestStores } from "./stores.ts";
import { makeUserRepo } from "./user-repo.ts";

// ---------------------------------------------------------------------------
// Layer wiring — every in-memory repository plus the real services built on
// top of them, assembled from one set of stores.
// ---------------------------------------------------------------------------

/** Build the fully-wired test Layer over these stores */
export function makeTestLayer(stores: TestStores) {
	const userRepoLayer = Layer.succeed(UserRepository, makeUserRepo(stores));
	const principalRepoLayer = Layer.succeed(
		PrincipalRepository,
		makePrincipalRepo(stores),
	);
	const collectionRepoLayer = Layer.succeed(
		CollectionRepository,
		makeCollectionRepo(stores),
	);
	const instanceRepoLayer = Layer.succeed(
		InstanceRepository,
		makeInstanceRepo(stores),
	);
	const groupRepoLayer = Layer.succeed(GroupRepository, makeGroupRepo(stores));
	const aclRepoLayer = Layer.succeed(AclRepository, makeAclRepo(stores));
	const entityRepoLayer = Layer.succeed(
		EntityRepository,
		makeEntityRepo(stores),
	);
	// The test environment doesn't model external subscriptions; all
	// queries return "not a subscription" so the read-only guard never
	// false-positives. Tests that exercise the subscription code path
	// should compose a more specific layer on top.
	const externalCalendarRepoLayer = Layer.succeed(ExternalCalendarRepository, {
		findById: () => Effect.succeed(Option.none()),
		findByUrl: () => Effect.succeed(Option.none()),
		upsertByUrl: () => Effect.die("no external_calendar in test env"),
		softDelete: () => Effect.void,
		recordSyncResult: () => Effect.void,
		recomputeSyncInterval: () => Effect.void,
		findDue: () => Effect.succeed([]),
		findClaimById: () => Effect.succeed(Option.none()),
		findClaimByCollection: () => Effect.succeed(Option.none()),
		listClaimsForExternal: () => Effect.succeed([]),
		listClaimsWithExternalForPrincipal: () => Effect.succeed([]),
		countClaimsForExternal: () => Effect.succeed(0),
		insertClaim: () => Effect.die("no external_calendar_claim in test env"),
		updateClaim: () => Effect.die("no external_calendar_claim in test env"),
		deleteClaim: () => Effect.void,
		clearHttpCache: () => Effect.void,
	});
	const componentRepoLayer = Layer.succeed(
		ComponentRepository,
		makeComponentRepo(stores),
	);
	const calTimezoneRepoLayer = Layer.succeed(
		CalTimezoneRepository,
		makeCalTimezoneRepo(stores),
	);
	const calIndexRepoLayer = Layer.succeed(
		CalIndexRepository,
		makeCalIndexRepo(),
	);
	const schedulingServiceLayer = Layer.succeed(SchedulingService, {
		processAfterPut: (_opts) => Effect.succeed(Option.none()),
		validateSchedulingChange: (_opts) => Effect.void,
		processAfterDelete: (_opts) => Effect.void,
		processOutboxPost: (_opts) => Effect.succeed([]),
	});
	// The test environment doesn't model birthday generation; vCard write
	// paths fire-and-forget a regenerate that's a no-op here. Tests that
	// exercise the birthday reconciler itself compose BirthdayServiceLive
	// directly instead of this stub.
	const birthdayServiceLayer = Layer.succeed(BirthdayService, {
		regenerate: () => Effect.succeed({ inserted: 0, updated: 0, deleted: 0 }),
	});

	// The in-memory repositories ignore the transaction boundary, so the stub
	// simply runs the callback against itself
	const noOpDb: DbClient = asDouble({
		transaction: <A, E, R>(
			fn: (tx: DbClient) => Effect.Effect<A, E, R>,
		): Effect.Effect<A, E, R> => fn(noOpDb),
	});
	const testDbClientLayer = Layer.succeed(DatabaseClient, noOpDb);

	const userServiceLayer = UserServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				userRepoLayer,
				TestCryptoLayer,
				aclRepoLayer,
				testDbClientLayer,
			),
		),
	);
	const principalServiceLayer = PrincipalServiceLive.pipe(
		Layer.provide(principalRepoLayer),
	);
	const collectionServiceLayer = CollectionServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(collectionRepoLayer, aclRepoLayer, testDbClientLayer),
		),
	);
	const instanceServiceLayer = InstanceServiceLive.pipe(
		Layer.provide(instanceRepoLayer),
	);
	const groupServiceLayer = GroupServiceLive.pipe(
		Layer.provide(groupRepoLayer),
	);
	const aclServiceLayer = AclServiceLive.pipe(Layer.provide(aclRepoLayer));

	return Layer.mergeAll(
		TestCryptoLayer,
		userServiceLayer,
		principalServiceLayer,
		collectionServiceLayer,
		instanceServiceLayer,
		groupServiceLayer,
		aclServiceLayer,
		aclRepoLayer,
		birthdayServiceLayer,
		collectionRepoLayer,
		instanceRepoLayer,
		principalRepoLayer,
		entityRepoLayer,
		externalCalendarRepoLayer,
		componentRepoLayer,
		calTimezoneRepoLayer,
		calIndexRepoLayer,
		IanaTimezoneServiceLive,
		schedulingServiceLayer,
		testDbClientLayer,
	);
}
