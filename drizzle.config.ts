import "dotenv/config";
import process from "node:process";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "src/db/drizzle/migrations",
	schema: "src/db/drizzle/schema/index.ts",
	dialect: "postgresql",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: drizzle will handle missing value
		url: process.env.DATABASE_URL!,
	},
});
