// ---------------------------------------------------------------------------
// Per-user provisioning: account + credentials + extra personal
// calendars/addressbooks beyond the auto-provisioned "primary" ones.
// ---------------------------------------------------------------------------

import { faker } from "@faker-js/faker";
import { Effect, Option, Redacted } from "effect";
import { CollectionId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { intBetween, pick } from "./random.ts";

const SEED_PASSWORD = "password";
const APP_PASSWORD_LABEL = "Seed Device";

const EXTRA_CALENDAR_NAMES = [
	"Work",
	"Family",
	"Travel",
	"Fitness",
	"Side Projects",
	"Reading List",
];
const EXTRA_ADDRESSBOOK_NAMES = ["Work Contacts", "Friends", "Family"];

export interface SeededUser {
	readonly userId: UserId;
	readonly principalId: PrincipalId;
	readonly email: string;
	readonly displayName: string;
	readonly calendarIds: ReadonlyArray<CollectionId>;
	readonly addressBookIds: ReadonlyArray<CollectionId>;
}

const createExtraCollections = Effect.fn("seed.extraCollections")(function* (
	ownerPrincipalId: PrincipalId,
	spec: {
		readonly slugPrefix: string;
		readonly uniqueSuffix: number;
		readonly count: number;
		readonly namePool: ReadonlyArray<string>;
		readonly collectionType: "calendar" | "addressbook";
	},
) {
	const { slugPrefix, uniqueSuffix, count, namePool, collectionType } = spec;
	const collections = yield* CollectionService;
	const rows: Array<CollectionRow> = [];
	for (let i = 0; i < count; i++) {
		const row = yield* collections.create({
			ownerPrincipalId,
			collectionType,
			slug: Slug(`${slugPrefix}-${i}`),
			displayName: `${pick(namePool)} (${uniqueSuffix})`,
			supportedComponents:
				collectionType === "calendar" ? ["VEVENT"] : ["VCARD"],
		});
		rows.push(row);
	}
	return rows;
});

/**
 * Provision one fake user: account + local password + one app password, plus
 * a randomized number of extra personal calendars/addressbooks beyond the
 * auto-created "primary" ones.
 */
export const seedUser = Effect.fn("seed.user")(function* (
	index: number,
	counts: {
		readonly calendarsMin: number;
		readonly calendarsMax: number;
		readonly addressBooksMin: number;
		readonly addressBooksMax: number;
	},
) {
	const { calendarsMin, calendarsMax, addressBooksMin, addressBooksMax } =
		counts;
	const provisioning = yield* ProvisioningService;
	const appPasswords = yield* AppPasswordService;

	const firstName = faker.person.firstName();
	const lastName = faker.person.lastName();
	const displayName = `${firstName} ${lastName}`;
	const slug = Slug(
		`${faker.helpers.slugify(displayName).toLowerCase()}-${index}`,
	);
	const email = Email(`${slug}@seed.example`);

	const provisioned = yield* provisioning.provisionUser({
		email,
		name: displayName,
		slug,
		credentials: [
			{
				source: "local",
				authId: slug,
				password: Redacted.make(SEED_PASSWORD),
			},
		],
	});

	const userId = UserId(provisioned.user.user.id);
	const principalId = PrincipalId(provisioned.user.principal.id);

	yield* appPasswords.generate({
		userId,
		label: Option.some(APP_PASSWORD_LABEL),
	});

	const extraCalendarCount = intBetween(calendarsMin, calendarsMax);
	const extraCalendars = yield* createExtraCollections(principalId, {
		slugPrefix: `${slug}-cal`,
		uniqueSuffix: index,
		count: extraCalendarCount,
		namePool: EXTRA_CALENDAR_NAMES,
		collectionType: "calendar",
	});

	const extraAddressBookCount = intBetween(addressBooksMin, addressBooksMax);
	const extraAddressBooks = yield* createExtraCollections(principalId, {
		slugPrefix: `${slug}-ab`,
		uniqueSuffix: index,
		count: extraAddressBookCount,
		namePool: EXTRA_ADDRESSBOOK_NAMES,
		collectionType: "addressbook",
	});

	const calendarIds = [provisioned.calendar, ...extraCalendars].map((c) =>
		CollectionId(c.id),
	);
	const addressBookIds = [provisioned.addressBook, ...extraAddressBooks].map(
		(c) => CollectionId(c.id),
	);
	return {
		userId,
		principalId,
		email,
		displayName,
		calendarIds,
		addressBookIds,
	} satisfies SeededUser;
});
