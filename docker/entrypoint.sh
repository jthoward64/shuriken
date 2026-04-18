#!/bin/sh
set -e

echo "Running database migrations..."
bun run migrations:run

echo "Starting server..."
exec bun .
