#!/usr/bin/env bash
# Integration tests — APort Guardrails API routes
#
# Runs against a live Myway server. Mirrors the pattern from
# https://github.com/aporthq/aport-agent-guardrails/tree/main/tests
#
# Usage:
#   ./tests/api/test-guardrails-api.sh
#
# Required env:
#   MYWAY_URL         Base URL of running Myway server (default: http://localhost:48291)
#
# Optional env:
#   APORT_PASSPORT_FILE  Overrides passport path for the test
#
# Exit 0 on all tests passing, 1 on any failure.

set -euo pipefail

MYWAY_URL="${MYWAY_URL:-http://localhost:48291}"
PASS=0
FAIL=0

_GREEN='\033[0;32m'
_RED='\033[0;31m'
_RESET='\033[0m'

pass() { echo -e "${_GREEN}✅ PASS${_RESET} $1"; PASS=$(( PASS + 1 )); }
fail() { echo -e "${_RED}❌ FAIL${_RESET} $1"; FAIL=$(( FAIL + 1 )); }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required: $1"; exit 1; }
}
require_cmd curl
require_cmd jq

echo ""
echo "Myway Guardrails API — integration tests"
echo "Target: $MYWAY_URL"
echo "──────────────────────────────────────────"

# ── Passport ───────────────────────────────────────────────────────────────

echo ""
echo "§ Passport"

RES=$(curl -sf "$MYWAY_URL/api/aport/passport" 2>/dev/null || true)
if [ -z "$RES" ]; then
  fail "GET /api/aport/passport — server not reachable"
else
  # Response may have .configured at top level or nested under .current
  HAS_CONFIGURED=$(echo "$RES" | jq 'has("configured") or (.current | has("configured"))' 2>/dev/null || echo "false")
  if [ "$HAS_CONFIGURED" = "true" ]; then
    pass "GET /api/aport/passport returns configured status"
  else
    fail "GET /api/aport/passport missing 'configured' field — got: $RES"
  fi
fi

# ── Kill Switch ─────────────────────────────────────────────────────────────

echo ""
echo "§ Kill Switch"

RES=$(curl -sf "$MYWAY_URL/api/aport/kill-switch" 2>/dev/null || true)
if [ -z "$RES" ]; then
  fail "GET /api/aport/kill-switch — server not reachable"
else
  # .active is boolean — use has() not // empty (false is falsy in jq)
  HAS_ACTIVE=$(echo "$RES" | jq 'has("active")' 2>/dev/null || echo "false")
  if [ "$HAS_ACTIVE" = "true" ]; then
    pass "GET /api/aport/kill-switch returns { active: ... }"
  else
    fail "GET /api/aport/kill-switch missing 'active' field — got: $RES"
  fi
fi

# POST activate — in CI without a real passport file, activation may not persist
RES=$(curl -sf -X POST "$MYWAY_URL/api/aport/kill-switch" \
  -H "Content-Type: application/json" \
  -d '{"action":"activate"}' 2>/dev/null || true)
if [ -n "$RES" ] && echo "$RES" | jq -e 'has("active")' >/dev/null 2>&1; then
  pass "POST /api/aport/kill-switch {action:activate} → returns active status"
else
  fail "POST /api/aport/kill-switch activate — got: $RES"
fi

# POST deactivate
RES=$(curl -sf -X POST "$MYWAY_URL/api/aport/kill-switch" \
  -H "Content-Type: application/json" \
  -d '{"action":"deactivate"}' 2>/dev/null || true)
if [ -n "$RES" ] && echo "$RES" | jq -e '.active == false' >/dev/null 2>&1; then
  pass "POST /api/aport/kill-switch {action:deactivate} → active:false"
else
  fail "POST /api/aport/kill-switch deactivate — got: $RES"
fi

# POST bad action
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$MYWAY_URL/api/aport/kill-switch" \
  -H "Content-Type: application/json" \
  -d '{"action":"explode"}' 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "400" ]; then
  pass "POST /api/aport/kill-switch unknown action → 400"
else
  fail "POST /api/aport/kill-switch bad action should return 400 — got: $HTTP_CODE"
fi

# POST invalid JSON
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$MYWAY_URL/api/aport/kill-switch" \
  -H "Content-Type: application/json" \
  -d 'not json {]' 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "400" ]; then
  pass "POST /api/aport/kill-switch invalid JSON → 400"
else
  fail "POST /api/aport/kill-switch invalid JSON should return 400 — got: $HTTP_CODE"
fi

# ── Events ──────────────────────────────────────────────────────────────────

echo ""
echo "§ Events"

RES=$(curl -sf "$MYWAY_URL/api/aport/events" 2>/dev/null || true)
if [ -z "$RES" ]; then
  fail "GET /api/aport/events — server not reachable"
else
  # Standard Myway resource list returns { items, total, limit, offset, stats }
  HAS_ITEMS=$(echo "$RES" | jq 'has("items")' 2>/dev/null || echo "false")
  if [ "$HAS_ITEMS" = "true" ]; then
    pass "GET /api/aport/events returns { items: [...], total, stats }"
  else
    fail "GET /api/aport/events missing 'items' field — got: $RES"
  fi
fi

# Blocked-only filter (allowed=0)
RES=$(curl -sf "$MYWAY_URL/api/aport/events?allowed=0" 2>/dev/null || true)
if [ -n "$RES" ] && echo "$RES" | jq -e 'has("items")' >/dev/null 2>&1; then
  pass "GET /api/aport/events?allowed=0 — blocked filter accepted"
else
  fail "GET /api/aport/events?allowed=0 — got: $RES"
fi

# Stats shape
RES=$(curl -sf "$MYWAY_URL/api/aport/events" 2>/dev/null || true)
if echo "$RES" | jq -e '.stats | has("blocked") and has("allowed") and has("total")' >/dev/null 2>&1; then
  pass "GET /api/aport/events response includes stats.blocked/allowed/total"
else
  fail "GET /api/aport/events stats shape wrong — got: $(echo "$RES" | jq '.stats')"
fi

# ── Sync ────────────────────────────────────────────────────────────────────

echo ""
echo "§ Sync"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$MYWAY_URL/api/aport/sync" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  pass "POST /api/aport/sync → 200"
else
  fail "POST /api/aport/sync should return 200 — got: $HTTP_CODE"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "──────────────────────────────────────────"
TOTAL=$(( PASS + FAIL ))
if [ "$FAIL" -gt 0 ]; then
  echo -e "Results: ${_GREEN}${PASS}/${TOTAL} passed${_RESET} · ${_RED}${FAIL} failed${_RESET}"
else
  echo -e "Results: ${_GREEN}${PASS}/${TOTAL} passed${_RESET}"
fi
echo ""

[ "$FAIL" -eq 0 ]
