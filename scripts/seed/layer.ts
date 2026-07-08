// ---------------------------------------------------------------------------
// SeedLayer — a lean layer composition for the seed script.
//
// Deliberately NOT `AppLayer` (src/layers.ts): that layer also starts
// scheduler/sync fibers, an LMTP listener, and a mailer, none of which this
// one-shot script needs or wants running. Instead we compose just the
// domain layers the seed steps actually touch, each provided over the same
// `InfraLayer` (config + DatabaseClient + CryptoService) that `layers.ts`
// uses — mirroring its `withInfra`/`*Full` pattern.
// ---------------------------------------------------------------------------

import { Layer, Logger } from "effect";
import { InfraLayer } from "#src/layers.ts";
import { AclDomainLayer } from "#src/services/acl/index.ts";
import { AppPasswordRepositoryLive } from "#src/services/app-password/repository.live.ts";
import { AppPasswordServiceLive } from "#src/services/app-password/service.live.ts";
import { BirthdayServiceLive } from "#src/services/birthday/service.live.ts";
import { CardIndexRepositoryLive } from "#src/services/card-index/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { ComponentDomainLayer } from "#src/services/component/index.ts";
import { EntityDomainLayer } from "#src/services/entity/index.ts";
import { ExternalCalendarRepositoryLive } from "#src/services/external-calendar/repository.live.ts";
import { GroupDomainLayer } from "#src/services/group/index.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
import { ProvisioningDomainLayer } from "#src/services/provisioning/index.ts";
import { ShareLinkRepositoryLive } from "#src/services/share-link/repository.live.ts";
import { ShareLinkServiceLive } from "#src/services/share-link/service.live.ts";

const AclFull = AclDomainLayer.pipe(Layer.provide(InfraLayer));
const CollectionFull = CollectionDomainLayer.pipe(Layer.provide(InfraLayer));
const GroupFull = GroupDomainLayer.pipe(Layer.provide(InfraLayer));
const InstanceFull = InstanceDomainLayer.pipe(Layer.provide(InfraLayer));
const ComponentFull = ComponentDomainLayer.pipe(Layer.provide(InfraLayer));
const EntityFull = EntityDomainLayer.pipe(Layer.provide(InfraLayer));
const ProvisioningFull = ProvisioningDomainLayer.pipe(
	Layer.provide(InfraLayer),
);
const ExternalCalendarRepositoryFull = ExternalCalendarRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const CardIndexRepositoryFull = CardIndexRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);

const AppPasswordRepositoryFull = AppPasswordRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const AppPasswordServiceFull = AppPasswordServiceLive.pipe(
	Layer.provide(Layer.mergeAll(InfraLayer, AppPasswordRepositoryFull)),
);

const ShareLinkRepositoryFull = ShareLinkRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const ShareLinkServiceFull = ShareLinkServiceLive.pipe(
	Layer.provide(Layer.mergeAll(InfraLayer, ShareLinkRepositoryFull, AclFull)),
);

const BirthdayServiceFull = BirthdayServiceLive.pipe(
	Layer.provide(
		Layer.mergeAll(
			InfraLayer,
			CardIndexRepositoryFull,
			CollectionFull,
			ComponentFull,
			EntityFull,
			InstanceFull,
		),
	),
);

export const SeedLayer = Layer.mergeAll(
	Logger.layer([Logger.consolePretty()]),
	InfraLayer,
	AclFull,
	CollectionFull,
	GroupFull,
	InstanceFull,
	ComponentFull,
	EntityFull,
	ProvisioningFull,
	ExternalCalendarRepositoryFull,
	CardIndexRepositoryFull,
	BirthdayServiceFull,
	AppPasswordRepositoryFull,
	AppPasswordServiceFull,
	ShareLinkRepositoryFull,
	ShareLinkServiceFull,
);
