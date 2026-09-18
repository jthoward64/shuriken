// ---------------------------------------------------------------------------
// SchedulingService — live implementation (RFC 6638)
//
// Handles implicit scheduling:
//   - SOR detection (ORGANIZER + ATTENDEE present)              itip-extract.ts
//   - iTIP REQUEST/REPLY/CANCEL message construction            itip-build.ts
//   - Inbox delivery and auto-processing of incoming messages   auto-apply.ts
//   - Organizer PUT / attendee RSVP handling                    process-put.ts
//   - Attendee-only change validation                           validate-change.ts
//   - CANCEL / REPLY DECLINED on DELETE                         process-delete.ts
//   - Outbox POST free-busy aggregation (RFC 6638 §5)           outbox-freebusy.ts
// ---------------------------------------------------------------------------

import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { AclService } from "#src/services/acl/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import type { SchedulingDeps } from "./deps.ts";
import { processOutboxPost } from "./outbox-freebusy.ts";
import { processAfterDelete } from "./process-delete.ts";
import { processAfterPut } from "./process-put.ts";
import { SchedulingRepository } from "./repository.ts";
import { SchedulingService } from "./service.ts";
import { validateSchedulingChange } from "./validate-change.ts";

export const SchedulingServiceLive = Layer.effect(
	SchedulingService,
	Effect.gen(function* () {
		const deps: SchedulingDeps = {
			repo: yield* SchedulingRepository,
			principalRepo: yield* PrincipalRepository,
			componentRepo: yield* ComponentRepository,
			entityRepo: yield* EntityRepository,
			instanceSvc: yield* InstanceService,
			aclSvc: yield* AclService,
			db: yield* DatabaseClient,
		};

		return {
			processAfterPut: (opts) => processAfterPut(deps, opts),
			validateSchedulingChange: (opts) => validateSchedulingChange(deps, opts),
			processAfterDelete: (opts) => processAfterDelete(deps, opts),
			processOutboxPost: (opts) => processOutboxPost(deps, opts),
		};
	}),
);
