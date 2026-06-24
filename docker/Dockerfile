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

# Distroless has no shell, so the entrypoint is a Deno task (run via Deno's
# built-in task shell) rather than entrypoint.sh. node_modules and the Deno
# module cache (/deno-dir) are carried over from the build stage so nothing
# needs to be fetched at runtime.
FROM denoland/deno:distroless
WORKDIR /app
COPY --from=build /deno-dir /deno-dir
COPY --from=build /app /app

EXPOSE 3000

# The base image ENTRYPOINT is ["/tini","--","/bin/deno"]; CMD supplies deno's
# args. `docker:start` runs migrations then starts the server.
CMD ["task", "docker:start"]
