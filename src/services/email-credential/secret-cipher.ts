import { Effect, Redacted } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// AES-GCM cipher for short secrets (SMTP passwords).
//
// Key derivation: SHA-256(EMAIL_CREDS_KEY) → 256-bit AES key. Lets the admin
// supply any-length passphrase via env without worrying about exact key
// length, while still using a strong KDF target. For a personal-server
// project this is acceptable; multi-tenant deployments should switch to a
// proper KMS.
//
// Format on disk:
//   iv:  base64( random 12 bytes )
//   ct:  base64( aes-gcm ciphertext + 16-byte tag concatenated by Web Crypto )
//
// Both are stored in dav schema columns (password_iv, password_encrypted).
// ---------------------------------------------------------------------------

const IV_BYTES = 12;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

const toBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary);
};

const fromBase64 = (b64: string): Uint8Array<ArrayBuffer> => {
	const binary = atob(b64);
	const buffer = new ArrayBuffer(binary.length);
	const out = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
};

const deriveKey = (passphrase: string): Effect.Effect<CryptoKey, InternalError> =>
	Effect.tryPromise({
		try: async () => {
			const digest = await crypto.subtle.digest(
				"SHA-256",
				ENCODER.encode(passphrase),
			);
			return crypto.subtle.importKey(
				"raw",
				digest,
				{ name: "AES-GCM" },
				false,
				["encrypt", "decrypt"],
			);
		},
		catch: (e) => new InternalError({ cause: e }),
	});

export interface EncryptedSecret {
	readonly ciphertext: string;
	readonly iv: string;
}

export const encryptSecret = (
	keyMaterial: Redacted.Redacted<string>,
	plaintext: Redacted.Redacted<string>,
): Effect.Effect<EncryptedSecret, InternalError> =>
	Effect.gen(function* () {
		const passphrase = Redacted.value(keyMaterial);
		if (passphrase === "") {
			return yield* Effect.fail(
				new InternalError({
					cause: new Error("EMAIL_CREDS_KEY is unset; cannot encrypt secret"),
				}),
			);
		}
		const key = yield* deriveKey(passphrase);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ct = yield* Effect.tryPromise({
			try: () =>
				crypto.subtle.encrypt(
					{ name: "AES-GCM", iv },
					key,
					ENCODER.encode(Redacted.value(plaintext)),
				),
			catch: (e) => new InternalError({ cause: e }),
		});
		return {
			ciphertext: toBase64(new Uint8Array(ct)),
			iv: toBase64(iv),
		};
	});

export const decryptSecret = (
	keyMaterial: Redacted.Redacted<string>,
	encrypted: EncryptedSecret,
): Effect.Effect<Redacted.Redacted<string>, InternalError> =>
	Effect.gen(function* () {
		const passphrase = Redacted.value(keyMaterial);
		if (passphrase === "") {
			return yield* Effect.fail(
				new InternalError({
					cause: new Error("EMAIL_CREDS_KEY is unset; cannot decrypt secret"),
				}),
			);
		}
		const key = yield* deriveKey(passphrase);
		const iv = fromBase64(encrypted.iv);
		const ct = fromBase64(encrypted.ciphertext);
		const plain = yield* Effect.tryPromise({
			try: () => crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct),
			catch: (e) => new InternalError({ cause: e }),
		});
		return Redacted.make(DECODER.decode(plain));
	});
