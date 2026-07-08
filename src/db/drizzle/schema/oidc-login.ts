import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { UuidString } from "#src/domain/ids.ts";
import { redactedText, timestampTz } from "./types.ts";

// ---------------------------------------------------------------------------
// oidc_login — short-lived pending-authorization state for the OIDC code flow.
//
// One row is created when the browser is redirected to the identity provider
// and consumed (deleted) at the callback. Keyed by the opaque `state` value the
// IdP echoes back, which lets the callback correlate the response without a
// pre-auth cookie. `pkce_verifier` and `nonce` are redacted so they never reach
// logs; `return_to` is the in-app path to land on after login. Rows past
// `expires_at` are abandoned attempts and are swept by the session cleanup job.
// ---------------------------------------------------------------------------

export const oidcLogin = pgTable(
	"oidc_login",
	{
		id: uuid().default(sql`uuidv7()`).primaryKey().$type<UuidString>(),
		/** Opaque CSRF/correlation value echoed by the IdP in the callback. */
		state: text().notNull(),
		pkceVerifier: redactedText("pkce_verifier").notNull(),
		nonce: redactedText("nonce").notNull(),
		returnTo: text("return_to").notNull(),
		createdAt: timestampTz("created_at").default(sql`now()`).notNull(),
		expiresAt: timestampTz("expires_at").notNull(),
	},
	(table) => [
		uniqueIndex("uq_oidc_login_state").using(
			"btree",
			table.state.asc().nullsLast(),
		),
		index("idx_oidc_login_expires_at").using(
			"btree",
			table.expiresAt.asc().nullsLast(),
		),
	],
);
