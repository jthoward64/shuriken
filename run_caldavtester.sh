#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Shuriken CalDAV Test Suite Runner ===${NC}"
echo

# Set DATABASE_URL for CalDAVTester
export DATABASE_URL="postgres://shuriken:shuriken@localhost:4525/shuriken_caldavtester"
export AUTH_METHOD="basic_auth"

# First, reset that database
echo -e "${YELLOW}Resetting CalDAVTester database...${NC}"
docker compose -f docker-compose.caldavtester.yml down
docker compose -f docker-compose.caldavtester.yml up -d postgres_caldavtester

# Wait for Postgres to be ready
echo -e "${YELLOW}Waiting for Postgres to be ready...${NC}"
PG_READY=0
for i in {1..30}; do
    if pg_isready -h localhost -p 4525 -U shuriken > /dev/null 2>&1; then
        PG_READY=1
        break
    fi
    sleep 1
done

if [ "$PG_READY" -ne 1 ]; then
    echo -e "${RED}ERROR: Postgres did not become ready on port 4525${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Postgres is ready${NC}"

# Migrate the database schema
echo -e "${YELLOW}Migrating CalDAVTester database schema...${NC}"
pushd crates/shuriken-db > /dev/null
diesel migration run
popd > /dev/null
echo -e "${GREEN}✓ Database schema migrated${NC}"

echo -e "${YELLOW}Generating password hash for test accounts...${NC}"
PASSWORD_HASH=$(cargo run -q -p shuriken-service --bin hash_password -- "password")
echo -e "${GREEN}✓ Password hash generated${NC}"

echo -e "${YELLOW}Seeding CalDAVTester database...${NC}"
docker compose -f docker-compose.caldavtester.yml exec -T postgres_caldavtester \
    psql -v ON_ERROR_STOP=1 -U shuriken -d shuriken_caldavtester \
    -v password_hash="$PASSWORD_HASH" -f /seed/caldavtester_seed.sql
echo -e "${GREEN}✓ Database seeded${NC}"

# Start Shuriken server (log to file)
LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILENAME="shuriken-caldavtester-$(date +%Y%m%d-%H%M%S).log"
LOG_FILE="$LOG_DIR/$LOG_FILENAME"

echo -e "${YELLOW}Starting Shuriken server (logs: $LOG_FILE)...${NC}"
touch "$LOG_FILE"
ln -sf "$LOG_FILENAME" "$LOG_DIR/shuriken-caldavtester-latest.log"
NO_COLOR=1 RUST_LOG=shuriken=trace cargo run > "$LOG_FILE" 2>&1 &
SHURIKEN_PID=$!

cleanup() {
    echo -e "${YELLOW}Stopping Shuriken server (pid: $SHURIKEN_PID)...${NC}"
    if kill -0 "$SHURIKEN_PID" 2>/dev/null; then
        kill "$SHURIKEN_PID"
        wait "$SHURIKEN_PID" 2>/dev/null || true
    fi
    echo -e "${GREEN}✓ Shuriken server stopped${NC}"
}

trap cleanup EXIT INT TERM

# Wait for Shuriken to be ready
echo -e "${YELLOW}Waiting for Shuriken to be ready on port 8698...${NC}"
READY=0
for i in {1..60}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:8698/api/dav/ > /dev/null 2>&1; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -ne 1 ]; then
    echo -e "${RED}ERROR: Shuriken server did not become ready on port 8698${NC}"
    echo "Check logs at: $LOG_FILE"
    exit 1
fi

echo -e "${GREEN}✓ Shuriken server is running${NC}"
echo

# Run the tests
echo -e "${YELLOW}Running CalDAV Test Suite...${NC}"
echo "This will test RFC compliance against Apple's CalDAVTester"
echo "--------------------------------------------------------------"
echo

# Run with docker-compose
RESULTS_FILENAME="shuriken-caldavtester-results-$(date +%Y%m%d-%H%M%S).log"
RESULTS_FILE="$LOG_DIR/$RESULTS_FILENAME"

docker compose -f docker-compose.caldavtester.yml run --rm caldavtester -- $@ | tee "$RESULTS_FILE"
ln -sf "$RESULTS_FILENAME" "$LOG_DIR/shuriken-caldavtester-results-latest.log"

TEST_RESULT=${PIPESTATUS[0]}

echo
echo "--------------------------------------------------------------"
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ CalDAV tests completed successfully${NC}"
else
    echo -e "${RED}✗ CalDAV tests failed or encountered errors${NC}"
fi

exit $TEST_RESULT
