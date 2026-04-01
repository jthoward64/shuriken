import { Effect, Layer, Option, Redacted } from "effect";
import {
	conflict,
	noneOrConflict,
	someOrNotFound,
} from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import {
	CryptoService,
	type CryptoServiceShape,
} from "#src/platform/crypto.ts";
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

		return UserService.of({
			create: (input: NewUser) =>
				Effect.gen(function* () {
					const credentials: Array<{
						authSource: string;
						authId: string;
						authCredential: Option.Option<Redacted.Redacted<string>>;
					}> = [];
					for (const cred of input.credentials ?? []) {
						credentials.push(yield* hashCredential(crypto, cred));
					}
					return yield* repo.create({ ...input, credentials });
				}),

			update: (id: UserId, input: UpdateUser) =>
				Effect.gen(function* () {
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

			addCredential: (userId: UserId, credential: NewCredential) =>
				Effect.gen(function* () {
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

			removeCredential: (userId: UserId, authSource: string, authId: string) =>
				Effect.gen(function* () {
					yield* repo
						.findById(userId)
						.pipe(Effect.flatMap(someOrNotFound(`User not found: ${userId}`)));
					yield* repo.deleteCredential(userId, authSource, authId);
				}),
		});
	}),
);
