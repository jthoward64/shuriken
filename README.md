# shuriken-ts

A CalDAV/CardDAV server implementation in TypeScript, running on [Deno](https://deno.com).

Full documentation (admin & user guides) is published at
[jthoward64.github.io/shuriken](https://jthoward64.github.io/shuriken/),
built from [`docs-site/`](./docs-site).

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

standout features:

- contact deduplciation and cleanup
- very slim web ui (calendar page loads less than 500kb of js/css, 1/5th that compressed)
- web ui works with javascript disabled
- strong caching for DAV and web ui
- oidc support
- embeddable
- ics feeds
- sharing (by collection or by event)
- invitations
- public share links
- web ui uses modern web features in order to reduce the amount of js/css that needs to be loaded, and to make it interactive even with javascript disabled
- all data stored in postgres, no filesystem storage or weird hacks