import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#/domain/errors.ts";
import type { PrincipalId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
import type { PrincipalWithUser } from "./repository.ts";

// ---------------------------------------------------------------------------
// PrincipalService — business logic for principal management
// ---------------------------------------------------------------------------

export interface PrincipalServiceShape {
	readonly findById: (
		id: PrincipalId,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
	readonly findByEmail: (
		email: string,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
}

export class PrincipalService extends Context.Tag("PrincipalService")<
	PrincipalService,
	PrincipalServiceShape
>() {}
