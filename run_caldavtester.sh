#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Shuriken CalDAV Test Suite Runner ===${NC}"
echo

# Start Shuriken server (log to file)
LOG_DIR="./logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/shuriken-caldavtester-$(date +%Y%m%d-%H%M%S).log"

echo -e "${YELLOW}Starting Shuriken server (logs: $LOG_FILE)...${NC}"
cargo run > "$LOG_FILE" 2>&1 &
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
docker compose -f docker-compose.caldavtester.yml run --rm caldavtester -- $@

TEST_RESULT=$?

echo
echo "--------------------------------------------------------------"
if [ $TEST_RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ CalDAV tests completed successfully${NC}"
else
    echo -e "${RED}✗ CalDAV tests failed or encountered errors${NC}"
fi

exit $TEST_RESULT
