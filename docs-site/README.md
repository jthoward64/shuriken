# shuriken-ts docs site

The [Docusaurus](https://docusaurus.io/)-based documentation site for
shuriken-ts, deployed to GitHub Pages at
https://jthoward64.github.io/shuriken/.

This is an isolated Node/npm subproject — the rest of the repository is
Deno-only. Run all commands from this directory.

Content lives in `docs/admin/` (Administrator Guide) and `docs/user/`
(User Guide). Some code blocks are imported live from real files
elsewhere in the repo (e.g. `docker/docker-compose.example.yaml`,
`deno.json`) via [`remark-code-import`](https://github.com/kevin940726/remark-code-import)
— look for `` ```lang file=<rootDir>/... ``` `` fences before editing a
code sample by hand.

## Installation

```bash
npm install
```

## Local development

```bash
npm start
```

Starts a local dev server with live reload.

## Build

```bash
npm run build
```

Generates static content into `build/`.

## Deployment

Deployment is automated via `.github/workflows/docs.yml` — every push to
`main` that touches `docs-site/` rebuilds and publishes to GitHub Pages.
No manual deploy step is needed.
