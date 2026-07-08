// Debug helper: writes the compiled design-system stylesheet to disk so it can
// be inspected. The running server does NOT read this file — CssService compiles
// the same input in-memory at startup. Run with: `deno task ui:css`.

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
