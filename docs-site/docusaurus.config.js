// @ts-check
// `@type` JSDoc annotations allow editor autocompletion and type checking
// (when paired with `@ts-check`).
// See: https://docusaurus.io/docs/api/docusaurus-config

import path from "node:path";
import { fileURLToPath } from "node:url";
import { themes as prismThemes } from "prism-react-renderer";
import { codeImport as remarkCodeImport } from "remark-code-import";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The repo root, one level up from this docs-site/ subproject — code blocks
// import real files (e.g. docker-compose.example.yaml) from here via
// remark-code-import, so the docs never fall out of sync with the source.
const repoRoot = path.resolve(__dirname, "..");

/** @type {import('@docusaurus/types').Config} */
const config = {
	title: "shuriken-ts",
	tagline: "A CalDAV/CardDAV server, in TypeScript",
	favicon: "img/favicon.ico",

	// Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
	future: {
		v4: true, // Improve compatibility with the upcoming Docusaurus v4
	},

	// GitHub Pages deployment target: https://jthoward64.github.io/shuriken/
	url: "https://jthoward64.github.io",
	baseUrl: "/shuriken/",

	organizationName: "jthoward64",
	projectName: "shuriken",
	deploymentBranch: "gh-pages",
	trailingSlash: false,

	onBrokenLinks: "throw",

	i18n: {
		defaultLocale: "en",
		locales: ["en"],
	},

	presets: [
		[
			"classic",
			/** @type {import('@docusaurus/preset-classic').Options} */
			({
				docs: {
					routeBasePath: "/",
					sidebarPath: "./sidebars.js",
					editUrl:
						"https://github.com/jthoward64/shuriken/tree/main/docs-site/",
					remarkPlugins: [[remarkCodeImport, { rootDir: repoRoot }]],
				},
				blog: false,
				theme: {
					customCss: "./src/css/custom.css",
				},
			}),
		],
	],

	themeConfig:
		/** @type {import('@docusaurus/preset-classic').ThemeConfig} */
		({
			colorMode: {
				respectPrefersColorScheme: true,
			},
			navbar: {
				title: "shuriken-ts",
				logo: {
					alt: "shuriken-ts logo",
					src: "img/logo.svg",
				},
				items: [
					{
						type: "docSidebar",
						sidebarId: "docsSidebar",
						position: "left",
						label: "Docs",
					},
					{
						href: "https://github.com/jthoward64/shuriken",
						label: "GitHub",
						position: "right",
					},
				],
			},
			footer: {
				style: "dark",
				links: [
					{
						title: "Docs",
						items: [
							{ label: "Administrator Guide", to: "/admin/architecture" },
							{ label: "User Guide", to: "/user/signing-in" },
						],
					},
					{
						title: "Project",
						items: [
							{
								label: "GitHub",
								href: "https://github.com/jthoward64/shuriken",
							},
							{
								label: "Issues",
								href: "https://github.com/jthoward64/shuriken/issues",
							},
						],
					},
				],
				copyright: `Copyright © ${new Date().getFullYear()} shuriken-ts contributors. Released under the GPL-3.0-or-later license.`,
			},
			prism: {
				theme: prismThemes.github,
				darkTheme: prismThemes.dracula,
				additionalLanguages: ["bash", "yaml", "json"],
			},
		}),
};

export default config;
