// Build step: writes the compiled design-system stylesheet to disk. CssService
// serves this file verbatim at runtime, so it must be regenerated whenever
// input.css or the classes used in src/http/ui change. Running compilation here
// rather than at server startup keeps the Tailwind/PostCSS/cssnano toolchain
// (~36 MB of heap) out of the long-lived server process. Run with:
// `deno task ui:css` — the Docker build and the `dev` task both do.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileCss } from "#src/http/ui/css/compile.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const INPUT_CSS = path.join(ROOT, "src/http/ui/styles/input.css");
const UI_DIR = path.join(ROOT, "src/http/ui");
const OUT = path.join(ROOT, "src/http/ui/static/app.css");

const input = await Deno.readTextFile(INPUT_CSS);
const css = await compileCss({ input, uiDir: UI_DIR });

await Deno.mkdir(path.dirname(OUT), { recursive: true });
await Deno.writeTextFile(OUT, css);

console.log(`wrote ${OUT} (${css.length} bytes)`);
