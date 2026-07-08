// ---------------------------------------------------------------------------
// Random VCARD generation + bulk import into an addressbook collection.
// ---------------------------------------------------------------------------

import { faker } from "@faker-js/faker";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { buildVcardComponent } from "#src/services/card-edit/build-vcard.ts";
import { importVcf } from "#src/services/card-edit/import-vcf.ts";
import {
	type ContactFormData,
	emptyContactForm,
} from "#src/services/card-edit/types.ts";
import { chance, intBetween } from "./random.ts";

const HAS_SECOND_EMAIL_PROBABILITY = 0.2;
const HAS_TEL_PROBABILITY = 0.7;
const HAS_ORG_PROBABILITY = 0.4;
const HAS_BDAY_PROBABILITY = 0.3;
const HAS_NOTE_PROBABILITY = 0.15;
const BIRTH_YEARS_AGO_MIN = 18;
const BIRTH_YEARS_AGO_MAX = 80;
const BIRTH_MONTH_MIN = 1;
const BIRTH_MONTH_MAX = 12;
const BIRTH_DAY_MIN = 1;
const BIRTH_DAY_MAX = 28;
const PAD_WIDTH = 2;

const pad2 = (n: number): string => n.toString().padStart(PAD_WIDTH, "0");

const randomBirthDate = (): string => {
	const year =
		Temporal.Now.plainDateISO().year -
		intBetween(BIRTH_YEARS_AGO_MIN, BIRTH_YEARS_AGO_MAX);
	const month = intBetween(BIRTH_MONTH_MIN, BIRTH_MONTH_MAX);
	const day = intBetween(BIRTH_DAY_MIN, BIRTH_DAY_MAX);
	return `${year}-${pad2(month)}-${pad2(day)}`;
};

export const randomContactForm = (): ContactFormData => {
	const firstName = faker.person.firstName();
	const lastName = faker.person.lastName();
	const emails = [
		{ value: faker.internet.email({ firstName, lastName }), types: ["home"] },
		...(chance(HAS_SECOND_EMAIL_PROBABILITY)
			? [
					{
						value: faker.internet.email({ firstName, lastName }),
						types: ["work"],
					},
				]
			: []),
	];
	const tels = chance(HAS_TEL_PROBABILITY)
		? [{ value: faker.phone.number(), types: ["cell"] }]
		: [];

	return {
		...emptyContactForm,
		fn: `${firstName} ${lastName}`,
		familyName: lastName,
		givenName: firstName,
		emails,
		tels,
		org: chance(HAS_ORG_PROBABILITY) ? faker.company.name() : "",
		title: chance(HAS_ORG_PROBABILITY) ? faker.person.jobTitle() : "",
		bday: chance(HAS_BDAY_PROBABILITY) ? randomBirthDate() : "",
		note: chance(HAS_NOTE_PROBABILITY) ? faker.lorem.sentence() : "",
	};
};

/**
 * Generate `count` random contacts for `addressBookId`, importing in
 * `batchSize`-sized chunks via the same `importVcf` bulk-import path a real
 * .vcf file upload uses.
 */
export const seedContacts = (
	addressBookId: CollectionId,
	count: number,
	batchSize: number,
) =>
	Effect.gen(function* () {
		let remaining = count;
		while (remaining > 0) {
			const chunkSize = Math.min(batchSize, remaining);
			const cards: Array<IrComponent> = [];
			for (let i = 0; i < chunkSize; i++) {
				const form = randomContactForm();
				cards.push(buildVcardComponent(crypto.randomUUID(), form));
			}
			const bodies = yield* Effect.forEach(cards, (card) =>
				encodeVCard({ kind: "vcard", root: card }),
			);
			yield* importVcf(addressBookId, bodies.join("\n"), "skip");
			remaining -= chunkSize;
		}
	});
