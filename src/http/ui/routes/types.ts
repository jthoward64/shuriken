import type { AppConfigService } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import type { ClientJsService } from "#src/http/ui/client/index.ts";
import type { CssService } from "#src/http/ui/css/index.ts";
import type { PageCacheService } from "#src/http/ui/page-cache/index.ts";
import type { FileService } from "#src/platform/file.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AppPasswordService } from "#src/services/app-password/service.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import type { BulkJobRepository } from "#src/services/bulk-job/index.ts";
import type { CalEditService } from "#src/services/cal-edit/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/repository.ts";
import type { CardEditService } from "#src/services/card-edit/service.ts";
import type { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";
import type { ContactMergeService } from "#src/services/contact-merge/service.ts";
import type { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import type { EmailCredentialService } from "#src/services/email-credential/service.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import type { GroupService } from "#src/services/group/index.ts";
import type { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { OidcService } from "#src/services/oidc/service.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";
import type { ProvisioningService } from "#src/services/provisioning/service.ts";
import type { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import type { SessionService } from "#src/services/session/service.ts";
import type { ShareLinkService } from "#src/services/share-link/service.ts";
import type { TaskEditService } from "#src/services/task-edit/service.ts";
import type { IanaTimezoneService } from "#src/services/timezone/iana.ts";
import type { TrashService } from "#src/services/trash/index.ts";
import type { UserService } from "#src/services/user/index.ts";
import type { UserRepository } from "#src/services/user/repository.ts";

// ---------------------------------------------------------------------------
// Shared types for the UI router and its route groups
// ---------------------------------------------------------------------------

// UI service union — all services the UI router and its handlers can use

export type UiServices =
	| AppConfigService
	| CssService
	| ClientJsService
	| AclRepository
	| AclService
	| AppPasswordService
	| BirthdayService
	| BulkJobRepository
	| OidcService
	| OidcLoginRepository
	| SessionService
	| UserRepository
	| FileService
	| CalEditService
	| CalIndexRepository
	| CardEditService
	| DatabaseClient
	| EmailCredentialService
	| EntityRepository
	| ImipDispatchService
	| PageCacheService
	| UserEmailCredentialRepository
	| CardIndexRepository
	| CollectionRepository
	| CollectionService
	| ComponentRepository
	| ContactCleanupService
	| ContactMergeService
	| ExternalCalendarRepository
	| GroupService
	| InstanceRepository
	| InstanceService
	| SubscriptionService
	| PrincipalRepository
	| PrincipalService
	| ProvisioningService
	| ShareLinkService
	| TaskEditService
	| TrashService
	| IanaTimezoneService
	| UserService;

// The failures a UI handler is allowed to surface to the router
export type UiError = DavError | DatabaseError | InternalError | ConflictError;

// A parsed UI request: the path segments below /ui plus what they came from
export interface UiRoute {
	readonly req: Request;
	readonly ctx: HttpRequestContext;
	readonly method: string;
	readonly segments: ReadonlyArray<string>;
}
