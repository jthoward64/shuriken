import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { timestampTz } from "./types.ts";
import { user } from "./user.ts";

// ---------------------------------------------------------------------------
// session — server-side browser sessions for the web UI.
//
// Created after a successful OIDC login. The session cookie carries an opaque
// random token; only the SHA-256 hash of that token is stored here (`token_hash`),
// so a database leak never yields a usable cookie. Validation is a single
// indexed lookup by hash followed by an expiry check; revocation (logout, admin
// kill) deletes the row. SHA-256 — not argon2 — because these tokens are
// high-entropy random secrets, so the per-request cost must stay negligible.
// ---------------------------------------------------------------------------

export const session = pgTable(
	"session",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		userId: uuid("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" })
			.$type<UuidString>(),
		/** Hex-encoded SHA-256 of the opaque cookie token. */
		tokenHash: text("token_hash").notNull(),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
		expiresAt: timestampTz("expires_at").notNull(),
		lastSeenAt: timestampTz("last_seen_at").default(sql`now()`).notNull(),
		userAgent: text("user_agent"),
		ip: text(),
	},
	(table) => [
		uniqueIndex("uq_session_token_hash").using(
			"btree",
			table.tokenHash.asc().nullsLast(),
		),
		index("idx_session_user_id").using("btree", table.userId.asc().nullsLast()),
		index("idx_session_expires_at").using(
			"btree",
			table.expiresAt.asc().nullsLast(),
		),
	],
);
