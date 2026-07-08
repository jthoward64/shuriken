import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { decodeVCard, encodeVCard } from "#src/data/vcard/codec.ts";
import { baseName, getText } from "#src/data/vcard/prop.ts";
import {
	type CollectionId,
	EntityId,
	type InstanceId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email, ETag } from "#src/domain/types/strings.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { parseVcardToForm } from "./parse-vcard.ts";

// ---------------------------------------------------------------------------
// Editing a contact through the web-UI service must be NON-DESTRUCTIVE: an Apple
// vCard 3.0 with grouped emails, X-ABLabel, X-SOCIALPROFILE, NICKNAME, ROLE, a
// custom X-*, and metadata (REV) must survive an edit that only touches FN.
// ---------------------------------------------------------------------------

const APPLE_CARD = [
	"BEGIN:VCARD",
	"VERSION:3.0",
	"PRODID:-//Apple Inc.//iPhone OS 26.5//EN",
	"UID:edit-preserve-1",
	"REV:20240101T000000Z",
	"N:Saxton;Josh;Q;Dr;Jr",
	"FN:Josh Saxton",
	"NICKNAME:Joshy",
	"ROLE:Therapist",
	"item1.EMAIL;TYPE=INTERNET;TYPE=pref:saxton@yahoo.com",
	"item1.X-ABLABEL:_$!<Other>!$_",
	"TEL;TYPE=CELL;TYPE=VOICE;TYPE=pref:+1 (859) 420-5324",
	"X-SOCIALPROFILE;TYPE=Slack;X-USER=UG30UMQLB:https://slack.example/UG30",
	"X-ADDRESSING-GRAMMAR:custom-junk",
	"END:VCARD",
	"",
].join("\r\n");

describe("CardEditService.update (non-destructive)", () => {
	it("preserves every property/param when editing only the display name", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { entityId, instanceId } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const alice = yield* prov
						.provisionUser({
							email: Email("edit-preserve@example.com"),
							name: "Alice",
							slug: Slug("edit-preserve"),
						})
						.pipe(Effect.orDie);
					const ab = alice.addressBook.id as CollectionId;

					const doc = yield* decodeVCard(APPLE_CARD);
					const canonical = yield* encodeVCard(doc);
					const etag = ETag(yield* makeEtag(canonical));
					const entityRepo = yield* EntityRepository;
					const componentRepo = yield* ComponentRepository;
					const instanceSvc = yield* InstanceService;
					const entity = yield* entityRepo.insert({
						entityType: "vcard",
						logicalUid: "edit-preserve-1",
					});
					const eid = EntityId(entity.id);
					yield* componentRepo.insertTree(eid, doc.root);
					const inst = yield* instanceSvc.put({
						collectionId: ab,
						entityId: eid,
						contentType: "text/vcard",
						etag,
						slug: Slug("edit-preserve-1.vcf"),
						contentLength: new TextEncoder().encode(canonical).byteLength,
					});
					return { entityId: eid, instanceId: inst.id as InstanceId };
				}),
			);

			// Load → parse to form (as the edit page does) → change only FN → save.
			await runtime.runPromise(
				Effect.gen(function* () {
					const componentRepo = yield* ComponentRepository;
					const cardEdit = yield* CardEditService;
					const treeOpt = yield* componentRepo.loadTree(entityId, "vcard");
					const tree = Option.getOrThrow(treeOpt);
					const formData = parseVcardToForm(tree);
					yield* cardEdit.update(instanceId, {
						...formData,
						fn: "Joshua Saxton",
					});
				}),
			);

			const { out, encoded } = await runtime.runPromise(
				Effect.gen(function* () {
					const cr = yield* ComponentRepository;
					const tree = yield* cr.loadTree(entityId, "vcard");
					const t = Option.getOrThrow(tree);
					const text = yield* encodeVCard({ kind: "vcard", root: t });
					return { out: tree, encoded: text };
				}),
			);
			// Non-TEXT-valued props (REV timestamp, NICKNAME list) survive —
			// verified on the wire rather than via getText.
			expect(encoded).toContain("REV:20240101T000000Z");
			expect(encoded).toContain("NICKNAME:Joshy");
			expect(Option.isSome(out)).toBe(true);
			if (Option.isSome(out)) {
				const props = out.value.properties;
				const has = (name: string) => props.some((p) => p.name === name);
				const byBase = (b: string) =>
					props.filter((p) => baseName(p.name) === b);
				const text = (name: string) =>
					getText(props.find((p) => p.name === name));

				// The one intended edit:
				expect(text("FN")).toBe("Joshua Saxton");
				// Everything else preserved:
				expect(text("VERSION")).toBe("3.0");
				expect(text("PRODID")).toContain("Apple");
				expect(has("REV")).toBe(true);
				expect(text("N")).toBe("Saxton;Josh;Q;Dr;Jr");
				expect(has("NICKNAME")).toBe(true);
				expect(text("ROLE")).toBe("Therapist");
				expect(text("X-ADDRESSING-GRAMMAR")).toBe("custom-junk");
				expect(has("item1.EMAIL")).toBe(true);
				expect(text("item1.EMAIL")).toBe("saxton@yahoo.com");
				expect(has("item1.X-ABLABEL")).toBe(true);
				expect(byBase("TEL").length).toBe(1);
				const social = props.find(
					(p) => baseName(p.name) === "X-SOCIALPROFILE",
				);
				expect(getText(social)).toBe("https://slack.example/UG30");
				expect(social?.parameters).toContainEqual({
					name: "X-USER",
					value: "UG30UMQLB",
				});
			}
		} finally {
			await runtime.dispose();
		}
	});
});
