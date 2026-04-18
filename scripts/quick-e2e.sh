#!/usr/bin/env bash
# Quick end-to-end test for claw-beam simple flow
# Usage: bash scripts/quick-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/bin/claw-beam.js"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "=== claw-beam quick e2e test ==="

# Step 1: Create a test file
echo "hello from quick-e2e test" > "$TMPDIR/testfile.txt"
echo "Step 1: Created test file: $TMPDIR/testfile.txt"

# Step 2: Start rendezvous server in background
STORE_DIR="$TMPDIR/store"
mkdir -p "$STORE_DIR"
node "$CLI" serve-rendezvous "$STORE_DIR" 0 > "$TMPDIR/server.log" 2>&1 &
SERVER_PID=$!
echo "Step 2: Started rendezvous server (PID $SERVER_PID)"

# Wait for server to be ready
for i in $(seq 1 20); do
  BASE_URL=$(grep -oP 'http://127\.0\.0\.1:\d+' "$TMPDIR/server.log" 2>/dev/null || true)
  if [ -n "$BASE_URL" ]; then break; fi
  sleep 0.25
done

if [ -z "$BASE_URL" ]; then
  echo "FAIL: server did not start"
  cat "$TMPDIR/server.log"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi
echo "Step 2: Server ready at $BASE_URL"

# Step 3: Send a file via HTTP rendezvous
SEND_OUTPUT=$(node "$CLI" send-http "$TMPDIR/testfile.txt" "$BASE_URL" 2>&1)
OFFER_ID=$(echo "$SEND_OUTPUT" | grep -oP 'offer published: \K[a-f0-9]{16}')
BEAM_CODE=$(echo "$SEND_OUTPUT" | grep -oP 'beam code: \K\d{1,2}-[a-z]+-[a-z]+')

if [ -z "$OFFER_ID" ] || [ -z "$BEAM_CODE" ]; then
  echo "FAIL: send-http did not produce offer_id or beam_code"
  echo "$SEND_OUTPUT"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi
echo "Step 3: Sent file — offer=$OFFER_ID code=$BEAM_CODE"

# Step 4: Accept the offer
ACCEPT_OUTPUT=$(node "$CLI" accept-http "$BASE_URL" "$OFFER_ID" "$BEAM_CODE" receiver 2>&1)
if echo "$ACCEPT_OUTPUT" | grep -q "offer_status: accepted"; then
  echo "Step 4: Accepted offer"
else
  echo "FAIL: accept-http did not succeed"
  echo "$ACCEPT_OUTPUT"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

# Step 5: Receive the file
RECV_DIR="$TMPDIR/recv"
mkdir -p "$RECV_DIR"
RECV_OUTPUT=$(cd "$RECV_DIR" && node "$CLI" receive-http "$BASE_URL" "$OFFER_ID" "$BEAM_CODE" --keep-bundle 2>&1 || true)
if [ -f "$RECV_DIR/.out/testfile.txt" ]; then
  CONTENT=$(cat "$RECV_DIR/.out/testfile.txt")
  if [ "$CONTENT" = "hello from quick-e2e test" ]; then
    echo "Step 5: Received and verified file content ✓"
  else
    echo "FAIL: file content mismatch"
    echo "Expected: hello from quick-e2e test"
    echo "Got: $CONTENT"
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
else
  echo "FAIL: received file not found"
  echo "$RECV_OUTPUT"
  ls -la "$RECV_DIR"
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

# Step 6: Test the simplified send/receive flow
echo ""
echo "=== Testing simplified send + receive flow ==="
node "$CLI" send --filepath "$TMPDIR/testfile.txt" --port 0 > "$TMPDIR/send_simple.log" 2>&1 &
SIMPLE_PID=$!

for i in $(seq 1 20); do
  TOKEN=$(grep -oP 'token: \K\S+' "$TMPDIR/send_simple.log" 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then break; fi
  sleep 0.25
done

if [ -z "$TOKEN" ]; then
  echo "FAIL: simple send did not produce token"
  cat "$TMPDIR/send_simple.log"
  kill "$SIMPLE_PID" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi
echo "Step 6: Simple send — token=$TOKEN"

RECV_DIR2="$TMPDIR/recv2"
mkdir -p "$RECV_DIR2"
RECV_SIMPLE=$(node "$CLI" receive --token "$TOKEN" --filespath "$RECV_DIR2" 2>&1)
echo "Step 6: Simple receive output:"
echo "$RECV_SIMPLE"

if [ -f "$RECV_DIR2/testfile.txt" ]; then
  CONTENT2=$(cat "$RECV_DIR2/testfile.txt")
  if [ "$CONTENT2" = "hello from quick-e2e test" ]; then
    echo "Step 6: Simple flow verified ✓"
  else
    echo "FAIL: simple flow file content mismatch"
    kill "$SIMPLE_PID" 2>/dev/null || true
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi
else
  echo "FAIL: simple flow received file not found"
  ls -la "$RECV_DIR2"
  kill "$SIMPLE_PID" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

# Cleanup
kill "$SERVER_PID" 2>/dev/null || true
kill "$SIMPLE_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
wait "$SIMPLE_PID" 2>/dev/null || true

echo ""
echo "=== All quick e2e tests passed! ==="