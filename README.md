# shuriken-ts

A CalDAV/CardDAV server implementation in TypeScript, running on [Deno](https://deno.com).

To install dependencies:

```bash
deno install
```

To run the server (loads `.env`, runs against the configured database):

```bash
deno task start
```

Other useful tasks:

```bash
deno task dev          # start with --watch
deno task test         # run the test suite
deno task check        # type-check
deno task migrations:run
```

Git hooks (once per clone) — wires the pre-commit hook via `core.hooksPath`:

```bash
deno task hooks
```
