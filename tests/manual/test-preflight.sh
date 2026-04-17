#!/bin/bash
# Pre-flight checks for HTTP mode testing.
# Usage: ./tests/manual/test-preflight.sh [port]

PORT=${1:-3000}
BASE="http://localhost:$PORT"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local url="$2"
  local expect_status="$3"
  local expect_body="$4"

  resp=$(curl -s -o /tmp/mcp-check-body -w "%{http_code}" "$url" 2>/dev/null)
  body=$(cat /tmp/mcp-check-body 2>/dev/null)

  if [ "$resp" = "$expect_status" ]; then
    if [ -n "$expect_body" ] && ! echo "$body" | grep -q "$expect_body"; then
      echo "  FAIL  $desc — status $resp OK but body missing '$expect_body'"
      FAIL=$((FAIL+1))
      return
    fi
    echo "  PASS  $desc (HTTP $resp)"
    PASS=$((PASS+1))
  else
    echo "  FAIL  $desc — expected $expect_status, got $resp"
    FAIL=$((FAIL+1))
  fi
}

echo ""
echo "=== MCP Server Pre-flight Checks ($BASE) ==="
echo ""

echo "--- Health ---"
check "GET /health returns 200" "$BASE/health" "200" '"status":"ok"'

echo ""
echo "--- Auth Mode ---"
health_body=$(curl -s "$BASE/health" 2>/dev/null)
auth_mode=$(echo "$health_body" | grep -o '"authMode":"[^"]*"' | head -1)
echo "  INFO  $auth_mode"
oauth_enabled=$(echo "$health_body" | grep -o '"oauthEnabled":[a-z]*' | head -1)
echo "  INFO  $oauth_enabled"

echo ""
echo "--- OAuth Discovery ---"
check "GET /.well-known/oauth-authorization-server" "$BASE/.well-known/oauth-authorization-server" "200" "authorization_endpoint"
check "GET /.well-known/oauth-protected-resource" "$BASE/.well-known/oauth-protected-resource" "200" "resource"

echo ""
echo "--- MCP Endpoint ---"
check "POST /mcp without auth → 401" "$BASE/mcp" "401" "Authentication required"

echo ""
echo "--- Login Form ---"
login_resp=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/login?state=test-state" 2>/dev/null)
if [ "$login_resp" = "200" ]; then
  echo "  PASS  GET /login?state=... returns 200 (credential form)"
  PASS=$((PASS+1))
elif [ "$login_resp" = "404" ]; then
  echo "  SKIP  /login not mounted (headers-only mode?)"
else
  echo "  WARN  GET /login returned $login_resp"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && echo "All pre-flight checks passed." || echo "Some checks failed."
exit $FAIL
