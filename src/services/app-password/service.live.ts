import { Effect, Layer, Option, Redacted } from "effect";
import { CryptoService } from "#src/platform/crypto.ts";
import { AppPasswordRepository } from "#src/services/app-password/repository.ts";
import {
	AppPasswordService,
	type AppPasswordServiceShape,
	type GeneratedAppPassword,
} from "#src/services/app-password/service.ts";

// ---------------------------------------------------------------------------
// Live AppPasswordService.
// ---------------------------------------------------------------------------

const USERNAME_BYTES = 9; // 12 base64url chars
const SECRET_BYTES = 24; // 32 base64url chars

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
};

const randomBase64Url = (byteLength: number): string => {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
};

export const AppPasswordServiceLive = Layer.effect(
	AppPasswordService,
	Effect.gen(function* () {
		const repo = yield* AppPasswordRepository;
		const crypto = yield* CryptoService;

		const generate: AppPasswordServiceShape["generate"] = (input) =>
			Effect.gen(function* () {
				const username = `ap-${randomBase64Url(USERNAME_BYTES)}`;
				const secret = randomBase64Url(SECRET_BYTES);
				const hash = yield* crypto.hashPassword(Redacted.make(secret));
				yield* repo.create({
					userId: input.userId,
					username,
					label: Option.getOrNull(input.label),
					authCredential: hash,
				});
				return {
					username,
					password: Redacted.make(secret),
					label: input.label,
				} satisfies GeneratedAppPassword;
			});

		return {
			generate,
			list: (userId) => repo.listByUser(userId),
			revoke: (userId, id) => repo.deleteForUser(userId, id),
		};
	}),
);
