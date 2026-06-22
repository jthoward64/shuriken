#!/bin/sh
set -e

echo "Running database migrations..."
deno task migrations:run

echo "Starting server..."
exec deno task start
