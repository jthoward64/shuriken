import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "src/db/drizzle/migrations",
	schema: "src/db/drizzle/schema/index.ts",
	dialect: "postgresql",
	dbCredentials: {
		// drizzle will handle a missing value
		url: Deno.env.get("DATABASE_URL") ?? "",
	},
	verbose: true,
});
