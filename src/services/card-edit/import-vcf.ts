import { Effect, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import type { IrComponent } from "#src/data/ir.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import { InstanceService } from "#src/services/instance/service.ts";

// ---------------------------------------------------------------------------
// importVcf — bulk import a multi-VCARD payload into an addressbook.
//
// Modes mirror importIcs: error / skip / merge. Each VCARD is a self-
// contained entity keyed by its UID property; cards without a UID are
// assigned a generated one (and so never collide).
// ---------------------------------------------------------------------------

export type ImportMode = "error" | "skip" | "merge";

export interface ImportVcfResult {
	readonly inserted: number;
	readonly skipped: number;
	readonly merged: number;
	readonly conflicts: ReadonlyArray<string>;
}

const VCARD_BEGIN = /^BEGIN:VCARD\s*$/im;
const VCARD_END = /^END:VCARD\s*$/im;

const HEX_RADIX = 16;
const HEX_PAD_LENGTH = 2;

/**
 * Split a concatenated VCF stream into one chunk per VCARD. Whitespace
 * between cards is discarded; a chunk runs from a BEGIN:VCARD line through
 * its matching END:VCARD line inclusive.
 */
const splitVcards = (text: string): ReadonlyArray<string> => {
	const lines = text.split(/\r?\n/);
	const chunks: Array<string> = [];
	let current: Array<string> | null = null;
	for (const line of lines) {
		if (VCARD_BEGIN.test(line)) {
			current = [line];
			continue;
		}
		if (current === null) {
			continue;
		}
		current.push(line);
		if (VCARD_END.test(line)) {
			chunks.push(`${current.join("\r\n")}\r\n`);
			current = null;
		}
	}
	return chunks;
};

const SLUG_MAX_BODY = 120;
const slugFromUid = (uid: string): Slug => {
	const safe = uid.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "card"}.vcf`);
};

const uidOf = (root: IrComponent): Option.Option<string> => {
	const uid = root.properties.find((p) => p.name.toUpperCase() === "UID");
	if (!uid) {
		return Option.none();
	}
	if (uid.value.type === "URI" || uid.value.type === "TEXT") {
		return Option.some(uid.value.value);
	}
	return Option.none();
};

/**
 * Derive a stable synthetic UID for a card that has no UID property.
 *
 * Without UID, a fresh `crypto.randomUUID()` per parse would create
 * duplicates on every re-import. We fingerprint every property name + value
 * in declaration order and hash the result with SHA-256, so:
 *
 *   * Re-importing the same file dedupes (collision means byte-identical
 *     property sets — the actual definition of "duplicate").
 *   * Two real distinct contacts can NEVER collide unless every recorded
 *     property is identical, eliminating the false-positive risk that an
 *     FN+EMAIL shortcut would carry (e.g. two "Bob Smith" entries without
 *     emails would otherwise overwrite each other on merge).
 *   * The trade-off is a false negative when a card is edited between
 *     exports — it will re-import as a new row rather than updating in
 *     place. This is the honest outcome; the user can clean up duplicates
 *     manually rather than risk silent overwrites.
 *
 * Hashing keeps the stored logical_uid short (64 hex chars) — important
 * because dav_entity.logical_uid has a btree index with a per-row size
 * cap (~2704 bytes), and large cards with embedded PHOTO data can blow
 * straight past it if the raw fingerprint is stored.
 *
 * The `synthetic-fp:` prefix flags the row as not coming from authoritative
 * source data.
 */
const syntheticUid = (root: IrComponent): Effect.Effect<string, never> =>
	Effect.gen(function* () {
		const fingerprint = root.properties
			.map((p) => {
				const v = p.value;
				const text =
					v.type === "TEXT" || v.type === "URI" ? v.value : JSON.stringify(v);
				return `${p.name.toUpperCase()}=${text}`;
			})
			.join("\n");
		const bytes = new TextEncoder().encode(fingerprint);
		const digest = yield* Effect.promise(() =>
			crypto.subtle.digest("SHA-256", bytes),
		);
		const hex = Array.from(new Uint8Array(digest))
			.map((b) => b.toString(HEX_RADIX).padStart(HEX_PAD_LENGTH, "0"))
			.join("");
		return `synthetic-fp:${hex}`;
	});

export const importVcf = (
	collectionId: CollectionId,
	body: string,
	mode: ImportMode,
): Effect.Effect<
	ImportVcfResult,
	DatabaseError | DavError | InternalError,
	ComponentRepository | DatabaseClient | EntityRepository | InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const chunks = splitVcards(body);
		if (chunks.length === 0) {
			return { inserted: 0, skipped: 0, merged: 0, conflicts: [] };
		}

		const parsed: Array<{ readonly uid: string; readonly root: IrComponent }> =
			[];
		for (const chunk of chunks) {
			const doc = yield* decodeVCard(chunk);
			if (doc.kind !== "vcard" || doc.root.name !== "VCARD") {
				return yield* Effect.fail(
					new InternalError({ cause: new Error("expected VCARD root") }),
				);
			}
			const uidOpt = uidOf(doc.root);
			const uid = Option.isSome(uidOpt)
				? uidOpt.value
				: yield* syntheticUid(doc.root);
			parsed.push({ uid, root: doc.root });
		}

		const conflicts: Array<string> = [];
		for (const p of parsed) {
			const exists = yield* entityRepo.existsByUid(collectionId, p.uid);
			if (exists) {
				conflicts.push(p.uid);
			}
		}

		if (mode === "error" && conflicts.length > 0) {
			return { inserted: 0, skipped: 0, merged: 0, conflicts };
		}

		const conflictSet = new Set(conflicts);
		let inserted = 0;
		let skipped = 0;
		let merged = 0;

		const writeCard = (
			uid: string,
			root: IrComponent,
			replaceExisting: boolean,
		) =>
			withTransaction(
				Effect.gen(function* () {
					if (replaceExisting) {
						const existingInstances =
							yield* entityRepo.listActiveInstancesWithUid(collectionId);
						for (const ex of existingInstances) {
							if (ex.logicalUid === uid) {
								yield* instanceSvc.delete(ex.instanceId);
								yield* entityRepo.softDelete(ex.entityId);
							}
						}
					}
					const canonical = yield* encodeVCard({ kind: "vcard", root });
					const etag = ETag(yield* makeEtag(canonical));
					const contentLength = new TextEncoder().encode(canonical).byteLength;
					const slug = slugFromUid(uid);
					const entityRow = yield* entityRepo.insert({
						entityType: "vcard",
						logicalUid: uid,
					});
					const eid = EntityId(entityRow.id);
					yield* componentRepo.insertTree(eid, root);
					yield* instanceSvc.put({
						collectionId,
						entityId: eid,
						contentType: "text/vcard",
						etag,
						slug,
						contentLength,
					});
				}),
			).pipe(Effect.provideService(DatabaseClient, db));

		for (const p of parsed) {
			const conflict = conflictSet.has(p.uid);
			if (conflict && mode === "skip") {
				skipped += 1;
				continue;
			}
			if (conflict && mode === "merge") {
				yield* writeCard(p.uid, p.root, true);
				merged += 1;
				continue;
			}
			yield* writeCard(p.uid, p.root, false);
			inserted += 1;
		}

		return { inserted, skipped, merged, conflicts: [] };
	});
