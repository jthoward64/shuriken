import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import process from "node:process";

export default defineConfig({
	out: "./src/db/drizzle",
	schema: "./src/db/drizzle/schema/index.ts",
	dialect: "postgresql",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: drizzle will handle missing value
		url: process.env.DATABASE_URL!,
	},
	introspect: {
		casing: "preserve",
	},
});
