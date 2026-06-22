FROM denoland/deno:alpine AS deps
WORKDIR /app
# Cache dependencies first for better layer reuse.
COPY deno.json deno.lock* ./
RUN deno install

FROM denoland/deno:alpine
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Pre-compile/cache the entrypoint module graph.
RUN deno cache src/index.ts

RUN chmod +x /app/docker/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker/entrypoint.sh"]
