import { Effect, Layer, Option, Redacted } from "effect";
import {
	conflict,
	noneOrConflict,
	someOrNotFound,
} from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import {
	CryptoService,
	type CryptoServiceShape,
} from "#src/platform/crypto.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { UserRepository } from "./repository.ts";
import {
	type NewCredential,
	type NewUser,
	type UpdateUser,
	UserService,
} from "./service.ts";

// ---------------------------------------------------------------------------
// UserService — live implementation
// ---------------------------------------------------------------------------

const hashCredential = (
	crypto: CryptoServiceShape,
	cred: NewCredential,
): Effect.Effect<
	{
		authSource: string;
		authId: string;
		authCredential: Option.Option<Redacted.Redacted<string>>;
	},
	import("#src/domain/errors.ts").InternalError
> => {
	if (cred.source === "local") {
		return crypto.hashPassword(cred.password).pipe(
			Effect.map((hash) => ({
				authSource: "local",
				authId: cred.authId,
				authCredential: Option.some(hash),
			})),
		);
	}
	return Effect.succeed({
		authSource: "proxy",
		authId: cred.authId,
		authCredential: Option.some(Redacted.make(cred.authId)),
	});
};

export const UserServiceLive = Layer.effect(
	UserService,
	Effect.gen(function* () {
		const repo = yield* UserRepository;
		const crypto = yield* CryptoService;
		const aclRepo = yield* AclRepository;

		return UserService.of({
			list: Effect.fn("UserService.list")(function* () {
				yield* Effect.logTrace("user.list");
				return yield* repo.list();
			}),

			findBySlug: Effect.fn("UserService.findBySlug")(function* (slug: Slug) {
				yield* Effect.logTrace("user.findBySlug", { slug });
				return yield* repo
					.findBySlug(slug)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${slug}`)));
			}),

			findById: Effect.fn("UserService.findById")(function* (id: UserId) {
				yield* Effect.logTrace("user.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${id}`)));
			}),

			create: Effect.fn("UserService.create")(function* (input: NewUser) {
				yield* Effect.logTrace("user.create", { slug: input.slug });
				const credentials: Array<{
					authSource: string;
					authId: string;
					authCredential: Option.Option<Redacted.Redacted<string>>;
				}> = [];
				for (const cred of input.credentials ?? []) {
					credentials.push(yield* hashCredential(crypto, cred));
				}
				const result = yield* repo.create({ ...input, credentials });
				yield* aclRepo.grantAce({
					resourceType: "principal",
					resourceId: result.principal.id,
					principalType: "principal",
					principalId: result.principal.id as PrincipalId,
					privilege: "DAV:all",
					grantDeny: "grant",
					protected: true,
					ordinal: 0,
				});
				return result;
			}),

			update: Effect.fn("UserService.update")(function* (
				id: UserId,
				input: UpdateUser,
			) {
				yield* Effect.logTrace("user.update", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${id}`)));

				if (input.email !== undefined) {
					const existing = yield* repo.findByEmail(input.email);
					if (Option.isSome(existing) && existing.value.user.id !== id) {
						return yield* conflict(
							undefined,
							`Email already in use: ${input.email}`,
						);
					}
				}

				return yield* repo.update(id, input);
			}),

			addCredential: Effect.fn("UserService.addCredential")(function* (
				userId: UserId,
				credential: NewCredential,
			) {
				yield* Effect.logTrace("user.addCredential", {
					userId,
					source: credential.source,
				});
				yield* repo
					.findById(userId)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${userId}`)));

				yield* repo
					.findCredential(credential.source, credential.authId)
					.pipe(
						Effect.flatMap(
							noneOrConflict(
								undefined,
								`Credential already exists: ${credential.source}/${credential.authId}`,
							),
						),
					);

				const hashed = yield* hashCredential(crypto, credential);
				yield* repo.insertCredential({ userId, ...hashed });
			}),

			removeCredential: Effect.fn("UserService.removeCredential")(function* (
				userId: UserId,
				authSource: string,
				authId: string,
			) {
				yield* Effect.logTrace("user.removeCredential", { userId, authSource });
				yield* repo
					.findById(userId)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${userId}`)));
				yield* repo.deleteCredential(userId, authSource, authId);
			}),

			delete: Effect.fn("UserService.delete")(function* (id: UserId) {
				yield* Effect.logTrace("user.delete", { id });
				yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${id}`)));
				yield* repo.softDelete(id);
			}),

			setCredential: Effect.fn("UserService.setCredential")(function* (
				userId: UserId,
				credential: NewCredential,
			) {
				yield* Effect.logTrace("user.setCredential", {
					userId,
					source: credential.source,
				});
				yield* repo
					.findById(userId)
					.pipe(Effect.flatMap(someOrNotFound(`User not found: ${userId}`)));
				// Delete any existing credential for this source+authId, then insert fresh
				yield* repo.deleteCredential(
					userId,
					credential.source,
					credential.authId,
				);
				const hashed = yield* hashCredential(crypto, credential);
				yield* repo.insertCredential({ userId, ...hashed });
			}),
		});
	}),
);
