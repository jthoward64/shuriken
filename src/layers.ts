import { Effect, Layer, Logger } from "effect";
import { DevTools } from "effect/unstable/devtools";
import { CompositeAuthLayer } from "#src/auth/index.ts";
import { AppConfigLive, AppConfigService, LogLevelLive } from "#src/config.ts";
import { type DatabaseClient, DatabaseClientLive } from "#src/db/client.ts";
import { TemplateServiceLive } from "#src/http/ui/template/index.ts";
import { type CryptoService, CryptoServiceLive } from "#src/platform/crypto.ts";
import { FileServiceLive } from "#src/platform/file.ts";
import { AclDomainLayer } from "#src/services/acl/index.ts";
import { AppPasswordRepositoryLive } from "#src/services/app-password/repository.live.ts";
import { AppPasswordServiceLive } from "#src/services/app-password/service.live.ts";
import { BirthdaySchedulerLayer } from "#src/services/birthday/scheduler.live.ts";
import { BirthdayServiceLive } from "#src/services/birthday/service.live.ts";
import { CalEditServiceLive } from "#src/services/cal-edit/service.live.ts";
import { CalIndexRepositoryLive } from "#src/services/cal-index/index.ts";
import { CardEditServiceLive } from "#src/services/card-edit/service.live.ts";
import { CardIndexRepositoryLive } from "#src/services/card-index/index.ts";
import { CollectionDomainLayer } from "#src/services/collection/index.ts";
import { ContactCleanupServiceLive } from "#src/services/contact-cleanup/service.live.ts";
import { ContactMergeServiceLive } from "#src/services/contact-merge/service.live.ts";
import { DomainEntityDomainLayer } from "#src/services/domain-entity/index.ts";
import { UserEmailCredentialRepositoryLive } from "#src/services/email-credential/repository.live.ts";
import { EmailCredentialServiceLive } from "#src/services/email-credential/service.live.ts";
import { ExternalCalendarRepositoryLive } from "#src/services/external-calendar/repository.live.ts";
import { ExternalCalendarSchedulerLayer } from "#src/services/external-calendar/scheduler.live.ts";
import { SubscriptionServiceLive } from "#src/services/external-calendar/subscription.live.ts";
import { ExternalCalendarSyncLayer } from "#src/services/external-calendar/sync.live.ts";
import { GroupDomainLayer } from "#src/services/group/index.ts";
import { ImipDispatchServiceLive } from "#src/services/imip/dispatch.live.ts";
import { ImipInboundServiceLive } from "#src/services/imip/inbound.live.ts";
import { LmtpServerLayer } from "#src/services/imip/lmtp-server.ts";
import { InstanceDomainLayer } from "#src/services/instance/index.ts";
import { MailerServiceLive } from "#src/services/mailer/service.live.ts";
import { OidcServiceLive } from "#src/services/oidc/service.live.ts";
import { PrincipalDomainLayer } from "#src/services/principal/index.ts";
import { ProvisioningDomainLayer } from "#src/services/provisioning/index.ts";
import { SchedulingDomainLayer } from "#src/services/scheduling/index.ts";
import { SessionCleanupLayer } from "#src/services/session/cleanup.live.ts";
import { OidcLoginRepositoryLive } from "#src/services/session/oidc-login-repository.live.ts";
import { SessionRepositoryLive } from "#src/services/session/repository.live.ts";
import { SessionServiceLive } from "#src/services/session/service.live.ts";
import { ShareLinkRepositoryLive } from "#src/services/share-link/repository.live.ts";
import { ShareLinkServiceLive } from "#src/services/share-link/service.live.ts";
import {
	IanaTimezoneServiceLive,
	TimezoneDomainLayer,
} from "#src/services/timezone/index.ts";
import { TombstoneRepositoryLive } from "#src/services/tombstone/index.ts";
import { UserDomainLayer } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// Infrastructure layer — foundational services shared by all domain layers
//
// AppConfigLive reads all env vars once. DatabaseClientLive depends on it for
// DATABASE_URL; we satisfy that dependency here so InfraLayer is self-contained.
// ---------------------------------------------------------------------------

export const InfraLayer = Layer.mergeAll(
	AppConfigLive,
	DatabaseClientLive.pipe(Layer.provide(AppConfigLive)),
	CryptoServiceLive,
);

// ---------------------------------------------------------------------------
// DevTools layer — only active when NODE_ENV=development
// ---------------------------------------------------------------------------

const DevToolsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const { nodeEnv } = yield* AppConfigService;
		return nodeEnv === "development" ? DevTools.layer() : Layer.empty;
	}),
).pipe(Layer.provide(InfraLayer));

// ---------------------------------------------------------------------------
// Session / OIDC / app-password layers — built over InfraLayer.
// ---------------------------------------------------------------------------

const SessionRepositoryFull = SessionRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const OidcLoginRepositoryFull = OidcLoginRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const SessionServiceFull = SessionServiceLive.pipe(
	Layer.provide(Layer.mergeAll(InfraLayer, SessionRepositoryFull)),
);
const AppPasswordRepositoryFull = AppPasswordRepositoryLive.pipe(
	Layer.provide(InfraLayer),
);
const AppPasswordServiceFull = AppPasswordServiceLive.pipe(
	Layer.provide(Layer.mergeAll(InfraLayer, AppPasswordRepositoryFull)),
);
const OidcServiceFull = OidcServiceLive.pipe(Layer.provide(InfraLayer));

// ---------------------------------------------------------------------------
// Auth layer — composite implementation; tries auto-login → session → basic on
// every request and returns the first authenticated result.
// ---------------------------------------------------------------------------

export const AuthLayer = CompositeAuthLayer.pipe(
	Layer.provide(Layer.mergeAll(InfraLayer, SessionServiceFull)),
);

// ---------------------------------------------------------------------------
// Domain layer helper — each domain layer needs DatabaseClient from InfraLayer
// ---------------------------------------------------------------------------

const withInfra = <A, E>(
	layer: Layer.Layer<A, E, DatabaseClient | CryptoService>,
) => layer.pipe(Layer.provide(InfraLayer));

// ---------------------------------------------------------------------------
// AppLayer — full production layer composition
//
// To add a future service (CalendarService, SchedulingService, SyncService):
//   1. Create src/services/<name>/ with the 5-file pattern
//   2. Add `withInfra(<Name>DomainLayer)` here
// ---------------------------------------------------------------------------

// BaseAppLayer — all services except those with cross-domain dependencies.
const BaseAppLayer = Layer.mergeAll(
	Logger.layer([Logger.consolePretty()]),
	LogLevelLive,
	InfraLayer,
	AuthLayer,
	DevToolsLayer,
	withInfra(PrincipalDomainLayer),
	withInfra(CollectionDomainLayer),
	withInfra(InstanceDomainLayer),
	withInfra(AclDomainLayer),
	withInfra(UserDomainLayer),
	withInfra(GroupDomainLayer),
	withInfra(DomainEntityDomainLayer),
	withInfra(TimezoneDomainLayer),
	IanaTimezoneServiceLive,
	ProvisioningDomainLayer.pipe(Layer.provide(InfraLayer)),
	TombstoneRepositoryLive.pipe(Layer.provide(InfraLayer)),
	ExternalCalendarRepositoryLive.pipe(Layer.provide(InfraLayer)),
	CalIndexRepositoryLive.pipe(Layer.provide(InfraLayer)),
	CardIndexRepositoryLive.pipe(Layer.provide(InfraLayer)),
	UserEmailCredentialRepositoryLive.pipe(Layer.provide(InfraLayer)),
	ShareLinkRepositoryLive.pipe(Layer.provide(InfraLayer)),
	SessionRepositoryFull,
	SessionServiceFull,
	OidcLoginRepositoryFull,
	OidcServiceFull,
	AppPasswordRepositoryFull,
	AppPasswordServiceFull,
	FileServiceLive,
	TemplateServiceLive.pipe(Layer.provide(FileServiceLive)),
);

// AppLayer — adds SchedulingDomainLayer, which depends on cross-domain services
// already provided by BaseAppLayer (DatabaseClient, AclService, ComponentRepository,
// EntityRepository, InstanceService, PrincipalRepository, CryptoService).
// Merge both: BaseAppLayer is used to satisfy SchedulingDomainLayer's requirements
// and Effect's Layer sharing ensures services are only initialized once.
// SyncLayer materializes the sync service (with its bundled HttpClient).
// We hold a named reference so the scheduler can consume it AND it gets
// merged into the final AppLayer once.
const ExternalCalendarSyncFull = ExternalCalendarSyncLayer.pipe(
	Layer.provide(BaseAppLayer),
);
const BirthdayServiceFull = BirthdayServiceLive.pipe(
	Layer.provide(BaseAppLayer),
);
const EmailCredentialFull = EmailCredentialServiceLive.pipe(
	Layer.provide(BaseAppLayer),
);
const MailerFull = MailerServiceLive.pipe(
	Layer.provide(Layer.mergeAll(BaseAppLayer, EmailCredentialFull)),
);

export const AppLayer = Layer.mergeAll(
	BaseAppLayer,
	SessionCleanupLayer.pipe(Layer.provide(BaseAppLayer)),
	SchedulingDomainLayer.pipe(Layer.provide(BaseAppLayer)),
	ExternalCalendarSyncFull,
	SubscriptionServiceLive.pipe(Layer.provide(BaseAppLayer)),
	CardEditServiceLive.pipe(Layer.provide(BaseAppLayer)),
	ContactCleanupServiceLive.pipe(Layer.provide(BaseAppLayer)),
	ContactMergeServiceLive.pipe(Layer.provide(BaseAppLayer)),
	CalEditServiceLive.pipe(Layer.provide(BaseAppLayer)),
	ShareLinkServiceLive.pipe(Layer.provide(BaseAppLayer)),
	EmailCredentialFull,
	MailerFull,
	ImipDispatchServiceLive.pipe(
		Layer.provide(Layer.mergeAll(BaseAppLayer, MailerFull)),
	),
	ImipInboundServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				BaseAppLayer,
				CalEditServiceLive.pipe(Layer.provide(BaseAppLayer)),
			),
		),
	),
	LmtpServerLayer.pipe(
		Layer.provide(
			Layer.mergeAll(
				BaseAppLayer,
				ImipInboundServiceLive.pipe(
					Layer.provide(
						Layer.mergeAll(
							BaseAppLayer,
							CalEditServiceLive.pipe(Layer.provide(BaseAppLayer)),
						),
					),
				),
			),
		),
	),
	BirthdayServiceFull,
	ExternalCalendarSchedulerLayer.pipe(
		Layer.provide(Layer.mergeAll(BaseAppLayer, ExternalCalendarSyncFull)),
	),
	// Birthday sweep fiber — periodic full reconcile of every auto-managed
	// "birthdays" collection from the principal's vCards.
	BirthdaySchedulerLayer.pipe(
		Layer.provide(Layer.mergeAll(BaseAppLayer, BirthdayServiceFull)),
	),
);

// ---------------------------------------------------------------------------
// Re-export all service tags for use in handler R-type annotations
// ---------------------------------------------------------------------------

export { AuthService } from "#src/auth/service.ts";
export { DatabaseClient } from "#src/db/client.ts";
export { TemplateService } from "#src/http/ui/template/index.ts";
export { CryptoService } from "#src/platform/crypto.ts";
export { FileService } from "#src/platform/file.ts";
export { AclService } from "#src/services/acl/index.ts";
export { AppPasswordService } from "#src/services/app-password/service.ts";
export { BirthdayService } from "#src/services/birthday/service.ts";
export { CalEditService } from "#src/services/cal-edit/service.ts";
export {
	type CalComponentType,
	CalIndexRepository,
} from "#src/services/cal-index/index.ts";
export { CardEditService } from "#src/services/card-edit/service.ts";
export {
	type CardCollation,
	type CardIndexField,
	CardIndexRepository,
	type CardMatchType,
} from "#src/services/card-index/index.ts";
export {
	CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
export { DomainEntityService } from "#src/services/domain-entity/index.ts";
export { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
export { EmailCredentialService } from "#src/services/email-credential/service.ts";
export {
	type ExternalCalendarClaimRow,
	ExternalCalendarRepository,
	type ExternalCalendarRow,
} from "#src/services/external-calendar/repository.ts";
export { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
export { ExternalCalendarSyncService } from "#src/services/external-calendar/sync.ts";
export {
	GroupRepository,
	GroupService,
} from "#src/services/group/index.ts";
export { ImipDispatchService } from "#src/services/imip/dispatch.ts";
export { ImipInboundService } from "#src/services/imip/inbound.ts";
export {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
export { MailerService } from "#src/services/mailer/service.ts";
export { OidcService } from "#src/services/oidc/service.ts";
export {
	PrincipalRepository,
	PrincipalService,
} from "#src/services/principal/index.ts";
export { SchedulingService } from "#src/services/scheduling/index.ts";
export { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
export { SessionRepository } from "#src/services/session/repository.ts";
export { SessionService } from "#src/services/session/service.ts";
export { ShareLinkRepository } from "#src/services/share-link/repository.ts";
export { ShareLinkService } from "#src/services/share-link/service.ts";
export {
	CalTimezoneRepository,
	IanaTimezoneService,
} from "#src/services/timezone/index.ts";
export {
	TombstoneRepository,
	type TombstoneRow,
} from "#src/services/tombstone/index.ts";
export {
	UserRepository,
	UserService,
} from "#src/services/user/index.ts";
