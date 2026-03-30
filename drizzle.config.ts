import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// biome-ignore lint/style/noDefaultExport: required by drizzle-kit
export default defineConfig({
	out: "./src/drizzle",
	schema: "./src/drizzle/schema/index.ts",
	dialect: "postgresql",
	dbCredentials: {
		// biome-ignore lint/style/noNonNullAssertion: drizzle will handle missing value
		// biome-ignore lint/style/noProcessEnv: simpler
		url: process.env.DATABASE_URL!,
	},
	introspect: {
		casing: "preserve",
	},
});
