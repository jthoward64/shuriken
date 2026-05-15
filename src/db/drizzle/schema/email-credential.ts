import { sql } from "drizzle-orm";
import {
	check,
	integer,
	pgTable,
	text,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { drizzleEnum, type GetDrizzleEnumType, timestampTz } from "./types";
import { user } from "./user";

// ---------------------------------------------------------------------------
// user_email_credential — per-user outbound SMTP credentials.
//
// The password is stored in `password_encrypted` as the AES-GCM ciphertext of
// the raw password using EMAIL_CREDS_KEY. Format: `<base64-iv>.<base64-ct>`.
// `password_iv` is intentionally redundant with the prefix in
// password_encrypted to make rotation jobs (re-encrypt with a new key)
// easier to spot-check via SQL.
//
// One row per user; users without a row fall back to server-wide profiles or
// the default mailer.
// ---------------------------------------------------------------------------

const securityEnum = drizzleEnum(
	"smtp_security",
	["none", "starttls", "tls"] as const,
	"text",
);
export type SmtpSecurity = GetDrizzleEnumType<typeof securityEnum>;

export const userEmailCredential = pgTable(
	"user_email_credential",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		fromAddress: text("from_address").notNull(),
		fromName: text("from_name"),
		host: text().notNull(),
		port: integer().notNull(),
		username: text().notNull(),
		passwordEncrypted: text("password_encrypted").notNull(),
		passwordIv: text("password_iv").notNull(),
		security: text().notNull().$type<SmtpSecurity>(),
		updatedAt: timestampTz("updated_at").default(sql`now()`).notNull(),
	},
	(table) => [
		uniqueIndex("uq_user_email_credential_user").using(
			"btree",
			table.userId.asc().nullsLast(),
		),
		check("user_email_credential_security_check", securityEnum.sql),
	],
);
