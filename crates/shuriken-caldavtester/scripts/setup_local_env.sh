#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$CRATE_DIR/../.." && pwd)"
COMPOSE_FILE="$CRATE_DIR/docker-compose.local.yml"
SERVICE_NAME="postgres_caldavtester_local"

export DATABASE_URL="${DATABASE_URL:-postgres://shuriken:shuriken@localhost:4525/shuriken_caldavtester}"

usage() {
  cat <<'EOF'
Usage: setup_local_env.sh <command>

Commands:
  up         Start local postgres container
  down       Stop local postgres container
  reset      Recreate local postgres container (down -v + up)
  migrate    Run diesel migrations against local postgres
  seed       Seed local postgres with caldavtester fixtures
  bootstrap  reset + migrate + seed
EOF
}

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

wait_for_postgres() {
  for _ in {1..40}; do
    if compose exec -T "$SERVICE_NAME" pg_isready -U shuriken -d shuriken_caldavtester >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "Postgres did not become ready in time" >&2
  exit 1
}

run_migrations() {
  (
    cd "$REPO_ROOT/crates/shuriken-db"
    diesel migration run
  )
}

seed_database() {
  local password_hash
  password_hash="$(cd "$REPO_ROOT" && cargo run -q -p shuriken-service --bin hash_password -- password)"

  compose exec -T "$SERVICE_NAME" \
    psql -v ON_ERROR_STOP=1 -U shuriken -d shuriken_caldavtester \
    -v password_hash="$password_hash" -f /seed/caldavtester_seed.sql
}

cmd="${1:-bootstrap}"

case "$cmd" in
  up)
    compose up -d "$SERVICE_NAME"
    wait_for_postgres
    ;;
  down)
    compose down
    ;;
  reset)
    compose down -v
    compose up -d "$SERVICE_NAME"
    wait_for_postgres
    ;;
  migrate)
    run_migrations
    ;;
  seed)
    seed_database
    ;;
  bootstrap)
    compose down -v
    compose up -d "$SERVICE_NAME"
    wait_for_postgres
    run_migrations
    seed_database
    ;;
  *)
    usage
    exit 2
    ;;
esac
