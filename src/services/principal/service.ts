import type { Effect, Option } from "effect";
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
	/**
	 * Batch variant of findPrincipalById: resolve many principals in one query.
	 * Returns a map keyed by id; unresolved ids are absent (no failure), so
	 * callers enriching a list can fall back per missing entry.
	 */
	readonly findPrincipalByIds: (
		ids: ReadonlyArray<PrincipalId>,
	) => Effect.Effect<ReadonlyMap<PrincipalId, PrincipalRow>, DatabaseError>;
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
	/**
	 * Search user principals whose display name or email contains `query`
	 * (case-insensitive substring), for the Share UI's "pick a user" picker.
	 * Results are capped at `limit`. Never fails on no-match — returns [].
	 */
	readonly searchByDisplayName: (
		query: string,
		limit: number,
	) => Effect.Effect<ReadonlyArray<PrincipalWithUser>, DatabaseError>;
	/**
	 * Look up a user principal by exact email match, for the Share UI's
	 * "exact_email" search mode. Unlike `findByEmail`, this never fails on
	 * no-match — it returns `Option.none()`, since "no such user" is an
	 * expected outcome of a search, not an error.
	 */
	readonly findByEmailExact: (
		email: Email,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
}

export class PrincipalService extends Context.Service<
	PrincipalService,
	PrincipalServiceShape
>()("PrincipalService") {}
