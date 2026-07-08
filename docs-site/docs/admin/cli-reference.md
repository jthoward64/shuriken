---
sidebar_position: 12
---

# Quick command reference

The most operationally relevant tasks, all run via `deno task <name>`.
This is the live task list from
[`deno.json`](https://github.com/jthoward64/shuriken/blob/main/deno.json):

```json title="deno.json" file=<rootDir>/deno.json#L6-L25
```

The ones you'll use most as an operator:

- `deno task start` — run the server (no migrations).
- `deno task docker:start` — `migrations:run` then `start`; this is what
  container images run by default.
- `deno task migrations:run` — apply pending database migrations.
- `deno task db:reset` — **destructive**, dev/test only; see
  [Database operations](./database).
- `deno task db:seed` — populate realistic sample data; see
  [Database operations](./database).
