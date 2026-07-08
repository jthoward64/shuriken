import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime } from "effect";
import type { CollectionId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { exportCalendarToIcs } from "#src/services/cal-edit/export-ics.ts";
import { importIcs } from "#src/services/cal-edit/import-ics.ts";
import { exportAddressBookToVcf } from "#src/services/card-edit/export-vcf.ts";
import { importVcf } from "#src/services/card-edit/import-vcf.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";

// ---------------------------------------------------------------------------
// Real-world gist imports — exercise the bulk import services against the
// kind of files clients actually produce. Sources are .ics / .vcf bodies
// pulled from public gists (linked by the user) and committed under
// __fixtures__/dav-gists/.
//
// Each fixture is fed through all three modes:
//   * skip   on first import → all events insert
//   * error  on second import → every event is now a conflict, no writes
//   * merge  on third import → every event is replaced, count == merged
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, "__fixtures__/dav-gists");

const setupAlice = Effect.gen(function* () {
	const prov = yield* ProvisioningService;
	const alice = yield* prov
		.provisionUser({
			email: Email("alice@example.com"),
			name: "Alice",
			slug: Slug("alice"),
		})
		.pipe(Effect.orDie);
	return {
		calendarId: alice.calendar.id as CollectionId,
		bookId: alice.addressBook.id as CollectionId,
	};
});

const icsFiles = readdirSync(FIXTURES_DIR)
	.filter((f) => f.endsWith(".ics"))
	.sort();
const vcfFiles = readdirSync(FIXTURES_DIR)
	.filter((f) => f.endsWith(".vcf"))
	.sort();

describe("Real-world gist .ics import (all 3 modes)", () => {
	for (const file of icsFiles) {
		const path = resolve(FIXTURES_DIR, file);
		const body = readFileSync(path, "utf8");
		const expectedEvents = (body.match(/^BEGIN:VEVENT/gm) ?? []).length;
		const uniqueUids = new Set(
			(body.match(/^UID:.+$/gm) ?? []).map((l) => l.slice(4).trim()),
		).size;

		it(`${file} (${expectedEvents} VEVENTs, ${uniqueUids} unique UIDs)`, async () => {
			const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
			try {
				const { calendarId } = await runtime.runPromise(setupAlice);

				// Skip mode on a fresh calendar inserts every unique-UID group.
				const first = await runtime.runPromise(
					importIcs(calendarId, body, "skip"),
				);
				expect(first.inserted).toBe(uniqueUids);
				expect(first.skipped).toBe(0);
				expect(first.conflicts).toEqual([]);

				// Error mode now finds every UID as a conflict and writes nothing.
				const second = await runtime.runPromise(
					importIcs(calendarId, body, "error"),
				);
				expect(second.inserted).toBe(0);
				expect(second.merged).toBe(0);
				expect(second.conflicts.length).toBe(uniqueUids);

				// Merge mode replaces every existing entity in place.
				const third = await runtime.runPromise(
					importIcs(calendarId, body, "merge"),
				);
				expect(third.merged).toBe(uniqueUids);
				expect(third.inserted).toBe(0);

				// Round-trip: export should round-trip every UID we imported, and
				// every TZID reference on properties should survive (regression
				// guard for floating-time conversion bugs).
				const exported = await runtime.runPromise(
					exportCalendarToIcs(calendarId),
				);
				const exportedUids = new Set(
					(exported.match(/^UID:.+$/gm) ?? []).map((l) => l.slice(4).trim()),
				);
				expect(exportedUids.size).toBe(uniqueUids);

				const sourceTzids = (body.match(/TZID=[^:;]+/g) ?? []).length;
				const exportedTzids = (exported.match(/TZID=[^:;]+/g) ?? []).length;
				if (sourceTzids > 0) {
					expect(exportedTzids).toBeGreaterThanOrEqual(sourceTzids);
				}
			} finally {
				await runtime.dispose();
			}
		});
	}
});

describe("Real-world gist .vcf import (all 3 modes)", () => {
	for (const file of vcfFiles) {
		const path = resolve(FIXTURES_DIR, file);
		const body = readFileSync(path, "utf8");
		const expectedCards = (body.match(/^BEGIN:VCARD/gm) ?? []).length;
		const stableUidCount = new Set(
			(body.match(/^UID:.+$/gm) ?? []).map((l) => l.slice(4).trim()),
		).size;
		const uidlessCards = expectedCards - stableUidCount;

		it(`${file} (${expectedCards} VCARDs, ${stableUidCount} with UID)`, async () => {
			const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
			try {
				const { bookId } = await runtime.runPromise(setupAlice);

				// First import inserts everything: UID cards by their UID, UID-less
				// cards by a generated random UUID per row.
				const first = await runtime.runPromise(importVcf(bookId, body, "skip"));
				expect(first.inserted).toBe(expectedCards);
				expect(first.conflicts).toEqual([]);

				// Error mode: stable-UID cards collide AND UID-less cards collide
				// via their synthetic-fp fingerprint, so the whole file is now
				// detected as a duplicate set on re-import. No writes happen.
				const second = await runtime.runPromise(
					importVcf(bookId, body, "error"),
				);
				expect(second.conflicts.length).toBeGreaterThanOrEqual(
					stableUidCount + uidlessCards,
				);
				expect(second.inserted).toBe(0);
				expect(second.merged).toBe(0);

				// Merge: stable-UID cards replaced in place, UID-less cards
				// replaced via their fingerprint key.
				const third = await runtime.runPromise(
					importVcf(bookId, body, "merge"),
				);
				expect(third.merged).toBeGreaterThanOrEqual(
					stableUidCount + uidlessCards,
				);
				expect(third.inserted).toBe(0);

				// Round-trip: every card we wrote should still be there after the
				// merge replaced each row in place.
				const exported = await runtime.runPromise(
					exportAddressBookToVcf(bookId),
				);
				const exportedCards = (exported.match(/^BEGIN:VCARD/gm) ?? []).length;
				expect(exportedCards).toBe(expectedCards);
			} finally {
				await runtime.dispose();
			}
		});
	}
});
