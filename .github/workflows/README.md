# GitHub Actions Workflows

This directory contains GitHub Actions workflows for the Shuriken CalDAV/CardDAV server.

## Workflows

### CodeQL (`codeql.yml`)

Security analysis workflow using GitHub's CodeQL scanner.

- **Triggers:**
  - Push to `main` branch
  - Pull requests to `main` branch
  - Weekly schedule (Sunday at 1:30 AM UTC)
- **Actions:**
  - Scans Rust codebase for security vulnerabilities
  - Uses CodeQL Action v4 with `none` build mode (Rust-specific requirement)
  - Uploads results to GitHub Security tab

### CI (`ci.yml`)

Continuous integration workflow for building, checking, and testing the project.

- **Triggers:**
  - Push to `main` branch
  - Pull requests to `main` branch

#### Jobs

**build-check-clippy:**
- Runs `cargo build --all-targets`
- Runs `cargo check --all-targets`
- Runs `cargo clippy --all-targets` with `-D warnings` (treats warnings as errors)
- Uses cargo caching for faster builds

**test:**
- Runs `cargo test --all-targets`
- Requires PostgreSQL 18 database
- Runs Diesel migrations before tests
- Uses cargo caching for faster builds

## Environment Requirements

### Test Job

The test job requires a PostgreSQL database with:
- Database name: `shuriken_test`
- Schema: `shuriken_test`
- Connection via `DATABASE_URL` environment variable

The workflow automatically:
1. Starts a PostgreSQL 18 container
2. Installs Diesel CLI
3. Runs migrations
4. Executes tests

## Caching

Both workflows use GitHub Actions caching to speed up builds:
- Cargo registry cache
- Cargo git dependencies cache
- Build artifacts cache (separate caches for build/test jobs)

## Notes

- The clippy job treats all warnings as errors (`-D warnings`)
- All jobs use the latest stable Rust toolchain
- Test database uses the same configuration as local development (see `docker-compose.yml`)
