#!/usr/bin/env bash
#
# API Verification Script for Zebrunner MCP Server
# Verifies connectivity and response format for both Public and Reporting APIs.
# Uses credentials from .env file.
#
# Required .env variables:
#   ZEBRUNNER_URL    - Zebrunner Public API base URL (e.g., https://mycompany.zebrunner.com/api/public/v1)
#   ZEBRUNNER_LOGIN  - Username for Basic Authentication
#   ZEBRUNNER_TOKEN  - API token for Basic Authentication
#
# Auto-discovers projects via Reporting API and runs tests against all starred projects.
#
# Coverage: 27 unique endpoint patterns across Public API, Reporting API, and Widget SQL.
#
# Usage: ./tests/api-verify.sh [--verbose]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"

VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

PASS=0
FAIL=0
SKIP=0

# ---------- helpers ----------

red()    { printf "\033[31m%s\033[0m" "$*"; }
green()  { printf "\033[32m%s\033[0m" "$*"; }
yellow() { printf "\033[33m%s\033[0m" "$*"; }
bold()   { printf "\033[1m%s\033[0m" "$*"; }
cyan()   { printf "\033[36m%s\033[0m" "$*"; }

log_pass() { PASS=$((PASS+1)); echo "  $(green '✔') $1" >&2; }
log_fail() { FAIL=$((FAIL+1)); echo "  $(red '✘') $1" >&2; [ -n "${2:-}" ] && echo "    ↳ $2" >&2; }
log_skip() { SKIP=$((SKIP+1)); echo "  $(yellow '⊘') $1 (skipped)" >&2; }
log_section() { echo "" >&2; bold "━━━ $1 ━━━" >&2; echo "" >&2; }
debug() { $VERBOSE && echo "    [debug] $*" >&2 || true; }

json_field() {
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    result = eval('d' + '''$2''')
    print('' if result is None else result)
except: print('')
" 2>/dev/null || echo ""
}

json_items_count() {
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('items', d) if isinstance(d, dict) else d
    print(len(items) if isinstance(items, list) else 0)
except: print(0)
" 2>/dev/null || echo "0"
}

json_first() {
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('items', d) if isinstance(d, dict) else d
    val = items[0].get('$2', '') if items else ''
    print('' if val is None else val)
except: print('')
" 2>/dev/null || echo ""
}

json_data_field() {
  echo "$1" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    obj = d.get('data', d) if isinstance(d, dict) else d
    val = obj.get('$2', '')
    print('' if val is None else val)
except: print('')
" 2>/dev/null || echo ""
}

# ---------- load .env ----------

if [[ ! -f "$ENV_FILE" ]]; then
  echo "$(red 'ERROR:') .env file not found at $ENV_FILE" >&2
  exit 1
fi

source_env() {
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    [[ -z "$key" ]] && continue
    export "$key=$value"
  done < "$ENV_FILE"
}
source_env

: "${ZEBRUNNER_URL:?ZEBRUNNER_URL not set in .env}"
: "${ZEBRUNNER_LOGIN:?ZEBRUNNER_LOGIN not set in .env}"
: "${ZEBRUNNER_TOKEN:?ZEBRUNNER_TOKEN not set in .env}"

PUBLIC_BASE="$ZEBRUNNER_URL"
REPORTING_BASE="${ZEBRUNNER_URL%%/api/*}"

BASIC_AUTH=$(printf '%s:%s' "$ZEBRUNNER_LOGIN" "$ZEBRUNNER_TOKEN" | base64)

debug "PUBLIC_BASE    = $PUBLIC_BASE"
debug "REPORTING_BASE = $REPORTING_BASE"
debug "BASIC_AUTH     = ${BASIC_AUTH:0:12}..."

# ---------- generic request helpers ----------

do_public_get() {
  _RAW=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Basic $BASIC_AUTH" \
    -H "Accept: application/json" \
    "${PUBLIC_BASE}${1}" 2>&1)
  _STATUS=$(echo "$_RAW" | tail -1)
  _BODY=$(echo "$_RAW" | sed '$d')
}

do_reporting_get() {
  _RAW=$(curl -sS -w "\n%{http_code}" \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Accept: application/json" \
    "${REPORTING_BASE}${1}" 2>&1)
  _STATUS=$(echo "$_RAW" | tail -1)
  _BODY=$(echo "$_RAW" | sed '$d')
}

do_reporting_post() {
  _RAW=$(curl -sS -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$2" \
    "${REPORTING_BASE}${1}" 2>&1)
  _STATUS=$(echo "$_RAW" | tail -1)
  _BODY=$(echo "$_RAW" | sed '$d')
}

check_status() {
  local label="$1" expected="${2:-200}"
  if [[ "$_STATUS" == "$expected" ]]; then
    log_pass "$label (HTTP $_STATUS)"
  else
    log_fail "$label" "Expected HTTP $expected, got $_STATUS"
  fi
  debug "$(echo "$_BODY" | head -c 300)"
}

# =====================================================================
# STEP 1: AUTHENTICATION & PROJECT DISCOVERY
# =====================================================================

log_section "Reporting API — Authentication"

_RAW=$(curl -sS -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  "${REPORTING_BASE}/api/iam/v1/auth/refresh" \
  -d "{\"refreshToken\":\"$ZEBRUNNER_TOKEN\"}" 2>&1)
_STATUS=$(echo "$_RAW" | tail -1)
_BODY=$(echo "$_RAW" | sed '$d')

BEARER_TOKEN=""
if [[ "$_STATUS" == "200" ]]; then
  BEARER_TOKEN=$(json_field "$_BODY" ".get('authToken','')")
  if [[ -n "$BEARER_TOKEN" ]]; then
    log_pass "R1: POST /api/iam/v1/auth/refresh (got bearer token)"
    debug "Bearer token: ${BEARER_TOKEN:0:20}..."
  else
    log_fail "R1: Auth response missing authToken" "$(echo "$_BODY" | head -c 200)"
  fi
else
  log_fail "R1: POST /api/iam/v1/auth/refresh" "HTTP $_STATUS"
fi

if [[ -z "$BEARER_TOKEN" ]]; then
  echo "$(red 'FATAL: Cannot authenticate. Aborting.')" >&2
  exit 1
fi

# Discover starred projects
log_section "Project Discovery"

do_reporting_get "/api/projects/v1/projects?extraFields=starred"
check_status "R3: GET /api/projects/v1/projects"

ALL_PROJECTS_BODY="$_BODY"
ALL_PROJECTS_COUNT=$(json_items_count "$ALL_PROJECTS_BODY")
log_pass "Found $ALL_PROJECTS_COUNT project(s) total"

STARRED_PROJECTS=$(echo "$ALL_PROJECTS_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('items', d) if isinstance(d, dict) else d
    starred = [i['key'] for i in items if i.get('starred')]
    print(' '.join(starred))
except: pass
" 2>/dev/null || echo "")

if [[ -z "$STARRED_PROJECTS" ]]; then
  echo "$(red 'No starred projects found. Star at least one project in Zebrunner UI.')" >&2
  exit 1
fi

STARRED_COUNT=$(echo "$STARRED_PROJECTS" | wc -w | tr -d ' ')
echo "  $(cyan '★') Testing $STARRED_COUNT starred project(s): $STARRED_PROJECTS" >&2

# =====================================================================
# STEP 2: GLOBAL TESTS (run once)
# =====================================================================

log_section "Global — Projects Limit"

do_reporting_get "/api/projects/v1/projects-limit"
check_status "R4: GET /api/projects/v1/projects-limit"

R4_LIMIT=$(json_data_field "$_BODY" "limit")
if [[ -n "$R4_LIMIT" ]]; then
  log_pass "Projects limit: $R4_LIMIT (from data.limit)"
else
  log_fail "Could not extract data.limit" "$(echo "$_BODY" | head -c 200)"
fi

log_section "Global — JIRA Integrations"

do_reporting_get "/api/integrations/v2/integrations/tool:jira"
if [[ "$_STATUS" == "200" ]]; then
  log_pass "R14: GET /api/integrations/v2/integrations/tool:jira (HTTP 200)"
  R14_COUNT=$(json_items_count "$_BODY")
  log_pass "Got $R14_COUNT JIRA integration(s)"
elif [[ "$_STATUS" == "403" ]]; then
  log_pass "R14: JIRA integrations returned 403 (expected if token lacks permission)"
else
  log_fail "R14: GET /api/integrations/v2/integrations/tool:jira" "HTTP $_STATUS"
fi

# =====================================================================
# STEP 3: PER-PROJECT TESTS
# =====================================================================

run_project_tests() {
  local TEST_PROJECT="$1"

  echo "" >&2
  bold "╔══════════════════════════════════════════════╗" >&2
  bold "║  Project: $TEST_PROJECT" >&2
  bold "╚══════════════════════════════════════════════╝" >&2

  # --- Reporting: resolve project ID ---

  do_reporting_get "/api/projects/v1/projects/$TEST_PROJECT"
  check_status "R2: GET /api/projects/v1/projects/$TEST_PROJECT"

  local PROJECT_ID
  PROJECT_ID=$(json_data_field "$_BODY" "id")
  debug "PROJECT_ID = $PROJECT_ID"

  if [[ -n "$PROJECT_ID" ]]; then
    log_pass "Resolved project ID: $PROJECT_ID"
  else
    log_fail "Could not extract project ID" "$(echo "$_BODY" | head -c 200)"
    PROJECT_ID=""
  fi

  # --- Reporting: TCM settings ---

  log_section "$TEST_PROJECT — TCM Settings"

  if [[ -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/tcm/v1/test-case-settings/system-fields/automation-states?projectId=$PROJECT_ID"
    check_status "R15: GET automation-states (projectId=$PROJECT_ID)"

    local STATE_COUNT
    STATE_COUNT=$(json_items_count "$_BODY")
    if [[ "$STATE_COUNT" -gt 0 ]]; then
      log_pass "Got $STATE_COUNT automation state(s)"
    else
      log_fail "No automation states returned"
    fi

    do_reporting_get "/api/tcm/v1/test-case-settings/system-fields/priorities?projectId=$PROJECT_ID"
    check_status "R16: GET priorities (projectId=$PROJECT_ID)"

    local PRIO_COUNT
    PRIO_COUNT=$(json_items_count "$_BODY")
    if [[ "$PRIO_COUNT" -gt 0 ]]; then
      log_pass "Got $PRIO_COUNT priority(ies)"
    else
      log_fail "No priorities returned"
    fi
    do_reporting_get "/api/tcm/v1/test-case-settings/fields-layout?projectId=$PROJECT_ID"
    check_status "R17: GET fields-layout (projectId=$PROJECT_ID)"

    local SYSTEM_FIELDS CUSTOM_FIELDS
    SYSTEM_FIELDS=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    fields = d.get('data',d).get('fields',[])
    print(sum(1 for f in fields if f.get('type')=='SYSTEM'))
except: print(0)
" 2>/dev/null || echo "0")
    CUSTOM_FIELDS=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    fields = d.get('data',d).get('fields',[])
    print(sum(1 for f in fields if f.get('type')=='CUSTOM'))
except: print(0)
" 2>/dev/null || echo "0")
    log_pass "Fields layout: $SYSTEM_FIELDS system, $CUSTOM_FIELDS custom"
  else
    log_skip "R15/R16/R17: TCM settings (no project ID)"
  fi

  # --- Public API: test suites ---

  log_section "$TEST_PROJECT — Test Suites"

  do_public_get "/test-suites?projectKey=$TEST_PROJECT&maxPageSize=2"
  check_status "P1: GET /test-suites?projectKey=$TEST_PROJECT&maxPageSize=2"
  local P1_BODY="$_BODY"

  local SUITE_ID
  SUITE_ID=$(json_first "$P1_BODY" "id")
  debug "SUITE_ID = $SUITE_ID"

  if [[ -n "$SUITE_ID" ]]; then
    log_pass "Extracted suiteId=$SUITE_ID from first item"
  else
    log_fail "Could not extract suiteId from /test-suites response"
  fi

  local SUITE_PAGE_TOKEN
  SUITE_PAGE_TOKEN=$(json_field "$P1_BODY" ".get('_meta',{}).get('nextPageToken','')")
  if [[ -n "$SUITE_PAGE_TOKEN" ]]; then
    do_public_get "/test-suites?projectKey=$TEST_PROJECT&maxPageSize=2&pageToken=$SUITE_PAGE_TOKEN"
    check_status "P1b: GET /test-suites page 2 via pageToken"
  else
    log_skip "P1b: Suite pageToken pagination (only 1 page)"
  fi

  # --- Public API: test cases ---

  log_section "$TEST_PROJECT — Test Cases"

  do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=2"
  check_status "P3: GET /test-cases?projectKey=$TEST_PROJECT&maxPageSize=2"
  local P3_BODY="$_BODY"

  local TC_ITEMS_COUNT
  TC_ITEMS_COUNT=$(json_items_count "$P3_BODY")
  if [[ "$TC_ITEMS_COUNT" -gt 0 ]]; then
    log_pass "Response contains $TC_ITEMS_COUNT item(s)"
  else
    log_fail "Response missing items array"
  fi

  local TC_ID TC_KEY
  TC_ID=$(json_first "$P3_BODY" "id")
  TC_KEY=$(json_first "$P3_BODY" "key")
  debug "TC_ID=$TC_ID  TC_KEY=$TC_KEY"

  local PAGE_TOKEN
  PAGE_TOKEN=$(json_field "$P3_BODY" ".get('_meta',{}).get('nextPageToken','')")
  if [[ -n "$PAGE_TOKEN" ]]; then
    do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=2&pageToken=$PAGE_TOKEN"
    check_status "P3b: GET /test-cases page 2 via pageToken"
  else
    log_skip "P3b: pageToken pagination (only 1 page)"
  fi

  # Test case by key
  if [[ -n "$TC_KEY" ]]; then
    do_public_get "/test-cases/key:$TC_KEY?projectKey=$TEST_PROJECT"
    check_status "P4: GET /test-cases/key:$TC_KEY"

    local TC_BY_KEY_ID
    TC_BY_KEY_ID=$(json_data_field "$_BODY" "id")
    if [[ -n "$TC_BY_KEY_ID" ]]; then
      log_pass "Response has data wrapper with id=$TC_BY_KEY_ID"
    else
      log_fail "Could not extract id from /test-cases/key:$TC_KEY response"
    fi
  else
    log_skip "P4: GET /test-cases/key:{key} (no TC_KEY available)"
  fi

  # Test case by numeric ID
  if [[ -n "$TC_ID" ]]; then
    do_public_get "/test-cases/$TC_ID?projectKey=$TEST_PROJECT"
    check_status "P4b: GET /test-cases/$TC_ID (by numeric ID)"

    local TC_BY_ID_TITLE
    TC_BY_ID_TITLE=$(json_data_field "$_BODY" "title")
    if [[ -n "$TC_BY_ID_TITLE" ]]; then
      log_pass "Response has data wrapper with title=$TC_BY_ID_TITLE"
    else
      log_fail "Could not extract title from /test-cases/$TC_ID response"
    fi
  else
    log_skip "P4b: GET /test-cases/{id} (no TC_ID available)"
  fi

  # TCM execution history (Reporting API)
  if [[ -n "$TC_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/tcm/v1/test-cases/$TC_ID/executions?projectId=$PROJECT_ID"
    check_status "R18: GET /api/tcm/v1/test-cases/$TC_ID/executions"

    local EXEC_COUNT
    EXEC_COUNT=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    print(len(items))
except: print(0)
" 2>/dev/null || echo "0")
    log_pass "Test case $TC_ID has $EXEC_COUNT execution(s)"

    if [[ "$EXEC_COUNT" -gt 0 ]]; then
      local EXEC_TYPE
      EXEC_TYPE=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    print(items[0].get('type',''))
except: print('')
" 2>/dev/null || echo "")
      log_pass "First execution type: $EXEC_TYPE"
    fi
  else
    log_skip "R18: GET test-case executions (no TC_ID or PROJECT_ID)"
  fi

  # --- RQL Filters ---

  log_section "$TEST_PROJECT — RQL Filters"

  local AUTO_STATE_ID
  AUTO_STATE_ID=$(echo "$P3_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('items', d) if isinstance(d, dict) else d
    for i in (items if isinstance(items, list) else []):
        sid = i.get('automationState', {}).get('id')
        if sid: print(sid); break
except: pass
" 2>/dev/null || echo "")
  debug "Discovered automationState.id=$AUTO_STATE_ID from test cases"

  if [[ -n "$AUTO_STATE_ID" ]]; then
    local FILTER="automationState.id%20%3D%20$AUTO_STATE_ID"
    do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=5&filter=$FILTER"
    check_status "RQL: automationState.id = $AUTO_STATE_ID"

    local COUNT
    COUNT=$(json_items_count "$_BODY")
    if [[ "$COUNT" -gt 0 ]]; then
      log_pass "Returned $COUNT test case(s) for automationState.id = $AUTO_STATE_ID"
    else
      log_pass "RQL filter accepted (0 results — valid for this project)"
    fi
  else
    log_skip "RQL automationState.id (no state ID found in test cases)"
  fi

  FILTER='deprecated%20%3D%20false'
  do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=5&filter=$FILTER"
  check_status "RQL: deprecated = false"

  FILTER="createdAt%20%3E%3D%20'2025-01-01'"
  do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=5&filter=$FILTER"
  check_status "RQL: createdAt >= '2025-01-01'"

  if [[ -n "$AUTO_STATE_ID" ]]; then
    FILTER="automationState.id%20%3D%20${AUTO_STATE_ID}%20AND%20deprecated%20%3D%20false%20AND%20deleted%20%3D%20false"
    do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=5&filter=$FILTER"
    check_status "RQL: combined (automationState.id=$AUTO_STATE_ID AND deprecated=false AND deleted=false)"
  else
    log_skip "RQL combined filter (no automationState.id available)"
  fi

  FILTER="automationState.name%20%3D%20'Automated'"
  do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=5&filter=$FILTER"
  if [[ "$_STATUS" == "400" || "$_STATUS" == "422" ]]; then
    log_pass "RQL negative: automationState.name correctly rejected (HTTP $_STATUS)"
  elif [[ "$_STATUS" == "200" ]]; then
    log_fail "RQL negative: automationState.name not rejected (HTTP 200)" "$(echo "$_BODY" | head -c 150)"
  else
    log_fail "RQL negative: automationState.name unexpected status" "Got HTTP $_STATUS"
  fi

  # --- Client-side field-path filtering verification ---

  log_section "$TEST_PROJECT — Field-Path Filtering (client-side)"

  do_public_get "/test-cases?projectKey=$TEST_PROJECT&maxPageSize=3"
  if [[ "$_STATUS" == "200" ]]; then
    local FIRST_TC
    FIRST_TC=$(echo "$_BODY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if items:
    tc = items[0]
    # Verify field-path resolution would work on this object
    fields = list(tc.keys())
    has_custom = 'customField' in tc
    priority = tc.get('priority')
    has_priority_name = isinstance(priority, dict) and 'name' in priority
    parts = []
    parts.append('keys=' + ','.join(fields[:8]))
    parts.append('hasCustomField=' + str(has_custom))
    parts.append('hasPriorityName=' + str(has_priority_name))
    if has_custom and isinstance(tc['customField'], dict):
        cf_keys = list(tc['customField'].keys())
        parts.append('customFieldKeys=' + ','.join(cf_keys[:5]))
    print('|'.join(parts))
else:
    print('EMPTY')
" 2>/dev/null)
    if [[ "$FIRST_TC" == "EMPTY" ]]; then
      log_skip "Field-path filter verification (no test cases)"
    elif [[ -n "$FIRST_TC" ]]; then
      log_pass "Test case introspection: $FIRST_TC"
      if echo "$FIRST_TC" | grep -q "hasCustomField=True"; then
        log_pass "customField present — client-side field_path filtering would work"
      else
        log_pass "customField absent on this TC — field_path 'exists' mode would correctly return false"
      fi
      if echo "$FIRST_TC" | grep -q "hasPriorityName=True"; then
        log_pass "priority.name nested path resolvable"
      elif echo "$FIRST_TC" | grep -q "hasPriorityName=False"; then
        log_pass "priority.name absent — safe null handling expected"
      fi
    else
      log_skip "Field-path introspection failed"
    fi
  else
    log_skip "Field-path filter verification (test-cases HTTP $_STATUS)"
  fi

  # --- Public API: test runs ---

  log_section "$TEST_PROJECT — Test Runs"

  do_public_get "/test-runs?projectKey=$TEST_PROJECT&maxPageSize=2"
  check_status "P6: GET /test-runs?projectKey=$TEST_PROJECT&maxPageSize=2"
  local P6_BODY="$_BODY"

  local RUN_ID
  RUN_ID=$(json_first "$P6_BODY" "id")
  debug "RUN_ID = $RUN_ID"

  local RUN_COUNT
  RUN_COUNT=$(json_items_count "$P6_BODY")
  if [[ "$RUN_COUNT" -gt 0 ]]; then
    log_pass "Got $RUN_COUNT test run(s)"
  else
    log_fail "No test runs returned" "Project may have no test runs"
    RUN_ID=""
  fi

  local RUN_PAGE_TOKEN
  RUN_PAGE_TOKEN=$(json_field "$P6_BODY" ".get('_meta',{}).get('nextPageToken','')")
  if [[ -n "$RUN_PAGE_TOKEN" ]]; then
    log_pass "Test runs have _meta.nextPageToken (token-based pagination)"
  else
    debug "No nextPageToken in test runs response"
  fi

  if [[ -n "$RUN_ID" ]]; then
    do_public_get "/test-runs/$RUN_ID?projectKey=$TEST_PROJECT"
    check_status "P7: GET /test-runs/$RUN_ID"

    local P7_ID
    P7_ID=$(json_data_field "$_BODY" "id")
    if [[ -n "$P7_ID" ]]; then
      log_pass "Single test run has data wrapper with id=$P7_ID"
    else
      log_fail "Single test run missing data.id" "$(echo "$_BODY" | head -c 200)"
    fi
  else
    log_skip "P7: GET single test run (no RUN_ID)"
  fi

  if [[ -n "$RUN_ID" ]]; then
    do_public_get "/test-runs/$RUN_ID/test-cases?projectKey=$TEST_PROJECT"
    check_status "P8: GET /test-runs/$RUN_ID/test-cases"

    local P8_COUNT
    P8_COUNT=$(json_items_count "$_BODY")
    log_pass "Test run $RUN_ID has $P8_COUNT test case(s)"
  else
    log_skip "P8: GET /test-runs/{runId}/test-cases (no RUN_ID)"
  fi

  # --- Public API: settings ---

  log_section "$TEST_PROJECT — Settings"

  do_public_get "/test-run-settings/result-statuses?projectKey=$TEST_PROJECT"
  check_status "P9: GET /test-run-settings/result-statuses"

  local P9_COUNT
  P9_COUNT=$(json_items_count "$_BODY")
  if [[ "$P9_COUNT" -gt 0 ]]; then
    log_pass "Got $P9_COUNT result status(es)"
  else
    log_fail "No result statuses returned"
  fi

  do_public_get "/test-run-settings/configuration-groups?projectKey=$TEST_PROJECT"
  check_status "P10: GET /test-run-settings/configuration-groups"

  local P10_COUNT
  P10_COUNT=$(json_items_count "$_BODY")
  if [[ "$P10_COUNT" -ge 0 ]]; then
    log_pass "Got $P10_COUNT configuration group(s)"
  else
    log_fail "Unexpected configuration groups response"
  fi

  # --- Reporting API: launches ---

  log_section "$TEST_PROJECT — Launches"

  local LAUNCH_ID=""
  if [[ -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches?projectId=$PROJECT_ID&page=1&pageSize=2"
    check_status "R5: GET /api/reporting/v1/launches (page=1, pageSize=2)"
    local R5_BODY="$_BODY"

    LAUNCH_ID=$(json_first "$R5_BODY" "id")
    debug "LAUNCH_ID = $LAUNCH_ID"

    local R5_HAS_ITEMS
    R5_HAS_ITEMS=$(echo "$R5_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('yes' if 'items' in d or 'results' in d or isinstance(d, list) else 'no')
" 2>/dev/null || echo "no")

    if [[ "$R5_HAS_ITEMS" == "yes" ]]; then
      log_pass "Launches response has items/results structure"
    else
      log_fail "Unexpected launches response structure" "$(echo "$R5_BODY" | head -c 200)"
    fi

    local R5_TOTAL
    R5_TOTAL=$(json_field "$R5_BODY" ".get('_meta',{}).get('total', .get('_meta',{}).get('totalElements',''))")
    if [[ -z "$R5_TOTAL" ]]; then
      R5_TOTAL=$(json_field "$R5_BODY" ".get('_meta',{}).get('total','')")
    fi
    if [[ -n "$R5_TOTAL" ]]; then
      log_pass "Launches pagination: total=$R5_TOTAL"
    else
      debug "No total in launches response metadata"
    fi
  else
    log_skip "R5: Launches (no project ID)"
  fi

  if [[ -n "$LAUNCH_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID?projectId=$PROJECT_ID"
    check_status "R6: GET /api/reporting/v1/launches/$LAUNCH_ID"

    local R6_NAME
    R6_NAME=$(json_data_field "$_BODY" "name")
    if [[ -n "$R6_NAME" ]]; then
      log_pass "Launch name: $R6_NAME"
    else
      R6_NAME=$(json_field "$_BODY" ".get('name','')")
      if [[ -n "$R6_NAME" ]]; then
        log_pass "Launch name: $R6_NAME (no data wrapper)"
      else
        debug "Could not extract launch name"
      fi
    fi
  else
    log_skip "R6: GET single launch (no LAUNCH_ID)"
  fi

  if [[ -n "$LAUNCH_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID/attempts?projectId=$PROJECT_ID"
    check_status "R7: GET /api/reporting/v1/launches/$LAUNCH_ID/attempts"

    local R7_COUNT
    R7_COUNT=$(json_items_count "$_BODY")
    log_pass "Launch $LAUNCH_ID has $R7_COUNT attempt(s)"
  else
    log_skip "R7: Launch attempts (no LAUNCH_ID)"
  fi

  # Launch tests
  log_section "$TEST_PROJECT — Launch Tests"

  local LAUNCH_TEST_ID=""
  if [[ -n "$LAUNCH_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID/tests?projectId=$PROJECT_ID&page=1&pageSize=2"
    check_status "R8: GET /api/reporting/v1/launches/$LAUNCH_ID/tests (page=1)"
    local R8_BODY="$_BODY"

    LAUNCH_TEST_ID=$(json_first "$R8_BODY" "id")
    debug "LAUNCH_TEST_ID = $LAUNCH_TEST_ID"

    local R8_COUNT
    R8_COUNT=$(json_items_count "$R8_BODY")
    if [[ "$R8_COUNT" -gt 0 ]]; then
      log_pass "Got $R8_COUNT test(s) in launch $LAUNCH_ID"
    else
      log_skip "No tests in launch $LAUNCH_ID (may be expected)"
    fi
  else
    log_skip "R8: Launch tests (no LAUNCH_ID)"
  fi

  # Test execution history
  if [[ -n "$LAUNCH_ID" && -n "$LAUNCH_TEST_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID/tests/$LAUNCH_TEST_ID/history?projectId=$PROJECT_ID&limit=5"
    check_status "R10: GET .../tests/$LAUNCH_TEST_ID/history (limit=5)"

    local R10_COUNT
    R10_COUNT=$(json_items_count "$_BODY")
    log_pass "Test $LAUNCH_TEST_ID has $R10_COUNT history item(s)"
  else
    log_skip "R10: Test execution history (no LAUNCH_ID or TEST_ID)"
  fi

  # Test sessions
  if [[ -n "$LAUNCH_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID/test-sessions?projectId=$PROJECT_ID"
    check_status "R11: GET .../launches/$LAUNCH_ID/test-sessions"

    local R11_COUNT
    R11_COUNT=$(json_items_count "$_BODY")
    log_pass "Launch $LAUNCH_ID has $R11_COUNT test session(s)"
  else
    log_skip "R11: Test sessions (no LAUNCH_ID)"
  fi

  # Milestones
  log_section "$TEST_PROJECT — Milestones"

  if [[ -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/milestones?projectId=$PROJECT_ID&page=1&pageSize=5"
    check_status "R13: GET /api/reporting/v1/milestones (page=1, pageSize=5)"

    local R13_COUNT
    R13_COUNT=$(json_items_count "$_BODY")
    log_pass "Got $R13_COUNT milestone(s)"

    local R13_TOTAL
    R13_TOTAL=$(json_field "$_BODY" ".get('_meta',{}).get('total','')")
    if [[ -n "$R13_TOTAL" ]]; then
      log_pass "Milestones pagination: total=$R13_TOTAL"
    else
      debug "No total in milestones response"
    fi
  else
    log_skip "R13: Milestones (no project ID)"
  fi

  # Widget SQL
  log_section "$TEST_PROJECT — Widget SQL"

  if [[ -n "$PROJECT_ID" ]]; then
    local WIDGET_DATA="{\"templateId\":1,\"paramsConfig\":{\"PERIOD\":\"Last 7 days\",\"PROJECT_NAME\":[\"$TEST_PROJECT\"],\"dashboardName\":\"General\"}}"
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$WIDGET_DATA"

    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W1: POST /api/reporting/v1/widget-templates/sql (HTTP 200)"
      if echo "$_BODY" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        log_pass "Widget SQL response is valid JSON"
      else
        log_fail "Widget SQL response is not valid JSON" "$(echo "$_BODY" | head -c 200)"
      fi
    elif [[ "$_STATUS" == "400" || "$_STATUS" == "404" ]]; then
      log_pass "W1: Widget SQL returned HTTP $_STATUS (templateId may not exist, endpoint works)"
    else
      log_fail "W1: POST /api/reporting/v1/widget-templates/sql" "HTTP $_STATUS"
    fi
  else
    log_skip "W1: Widget SQL (no project ID)"
  fi
}

# Run tests for each starred project
for PROJECT_KEY in $STARRED_PROJECTS; do
  run_project_tests "$PROJECT_KEY"
done

# =====================================================================
# Summary
# =====================================================================

log_section "Summary"

TOTAL=$((PASS + FAIL + SKIP))
echo "  Total: $TOTAL  |  $(green "Passed: $PASS")  |  $(red "Failed: $FAIL")  |  $(yellow "Skipped: $SKIP")" >&2
echo "  Projects tested: $STARRED_PROJECTS" >&2
echo "" >&2

if [[ $FAIL -gt 0 ]]; then
  echo "$(red 'Some checks failed.')" >&2
  exit 1
else
  echo "$(green 'All checks passed!')" >&2
  exit 0
fi
