import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, Redacted } from "effect";
import { decryptSecret, encryptSecret } from "./secret-cipher.ts";

describe("secret-cipher", () => {
	it("round-trips a secret", async () => {
		const key = Redacted.make("test-passphrase-123");
		const plain = Redacted.make("hunter2");
		const encrypted = await Effect.runPromise(encryptSecret(key, plain));
		const decrypted = await Effect.runPromise(decryptSecret(key, encrypted));
		expect(Redacted.value(decrypted)).toBe("hunter2");
	});

	it("produces a different ciphertext on every encrypt (random IV)", async () => {
		const key = Redacted.make("k");
		const plain = Redacted.make("p");
		const a = await Effect.runPromise(encryptSecret(key, plain));
		const b = await Effect.runPromise(encryptSecret(key, plain));
		expect(a.ciphertext).not.toBe(b.ciphertext);
		expect(a.iv).not.toBe(b.iv);
	});

	it("fails to decrypt with the wrong key", async () => {
		const right = Redacted.make("right");
		const wrong = Redacted.make("wrong");
		const enc = await Effect.runPromise(
			encryptSecret(right, Redacted.make("secret")),
		);
		const result = await Effect.runPromise(
			decryptSecret(wrong, enc).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});

	it("rejects empty key material", async () => {
		const result = await Effect.runPromise(
			encryptSecret(Redacted.make(""), Redacted.make("x")).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});
});
