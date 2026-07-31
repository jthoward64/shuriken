FROM denoland/deno:alpine AS deps
WORKDIR /app
# Cache dependencies first for better layer reuse.
COPY deno.json deno.lock* ./
RUN deno install

FROM denoland/deno:alpine AS build
WORKDIR /app
# Carry the npm cache (tarballs from `deno install`) and node_modules so nothing
# is fetched at runtime — including the migration tooling (drizzle-kit/esbuild),
# which is invoked via a task and isn't part of the src/index.ts module graph.
COPY --from=deps /deno-dir /deno-dir
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Pre-compile/cache the entrypoint module graph into DENO_DIR.
RUN deno cache src/index.ts
# Compile the UI assets that CssService and ClientJsService serve at runtime:
# the Tailwind stylesheet and the bundled browser scripts. Done here so the
# server process never imports the Tailwind/PostCSS/cssnano toolchain and never
# runs Deno.bundle(), and because the runtime root filesystem is read-only.
RUN deno task ui:assets
# Bundle the server into a single self-contained server.js. Tree-shaking and
# minification cut the module graph's heap roughly in half (notably dropping
# fast-check and Effect's JSDoc, which the `effect` barrel would otherwise
# load in full) and collapse ~1500 module records into one script.
RUN deno task bundle

# Distroless has no shell, so the entrypoint is a Deno task (run via Deno's
# built-in task shell) rather than entrypoint.sh. node_modules and the Deno
# module cache (/deno-dir) are carried over from the build stage so nothing
# needs to be fetched at runtime — the bundle covers the server itself, but
# `migrations:run` still shells out to drizzle-kit.
FROM denoland/deno:distroless
WORKDIR /app
COPY --from=build /deno-dir /deno-dir
COPY --from=build /app /app

# A bundle has no source-tree location to resolve assets against, so the UI
# asset directory is named explicitly rather than derived from import.meta.url.
ENV UI_ASSET_ROOT=/app/src/http/ui/static

EXPOSE 3000

# The base image ENTRYPOINT is ["/tini","--","/bin/deno"]; CMD supplies deno's
# args. `docker:start` runs migrations then starts the server.
CMD ["task", "docker:start"]
