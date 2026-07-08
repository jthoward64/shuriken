import { sql } from "drizzle-orm";
import { index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { redactedText, timestampTz } from "./types.ts";
import { user } from "./user.ts";

export const authUser = pgTable(
	"auth_user",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		/**
		 * Identity provider for this credential:
		 *   "local"        — password set in-app, verified via Basic auth
		 *   "app_password" — generated per-device secret, verified via Basic auth
		 *   "oidc"         — federated identity (authCredential is null)
		 */
		authSource: text("auth_source").notNull(),
		/**
		 * Provider-scoped identifier: the username for "local", a generated
		 * username for "app_password", or "<issuer>|<sub>" for "oidc".
		 */
		authId: text("auth_id").notNull(),
		/** User-facing name for an app password (e.g. "iPhone"); null otherwise. */
		label: text(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
		/** Last time this credential authenticated a request; app passwords only. */
		lastUsedAt: timestampTz("last_used_at"),
		authCredential: redactedText("auth_credential"),
	},
	(table) => [
		index("idx_auth_user_auth_source_auth_id").using(
			"btree",
			table.authSource.asc().nullsLast(),
			table.authId.asc().nullsLast(),
		),
		index("idx_auth_user_user_id").using(
			"btree",
			table.userId.asc().nullsLast(),
		),
		unique("auth_user_auth_source_auth_id_key").on(
			table.authSource,
			table.authId,
		),
	],
);
