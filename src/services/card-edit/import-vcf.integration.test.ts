import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import type { CollectionId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { importVcf } from "./import-vcf.ts";

const SAMPLE_VCF = `BEGIN:VCARD
VERSION:4.0
UID:card-1@test
FN:Alice
END:VCARD
BEGIN:VCARD
VERSION:4.0
UID:card-2@test
FN:Bob
END:VCARD
`;

const REIMPORT_VCF = `BEGIN:VCARD
VERSION:4.0
UID:card-1@test
FN:Alice (updated)
END:VCARD
BEGIN:VCARD
VERSION:4.0
UID:card-3@test
FN:Carol
END:VCARD
`;

const setupAlice = Effect.gen(function* () {
	const prov = yield* ProvisioningService;
	const alice = yield* prov
		.provisionUser({
			email: Email("alice@example.com"),
			name: "Alice",
			slug: Slug("alice"),
		})
		.pipe(Effect.orDie);
	return alice.addressBook.id as CollectionId;
});

describe("importVcf (integration)", () => {
	it("inserts new cards on first import", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const bookId = await runtime.runPromise(setupAlice);
			const result = await runtime.runPromise(
				importVcf(bookId, SAMPLE_VCF, "skip"),
			);
			expect(result.inserted).toBe(2);
		} finally {
			await runtime.dispose();
		}
	});

	it("error mode reports conflicts without writes", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const bookId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importVcf(bookId, SAMPLE_VCF, "skip"));
			const result = await runtime.runPromise(
				importVcf(bookId, REIMPORT_VCF, "error"),
			);
			expect(result.inserted).toBe(0);
			expect(result.conflicts).toEqual(["card-1@test"]);
		} finally {
			await runtime.dispose();
		}
	});

	it("skip mode imports only new cards", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const bookId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importVcf(bookId, SAMPLE_VCF, "skip"));
			const result = await runtime.runPromise(
				importVcf(bookId, REIMPORT_VCF, "skip"),
			);
			expect(result.inserted).toBe(1);
			expect(result.skipped).toBe(1);
		} finally {
			await runtime.dispose();
		}
	});

	it("UID-less cards dedupe via synthetic FN+EMAIL key on re-import", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		const noUid = `BEGIN:VCARD
VERSION:4.0
FN:Carol No-UID
EMAIL:carol@example.com
END:VCARD
`;
		try {
			const bookId = await runtime.runPromise(setupAlice);
			const first = await runtime.runPromise(importVcf(bookId, noUid, "skip"));
			expect(first.inserted).toBe(1);
			// Second import detects the synthetic key as a conflict instead of
			// re-inserting a duplicate row.
			const second = await runtime.runPromise(
				importVcf(bookId, noUid, "error"),
			);
			expect(second.inserted).toBe(0);
			expect(second.conflicts.length).toBe(1);
			// Skip mode reports the duplicate as skipped, not inserted.
			const third = await runtime.runPromise(importVcf(bookId, noUid, "skip"));
			expect(third.inserted).toBe(0);
			expect(third.skipped).toBe(1);
		} finally {
			await runtime.dispose();
		}
	});

	it("merge mode replaces existing cards by UID", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const bookId = await runtime.runPromise(setupAlice);
			await runtime.runPromise(importVcf(bookId, SAMPLE_VCF, "skip"));
			const result = await runtime.runPromise(
				importVcf(bookId, REIMPORT_VCF, "merge"),
			);
			expect(result.inserted).toBe(1);
			expect(result.merged).toBe(1);
		} finally {
			await runtime.dispose();
		}
	});
});
