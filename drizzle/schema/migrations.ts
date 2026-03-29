import { pgTable, varchar, timestamp } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const dieselSchemaMigrations = pgTable("__diesel_schema_migrations", {
	version: varchar({ length: 50 }).primaryKey(),
	runOn: timestamp("run_on").default(sql`CURRENT_TIMESTAMP`).notNull(),
});
