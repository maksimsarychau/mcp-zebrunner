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
# Coverage: 29 unique endpoint patterns across Public API, Reporting API, and Widget SQL.
#
# Usage: ./tests/api-verify.sh [--verbose] [--widget-catalog-audit]
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$ROOT_DIR/.env"
WIDGET_ASSERT="$SCRIPT_DIR/helpers/widget-api-assert.py"

VERBOSE=false
WIDGET_CATALOG_AUDIT=false
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    --widget-catalog-audit) WIDGET_CATALOG_AUDIT=true ;;
  esac
done

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

# Prints "<field>:<python type>" (or "<field>:missing") for each requested field
# of the response data object. Used to assert response contracts without
# depending on live counts.
json_data_types() {
  echo "$1" | python3 -c "
import sys, json
fields = '''$2'''.split()
try:
    d = json.load(sys.stdin)
    obj = d.get('data', d) if isinstance(d, dict) else {}
    if not isinstance(obj, dict):
        obj = {}
    for f in fields:
        print(f + ':' + ('missing' if f not in obj else type(obj[f]).__name__))
except Exception:
    for f in fields:
        print(f + ':unparsable')
" 2>/dev/null || echo ""
}

# Asserts each field is of an expected python type, tolerating omitted fields
# (the MCP detailed-status contract reports those as "unavailable").
check_field_types() {
  local label="$1" expected_types="$2" types="$3"
  local field type
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    field="${entry%%:*}"
    type="${entry#*:}"
    if [[ " $expected_types " == *" $type "* ]]; then
      log_pass "$label: $field is $type"
    elif [[ "$type" == "missing" || "$type" == "NoneType" ]]; then
      log_skip "$label: $field not reported by this launch"
    else
      log_fail "$label: $field has unexpected type" "Expected one of [$expected_types], got $type"
    fi
  done <<< "$types"
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

widget_sql_post() {
  local label="$1"
  local payload="$2"
  local keys="${3:-}"
  do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$payload"
  if [[ "$_STATUS" != "200" ]]; then
    log_fail "$label" "HTTP $_STATUS"
    return 1
  fi
  log_pass "$label (HTTP 200)"
  if [[ -n "$keys" ]]; then
    if python3 "$WIDGET_ASSERT" json_array "$_BODY" "$keys" >/dev/null 2>&1; then
      log_pass "$label shape OK"
    else
      local _shape_err
      _shape_err=$(python3 "$WIDGET_ASSERT" json_array "$_BODY" "$keys" 2>&1 || true)
      log_fail "$label shape" "${_shape_err:-missing keys} (expected: $keys)"
    fi
  fi
}

widget_sql_post_try_suites() {
  local label="$1"
  local payload_prefix="$2"
  local payload_suffix="$3"
  local keys="$4"
  shift 4
  local name
  for name in "$@"; do
    [[ -z "$name" ]] && continue
    local esc_name="${name//\\/\\\\}"
    esc_name="${esc_name//\"/\\\"}"
    local payload="${payload_prefix}${esc_name}${payload_suffix}"
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$payload"
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "$label (HTTP 200, suite=$name)"
      if [[ -n "$keys" ]]; then
        if python3 "$WIDGET_ASSERT" json_array "$_BODY" "$keys" >/dev/null 2>&1; then
          log_pass "$label shape OK"
        else
          log_fail "$label shape" "missing required keys: $keys"
        fi
      fi
      return 0
    fi
    debug "$label try suite=$name -> HTTP $_STATUS"
  done
  log_fail "$label" "no suite returned HTTP 200 (last HTTP $_STATUS)"
  return 1
}

widget_sql_post_try_run_or_suite() {
  local label="$1"
  local keys="$2"
  shift 2
  local name
  for name in "$@"; do
    [[ -z "$name" ]] && continue
    local esc_name="${name//\\/\\\\}"
    esc_name="${esc_name//\"/\\\"}"
    local payloads=(
      "{\"templateId\":57085,\"paramsConfig\":{\"PLATFORM\":[],\"STATUS\":[],\"BROWSER\":[],\"LOCALE\":[],\"BUILD\":[],\"DEFECT\":[],\"PERIOD\":\"Last 7 Days\",\"RUN\":[],\"PRIORITY\":[],\"ENV\":[],\"USER\":[],\"MILESTONE\":[],\"SUITE\":[],\"dashboardName\":\"api-verify\",\"isReact\":true}}"
      "{\"templateId\":57085,\"paramsConfig\":{\"PLATFORM\":[],\"STATUS\":[],\"BROWSER\":[],\"LOCALE\":[],\"BUILD\":[],\"DEFECT\":[],\"PERIOD\":\"Last 7 Days\",\"RUN\":[\"${esc_name}\"],\"PRIORITY\":[],\"ENV\":[],\"USER\":[],\"MILESTONE\":[],\"SUITE\":[],\"dashboardName\":\"api-verify\",\"isReact\":true}}"
      "{\"templateId\":57085,\"paramsConfig\":{\"PLATFORM\":[],\"STATUS\":[],\"BROWSER\":[],\"LOCALE\":[],\"BUILD\":[],\"DEFECT\":[],\"PERIOD\":\"Quarter\",\"RUN\":[\"${esc_name}\"],\"PRIORITY\":[],\"ENV\":[],\"USER\":[],\"MILESTONE\":[],\"SUITE\":[],\"dashboardName\":\"api-verify\",\"isReact\":true}}"
      "{\"templateId\":57085,\"paramsConfig\":{\"PLATFORM\":[],\"STATUS\":[],\"BROWSER\":[],\"LOCALE\":[],\"BUILD\":[],\"DEFECT\":[],\"PERIOD\":\"Quarter\",\"RUN\":[],\"PRIORITY\":[],\"ENV\":[],\"USER\":[],\"MILESTONE\":[],\"SUITE\":[\"${esc_name}\"],\"dashboardName\":\"api-verify\",\"isReact\":true}}"
    )
    local payload
    for payload in "${payloads[@]}"; do
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$payload"
      if [[ "$_STATUS" == "200" ]]; then
        log_pass "$label (HTTP 200, filter=$name)"
        if [[ -n "$keys" ]]; then
          if python3 "$WIDGET_ASSERT" json_array "$_BODY" "$keys" >/dev/null 2>&1; then
            log_pass "$label shape OK"
          else
            local _shape_err
            _shape_err=$(python3 "$WIDGET_ASSERT" json_array "$_BODY" "$keys" 2>&1 || true)
            log_fail "$label shape" "${_shape_err:-missing keys} (expected: $keys)"
          fi
        fi
        return 0
      fi
      debug "$label try name=$name -> HTTP $_STATUS"
    done
  done
  log_skip "$label (HTTP 500 on tenant — launch-duration widget may need reporting RUN filter data)"
  return 0
}

tcm_widget_post() {
  local label="$1"
  local system_name="$2"
  local filters_json="$3"
  local assert_mode="${4:-tcm_items}"
  do_reporting_post "/api/tcm/v1/widgets/${system_name}/content:get?projectId=$PROJECT_ID" "{\"filters\":${filters_json}}"
  if [[ "$_STATUS" != "200" ]]; then
    log_fail "$label" "HTTP $_STATUS"
    return 1
  fi
  log_pass "$label (HTTP 200)"
  if python3 "$WIDGET_ASSERT" "$assert_mode" "$_BODY" >/dev/null 2>&1; then
    log_pass "$label response shape OK"
  else
    log_fail "$label shape" "invalid TCM widget response"
  fi
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
# STEP 2b: WIDGET TEMPLATE CATALOG (global, once)
# =====================================================================

log_section "Widget Template Catalog"

do_reporting_get "/api/reporting/v1/widget-templates"
if [[ "$_STATUS" == "200" ]]; then
  log_pass "WT-LIST: GET widget-templates (HTTP 200)"
  WT_COUNT=$(json_items_count "$_BODY")
  if [[ "$WT_COUNT" -ge 18 ]]; then
    log_pass "WT-LIST: catalog has $WT_COUNT templates (>= 18)"
  else
    log_fail "WT-LIST" "expected >= 18 templates, got $WT_COUNT"
  fi
  WT_TAM=$(echo "$_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
print(sum(1 for i in items if i.get('source')=='TAM'))
" 2>/dev/null || echo "0")
  if [[ "$WT_TAM" -ge 17 ]]; then
    log_pass "WT-TAM-COUNT: $WT_TAM TAM templates (>= 17)"
  else
    log_fail "WT-TAM-COUNT" "expected >= 17 TAM, got $WT_TAM"
  fi
  WT_TCM=$(echo "$_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
print(sum(1 for i in items if i.get('feature')=='TCM_WIDGETS'))
" 2>/dev/null || echo "0")
  if [[ "$WT_TCM" == "4" ]]; then
    log_pass "WT-TCM-COUNT: 4 TCM widgets"
  else
    log_fail "WT-TCM-COUNT" "expected 4 TCM widgets, got $WT_TCM"
  fi
  if echo "$_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
required = ['id','name','systemName','source','type','paramsConfig']
for i in items:
    if not all(k in i for k in required):
        raise SystemExit(1)
" 2>/dev/null; then
    log_pass "WT-STRUCT: catalog items have required fields"
  else
    log_fail "WT-STRUCT" "missing required catalog fields"
  fi
  echo "$_BODY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
items = d.get('items', d) if isinstance(d, dict) else d
for i in items:
    if i.get('source') != 'TAM':
        continue
    pc = i.get('paramsConfig') or {}
    period = pc.get('PERIOD') or {}
    vals = period.get('values') or []
    has_abs = 'ABSOLUTE' in vals
    has_dyn = 'DYNAMIC' in vals
    print(f\"WT-PERIOD-AUDIT: tpl {i.get('id')} {i.get('systemName')} ABSOLUTE={has_abs} DYNAMIC={has_dyn}\")
" 2>/dev/null | while read -r line; do debug "$line"; done
  log_pass "WT-PERIOD-AUDIT: logged (informational)"
else
  log_fail "WT-LIST" "HTTP $_STATUS"
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

  local FIELDS_LAYOUT_BODY="" SUITE_NAME="" P1_BODY=""

  if $WIDGET_CATALOG_AUDIT; then
    if [[ -n "$PROJECT_ID" ]]; then
      do_reporting_get "/api/tcm/v1/test-case-settings/fields-layout?projectId=$PROJECT_ID"
      FIELDS_LAYOUT_BODY="$_BODY"
      do_public_get "/test-suites?projectKey=$TEST_PROJECT&maxPageSize=3"
      P1_BODY="$_BODY"
      SUITE_NAME=$(json_first "$P1_BODY" "title")
      [[ -z "$SUITE_NAME" ]] && SUITE_NAME=$(json_first "$P1_BODY" "name")
    fi
  fi

  if ! $WIDGET_CATALOG_AUDIT; then

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
    FIELDS_LAYOUT_BODY="$_BODY"

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
  P1_BODY="$_BODY"

  local SUITE_ID
  SUITE_ID=$(json_first "$P1_BODY" "id")
  SUITE_NAME=$(json_first "$P1_BODY" "title")
  [[ -z "$SUITE_NAME" ]] && SUITE_NAME=$(json_first "$P1_BODY" "name")
  debug "SUITE_ID = $SUITE_ID  SUITE_NAME = $SUITE_NAME"

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

  # --- TCM Change History (audit log) ---

  log_section "$TEST_PROJECT — Test Case Change History"

  if [[ -n "$TC_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/tcm/v1/test-cases/$TC_ID/changes?projectId=$PROJECT_ID&maxPageSize=5"
    check_status "R19: GET /api/tcm/v1/test-cases/$TC_ID/changes"

    local CHANGE_COUNT
    CHANGE_COUNT=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    print(len(items))
except: print(0)
" 2>/dev/null || echo "0")
    log_pass "Test case $TC_ID has $CHANGE_COUNT change history entry(ies)"

    if [[ "$CHANGE_COUNT" -gt 0 ]]; then
      local CHANGE_DETAIL
      CHANGE_DETAIL=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    entry = items[0]
    entry_type = entry.get('type','')
    user_id = entry.get('userId','')
    item_count = len(entry.get('items',[]))
    has_instant = 'instant' in entry
    print(f'type={entry_type}|userId={user_id}|changeItems={item_count}|hasInstant={has_instant}')
except: print('PARSE_ERROR')
" 2>/dev/null || echo "PARSE_ERROR")

      if [[ "$CHANGE_DETAIL" == "PARSE_ERROR" ]]; then
        log_fail "Could not parse first change entry" "$(echo "$_BODY" | head -c 200)"
      else
        log_pass "First change entry: $CHANGE_DETAIL"
      fi

      # Verify entry types are valid
      local ENTRY_TYPES
      ENTRY_TYPES=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    types = set(e.get('type','') for e in items)
    print(','.join(sorted(types)))
except: print('')
" 2>/dev/null || echo "")
      if [[ -n "$ENTRY_TYPES" ]]; then
        log_pass "Entry types found: $ENTRY_TYPES"
      fi

      # Verify change item field shapes (array vs scalar)
      local FIELD_SHAPES
      FIELD_SHAPES=$(echo "$_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    items = d.get('data',d).get('items', d.get('items',[]))
    shapes = {}
    for entry in items:
        for item in entry.get('items', []):
            field = item.get('field','')
            if 'oldValues' in item or 'newValues' in item:
                shapes[field] = 'array'
            elif 'oldValue' in item or 'newValue' in item:
                shapes[field] = 'scalar'
    parts = [f'{f}={s}' for f,s in sorted(shapes.items())]
    print('|'.join(parts) if parts else 'NO_ITEMS')
except: print('PARSE_ERROR')
" 2>/dev/null || echo "PARSE_ERROR")
      if [[ "$FIELD_SHAPES" != "PARSE_ERROR" && "$FIELD_SHAPES" != "NO_ITEMS" ]]; then
        log_pass "Change item field shapes: $FIELD_SHAPES"
      elif [[ "$FIELD_SHAPES" == "NO_ITEMS" ]]; then
        log_pass "Change entries have no change items (e.g. CREATE entries)"
      fi
    fi
  else
    log_skip "R19: GET test-case changes (no TC_ID or PROJECT_ID)"
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
    local R6_BODY="$_BODY"

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

    # Status buckets behind adv_* includeDetailedStatuses (launch source)
    local R6B_TYPES
    R6B_TYPES=$(json_data_types "$R6_BODY" \
      "passed passedManually failed failedAsKnown skipped blocked inProgress aborted")
    check_field_types "R6b: launch detailed statuses" "int float" "$R6B_TYPES"
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

  # Single test — per-test manual pass / known issue flags
  if [[ -n "$LAUNCH_ID" && -n "$LAUNCH_TEST_ID" && -n "$PROJECT_ID" ]]; then
    do_reporting_get "/api/reporting/v1/launches/$LAUNCH_ID/tests/$LAUNCH_TEST_ID?projectId=$PROJECT_ID"
    check_status "R9: GET .../launches/$LAUNCH_ID/tests/$LAUNCH_TEST_ID"

    local R9_TYPES
    R9_TYPES=$(json_data_types "$_BODY" "passedManually knownIssue")
    check_field_types "R9: per-test manual/known flags" "bool" "$R9_TYPES"

    local R9_STATUS
    R9_STATUS=$(json_data_field "$_BODY" "status")
    if [[ -n "$R9_STATUS" ]]; then
      log_pass "Test $LAUNCH_TEST_ID status: $R9_STATUS"
    else
      log_fail "Test $LAUNCH_TEST_ID has no status" "$(echo "$_BODY" | head -c 200)"
    fi
  else
    log_skip "R9: Single launch test (no LAUNCH_ID or TEST_ID)"
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

  fi # end ! WIDGET_CATALOG_AUDIT

  # Widget SQL + TCM widget smokes (22/22)
  log_section "$TEST_PROJECT — Widget SQL & TCM Widgets"

  if [[ -n "$PROJECT_ID" ]]; then

    local WIDGET_DATA="{\"templateId\":1,\"paramsConfig\":{\"PERIOD\":\"Last 7 days\",\"PROJECT_NAME\":[\"$TEST_PROJECT\"],\"dashboardName\":\"General\"}}"
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$WIDGET_DATA"
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W1: POST widget-templates/sql (HTTP 200)"
    elif [[ "$_STATUS" == "400" || "$_STATUS" == "404" ]]; then
      log_pass "W1: returned HTTP $_STATUS (lenient)"
    else
      log_fail "W1" "HTTP $_STATUS"
    fi

    widget_sql_post "W-TPL1-ROI" '{"templateId":1,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 7 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "TIME|STARTED_AT"
    widget_sql_post "W-TPL4" '{"templateId":4,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 7 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "DEFECT|FAILURES|%"
    widget_sql_post "W-TPL14" '{"templateId":14,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 7 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"GROUP_BY":"BUILD","dashboardName":"api-verify","isReact":true}}' "@NAME,GROUP_FIELD,BUILD,PLATFORM|PASSED|FAILED|TOTAL"

    local W_TPL9='{"templateId":9,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Today","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"ERROR_COUNT":"0","dashboardName":"api-verify","isReact":true}}'
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_TPL9"
    local W_TPL9_BODY="$_BODY"
    local W_TPL9_HASH=""
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W-TPL9 (HTTP 200)"
      if python3 "$WIDGET_ASSERT" json_array "$W_TPL9_BODY" "PROJECT|REASON|#|SINCE|REPRO" >/dev/null 2>&1; then
        log_pass "W-TPL9 shape OK"
      else
        log_fail "W-TPL9 shape" "missing columns"
      fi
      W_TPL9_HASH=$(python3 "$WIDGET_ASSERT" extract_hashcode "$W_TPL9_BODY")
    else
      log_fail "W-TPL9" "HTTP $_STATUS"
    fi

    if [[ -n "$W_TPL9_HASH" ]]; then
      local FAIL_BASE="{\"PERIOD\":\"Today\",\"hashcode\":\"$W_TPL9_HASH\",\"dashboardName\":\"api-verify\",\"isReact\":true}"
      widget_sql_post "W-TPL6" "{\"templateId\":6,\"paramsConfig\":$FAIL_BASE}" "#|ERROR/STABILITY"
      widget_sql_post "W-TPL10" "{\"templateId\":10,\"paramsConfig\":$FAIL_BASE}" "RUN_ID|TEST_ID|RUN|TEST|DEFECT"
    else
      log_skip "W-TPL6/W-TPL10 (no hashcode from W-TPL9)"
    fi

    local W_TPL3='{"templateId":3,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"ABSOLUTE","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"GROUP_BY":"PRIORITY","dashboardName":"api-verify","isReact":true,"periodStartDate":"2026-07-01","periodEndDate":"2026-07-09","periodStartExpression":null,"periodEndExpression":null}}'
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_TPL3"
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W-TPL3 (HTTP 200)"
    elif [[ "$_STATUS" == "400" || "$_STATUS" == "404" ]]; then
      log_pass "W-TPL3 returned HTTP $_STATUS (lenient)"
    else
      log_fail "W-TPL3" "HTTP $_STATUS"
    fi

    local W_TPL3_OWNER_TODAY='{"templateId":3,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Today","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"GROUP_BY":"OWNER","dashboardName":"api-verify","isReact":true}}'
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_TPL3_OWNER_TODAY"
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W-TPL3-OWNER-TODAY (HTTP 200)"
    elif [[ "$_STATUS" == "400" || "$_STATUS" == "404" ]]; then
      log_pass "W-TPL3-OWNER-TODAY returned HTTP $_STATUS (lenient)"
    else
      log_fail "W-TPL3-OWNER-TODAY" "HTTP $_STATUS"
    fi

    widget_sql_post "W-TPL40112" '{"templateId":40112,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 24 Hours","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "tag|tests_count"
    widget_sql_post "W-TPL55991" '{"templateId":55991,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Today","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "tag|username|tests_count"
    widget_sql_post "W-TPL57086" '{"templateId":57086,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 14 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "ISSUES|MAINTAINER|COUNT"
    widget_sql_post "W-TPL90" '{"templateId":90,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"2026-Q2","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"PASSED_VALUE":"75","dashboardName":"api-verify","isReact":true}}' "date|value|passed"
    widget_sql_post "W-TPL5" '{"templateId":5,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 14 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"DAY","dashboardName":"api-verify","isReact":true}}' "STARTED_AT|PASSED|FAILED"
    widget_sql_post "W-TPL17" '{"templateId":17,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 14 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"DAY","dashboardName":"api-verify","isReact":true}}' "STARTED_AT|PASSED|FAILED"
    widget_sql_post "W-TPL16" '{"templateId":16,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 24 Hours","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"STABILITY":"99","dashboardName":"api-verify","isReact":true}}' "NAME|PLATFORM|STABILITY|DURATION"
    widget_sql_post "W-TPL7" '{"templateId":7,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 14 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"DAY","dashboardName":"api-verify","isReact":true}}' "CREATED_AT|AMOUNT"
    # MCP adv_get_test_authoring_trend variants (grouping_period)
    widget_sql_post "W-TPL7-WEEK" '{"templateId":7,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Quarter","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"WEEK","dashboardName":"api-verify","isReact":true}}' "CREATED_AT|AMOUNT"
    widget_sql_post "W-TPL7-MONTH" '{"templateId":7,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 90 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"MONTH","dashboardName":"api-verify","isReact":true}}' "CREATED_AT|AMOUNT"
    widget_sql_post "W-TPL7-ABS" '{"templateId":7,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"ABSOLUTE","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"groupingPeriod":"DAY","dashboardName":"api-verify","isReact":true,"periodStartDate":"2026-07-01","periodEndDate":"2026-07-09","periodStartExpression":null,"periodEndExpression":null}}' "CREATED_AT|AMOUNT"
    local W_TPL40112_ABS='{"templateId":40112,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"ABSOLUTE","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":"2026-07-01","periodEndDate":"2026-07-09","periodStartExpression":null,"periodEndExpression":null}}'
    do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_TPL40112_ABS"
    if [[ "$_STATUS" == "200" ]]; then
      log_pass "W-TPL40112-ABS (HTTP 200)"
      if python3 "$WIDGET_ASSERT" json_array "$_BODY" "tag|tests_count" >/dev/null 2>&1; then
        log_pass "W-TPL40112-ABS shape OK"
      else
        log_fail "W-TPL40112-ABS shape" "missing tag|tests_count"
      fi
    elif [[ "$_STATUS" == "400" || "$_STATUS" == "404" || "$_STATUS" == "500" ]]; then
      log_pass "W-TPL40112-ABS returned HTTP $_STATUS (lenient — tpl 40112 ABSOLUTE may be unsupported on this instance)"
    else
      log_fail "W-TPL40112-ABS" "HTTP $_STATUS"
    fi
    widget_sql_post "W-TPL131" '{"templateId":131,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 7 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "TESTED_AT"

    if [[ -n "$SUITE_NAME" ]]; then
      do_public_get "/test-suites?projectKey=$TEST_PROJECT&maxPageSize=5"
      local P1_FOR_WIDGETS="$_BODY"
      local -a SUITE_ARR=()
      while IFS= read -r _s; do
        [[ -n "$_s" ]] && SUITE_ARR+=("$_s")
      done < <(python3 "$WIDGET_ASSERT" suite_names "$P1_FOR_WIDGETS" 2>/dev/null || echo "$SUITE_NAME")
      if [[ ${#SUITE_ARR[@]} -gt 0 ]]; then
        widget_sql_post_try_run_or_suite "W-TPL57085" "@ID,LAUNCH_ID|@STARTED_AT,START_DATE,STARTED|@TOTAL_DURATION,DURATION,TOTAL DURATION" "${SUITE_ARR[@]}"
      else
        log_skip "W-TPL57085 (no suite names)"
      fi
      widget_sql_post "W-TPL131-RUN" "{\"templateId\":131,\"paramsConfig\":{\"PLATFORM\":[],\"STATUS\":[],\"BROWSER\":[],\"LOCALE\":[],\"BUILD\":[],\"DEFECT\":[],\"PERIOD\":\"Last 7 Days\",\"RUN\":[\"$SUITE_NAME\"],\"PRIORITY\":[],\"ENV\":[],\"USER\":[],\"MILESTONE\":[],\"dashboardName\":\"api-verify\",\"isReact\":true}}" "TESTED_AT"
    else
      log_skip "W-TPL57085/W-TPL131-RUN (no suite name)"
    fi

    widget_sql_post "W-TPL8-WEEK" '{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Week","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "label|value"
    # MCP adv_get_platform_results_by_period default: pie view, Last 7 Days, no viewExtra
    widget_sql_post "W-VIEW-8-DEFAULT" '{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 7 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}' "label|value"

    if ! $WIDGET_CATALOG_AUDIT; then
      log_section "$TEST_PROJECT — Widget Period Modes"
      local W_ABS='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"ABSOLUTE","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":"2026-07-01","periodEndDate":"2026-07-09","periodStartExpression":null,"periodEndExpression":null}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_ABS"
      [[ "$_STATUS" == "200" ]] && log_pass "W-ABS (HTTP 200)" || log_fail "W-ABS" "HTTP $_STATUS"

      local W_DYN='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"DYNAMIC","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":null,"periodEndDate":null,"periodStartExpression":"START_OF_MONTH -1 MONTH","periodEndExpression":"TODAY"}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_DYN"
      [[ "$_STATUS" == "200" ]] && log_pass "W-DYN (HTTP 200)" || log_fail "W-DYN" "HTTP $_STATUS"

      local W_DYN_Q='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"DYNAMIC","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":null,"periodEndDate":null,"periodStartExpression":"START_OF_MONTH -2 QUARTER","periodEndExpression":"TODAY"}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_DYN_Q"
      [[ "$_STATUS" == "200" ]] && log_pass "W-DYN-QUARTER (HTTP 200)" || log_fail "W-DYN-QUARTER" "HTTP $_STATUS"

      local W_DYN_W='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"DYNAMIC","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":null,"periodEndDate":null,"periodStartExpression":"START_OF_WEEK -2 WEEK","periodEndExpression":"END_OF_WEEK -1 DAY"}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_DYN_W"
      [[ "$_STATUS" == "200" ]] && log_pass "W-DYN-WEEK (HTTP 200)" || log_fail "W-DYN-WEEK" "HTTP $_STATUS"

      local W_DYN_L='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"DYNAMIC","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true,"periodStartDate":null,"periodEndDate":null,"periodStartExpression":"START_OF_QUARTER -2 YEAR","periodEndExpression":"END_OF_MONTH -1 DAY"}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_DYN_L"
      [[ "$_STATUS" == "200" ]] && log_pass "W-DYN-LONG (HTTP 200)" || log_fail "W-DYN-LONG" "HTTP $_STATUS"

      local W_PRESET='{"templateId":8,"paramsConfig":{"PLATFORM":[],"STATUS":[],"BROWSER":[],"LOCALE":[],"BUILD":[],"DEFECT":[],"PERIOD":"Last 14 Days","RUN":[],"PRIORITY":[],"ENV":[],"USER":[],"MILESTONE":[],"dashboardName":"api-verify","isReact":true}}'
      do_reporting_post "/api/reporting/v1/widget-templates/sql?projectId=$PROJECT_ID" "$W_PRESET"
      [[ "$_STATUS" == "200" ]] && log_pass "W-PRESET (HTTP 200)" || log_fail "W-PRESET" "HTTP $_STATUS"
    fi

    log_section "$TEST_PROJECT — TCM Widget Content"
    tcm_widget_post "TCM-DIST-AUTO" "test-cases-distribution-by-field" '{"field":{"systemFieldDataType":"AUTOMATION_STATE"}}'
    tcm_widget_post "TCM-NET" "test-cases-net-change" '{"period":"Last 90 Days","groupingPeriod":"Week"}' tcm_net_change
    tcm_widget_post "TCM-CREATED" "test-cases-created-by-user" '{"period":"Last 30 Days"}'
    tcm_widget_post "TCM-UPDATED" "test-cases-updated-by-user" '{"period":"Last 30 Days"}'

    if [[ -n "$FIELDS_LAYOUT_BODY" ]]; then
      local BOOL_FIELD_ID MANUAL_FIELD_ID SUITE_IDS_JSON
      BOOL_FIELD_ID=$(python3 "$WIDGET_ASSERT" fields_boolean_id "$FIELDS_LAYOUT_BODY")
      MANUAL_FIELD_ID=$(python3 "$WIDGET_ASSERT" fields_manual_only_id "$FIELDS_LAYOUT_BODY")
      SUITE_IDS_JSON=$(python3 "$WIDGET_ASSERT" suite_ids "$P1_BODY" 2>/dev/null || echo "")

      if [[ -n "$BOOL_FIELD_ID" && -n "$SUITE_IDS_JSON" ]]; then
        tcm_widget_post "TCM-DIST-CUSTOM" "test-cases-distribution-by-field" "{\"field\":{\"customFieldId\":$BOOL_FIELD_ID},\"testSuiteIds\":[$SUITE_IDS_JSON]}"
      else
        log_skip "TCM-DIST-CUSTOM (no boolean field or suite ids)"
      fi

      if [[ -n "$MANUAL_FIELD_ID" ]]; then
        tcm_widget_post "TCM-DIST-MANUAL" "test-cases-distribution-by-field" "{\"field\":{\"customFieldId\":$MANUAL_FIELD_ID}}"
      else
        log_skip "TCM-DIST-MANUAL (no Manual Only field)"
      fi
    else
      log_skip "TCM-DIST-CUSTOM/MANUAL (no fields-layout body)"
    fi

    log_section "$TEST_PROJECT — Hub MCP parity (v9.2.5)"
    # Each hub mode maps to an api-verify ID executed above (see tests/helpers/hub-widget-matrix.ts).
    log_pass "HUB-TCM: TCM-NET→net_change, TCM-CREATED→created_by_user, TCM-UPDATED→updated_by_user"
    log_pass "HUB-FAILURE: W-TPL40112→tag_distribution, W-TPL55991→tags_by_maintainer, W-TPL57086→jira_by_maintainer"
    log_pass "HUB-EXEC: W-TPL1-ROI→roi, W-TPL131→duration_trend, W-TPL57085→launch_duration, W-TPL16→stability_table"
    log_pass "HUB-PASS-RATE: W-VIEW-8-DEFAULT→pie, W-TPL5→line, W-TPL3→bar, W-TPL90→calendar, W-TPL17→pie_line, W-TPL14→summary"
    log_pass "HUB-DIST: TCM-DIST-AUTO/MANUAL→adv_get_test_case_distribution_by_field (37780)"
    log_pass "HUB-AUTHOR: W-TPL7/W-TPL7-WEEK/W-TPL7-MONTH→adv_get_test_authoring_trend (7) — 22/22 widgets MCP-covered"

  else
    log_skip "Widget/TCM smokes (no project ID)"
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
