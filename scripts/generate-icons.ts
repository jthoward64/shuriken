// Rasterizes assets/logo/logo.svg into the favicon/PNG set the web UI and
// docs site link to. Re-run this whenever logo.svg changes: `deno task icons`.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LOGO_DIR = path.join(ROOT, "assets/logo");
const SVG_PATH = path.join(LOGO_DIR, "logo.svg");

const PNG_SIZES: ReadonlyArray<{ size: number; file: string }> = [
	{ size: 16, file: "logo-16x16.png" },
	{ size: 32, file: "logo-32x32.png" },
	{ size: 180, file: "logo-180x180.png" },
	{ size: 192, file: "logo-192x192.png" },
	{ size: 512, file: "logo-512x512.png" },
];

// Sizes baked into logo.ico itself, per convention (not written as
// standalone PNGs unless also listed in PNG_SIZES above).
const ICO_SIZE_SMALL = 16;
const ICO_SIZE_MEDIUM = 32;
const ICO_SIZE_LARGE = 48;
const ICO_SIZES: ReadonlyArray<number> = [
	ICO_SIZE_SMALL,
	ICO_SIZE_MEDIUM,
	ICO_SIZE_LARGE,
];

const svg = await Deno.readTextFile(SVG_PATH);

const renderPng = (size: number): Buffer => {
	const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size } });
	return resvg.render().asPng();
};

for (const { size, file } of PNG_SIZES) {
	const out = path.join(LOGO_DIR, file);
	await Deno.writeFile(out, new Uint8Array(renderPng(size)));
	console.log(`wrote ${out}`);
}

const icoBuffers = ICO_SIZES.map((size) => renderPng(size));
const icoBuffer = await pngToIco(icoBuffers);
const icoOut = path.join(LOGO_DIR, "logo.ico");
await Deno.writeFile(icoOut, new Uint8Array(icoBuffer));
console.log(`wrote ${icoOut}`);
