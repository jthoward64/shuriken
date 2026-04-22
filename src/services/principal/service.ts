import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import type {
	PrincipalPropertyChanges,
	PrincipalRow,
	PrincipalWithUser,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// PrincipalService — business logic for principal management
// ---------------------------------------------------------------------------

export interface PrincipalServiceShape {
	/** Find any principal (user OR group) by ID — no user join. */
	readonly findPrincipalById: (
		id: PrincipalId,
	) => Effect.Effect<PrincipalRow, DavError | DatabaseError>;
	readonly findById: (
		id: PrincipalId,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
	readonly findByEmail: (
		email: Email,
	) => Effect.Effect<PrincipalWithUser, DavError | DatabaseError>;
	readonly updateProperties: (
		id: PrincipalId,
		changes: PrincipalPropertyChanges,
	) => Effect.Effect<PrincipalRow, DatabaseError>;
}

export class PrincipalService extends Context.Tag("PrincipalService")<
	PrincipalService,
	PrincipalServiceShape
>() {}
